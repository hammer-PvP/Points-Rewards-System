import { BALLOT_VISIBILITY, MODULE_ID, VOTE_TYPES } from "../constants.mjs";
import { AccountService } from "./account-service.mjs";
import { SettingsService } from "./settings-service.mjs";
import { confirmDialog, htmlEscape, isPrimaryGM, randomId } from "../utils.mjs";

export class VotingService {
  static SOCKET = `module.${MODULE_ID}`;
  // Prevent a late ballot handler on this GM client from restoring a cancelled session.
  static #cancellingSessionId = "";
  static #ballotWriteQueue = Promise.resolve();

  static registerSocket() {
    game.socket.on(this.SOCKET, payload => void this.#onSocket(payload));
  }

  static active() {
    return this.#normalizeSession(SettingsService.runtime().activeVote);
  }

  static eligibleUsers(actors) {
    const ids = new Set();
    for (const actor of actors) {
      const user = AccountService.primaryUser(actor);
      if (user) ids.add(user.id);
    }
    return Array.from(ids);
  }

  static candidatePrimaryUserId(candidate) {
    if (candidate?.primaryUserId) return String(candidate.primaryUserId);
    const legacy = Array.isArray(candidate?.ownerUserIds) ? candidate.ownerUserIds : [];
    return legacy.length === 1 ? String(legacy[0]) : "";
  }

  static async start(profileId) {
    if (!game.user.isGM) throw new Error("Only a GM can start a poll.");
    const runtime = SettingsService.runtime();
    if (runtime.activeVote) throw new Error("A poll is already open.");
    const config = SettingsService.get();
    const profile = SettingsService.profileById(profileId, config) ?? SettingsService.votingProfiles(config)[0];
    if (!profile) throw new Error("Configure at least one Voting Profile first.");
    if (!config.actorFolderId) throw new Error("Select an Actor folder in Polls, Points & Rewards settings first.");

    const actors = AccountService.configuredActors(config);
    if (actors.length < 1) throw new Error("The selected Actor folder needs at least one Actor to identify eligible voters.");
    await AccountService.ensureConfiguredPrimaryUsers(config);
    const missingPrimary = actors.filter(actor => !AccountService.primaryUser(actor));
    if (missingPrimary.length) {
      throw new Error(`Every participating Actor needs a Primary User. Review User / Actor Normalization. Missing: ${missingPrimary.map(actor => actor.name).join(", ")}.`);
    }

    const hasActorQuestions = profile.questions.some(question => question.voteType === VOTE_TYPES.ACTOR);
    if (hasActorQuestions && actors.length < 2) throw new Error("Actor Vote questions require at least two Actors in the selected folder.");

    const eligibleUserIds = this.eligibleUsers(actors);
    if (!eligibleUserIds.length) throw new Error("No Primary Users were found for the Actors in the selected folder.");
    if (hasActorQuestions && !profile.allowSelfVoting) {
      const unusable = eligibleUserIds.filter(userId => actors.every(actor => AccountService.primaryUser(actor)?.id === userId));
      if (unusable.length) {
        const names = unusable.map(id => game.users.get(id)?.name ?? id).join(", ");
        throw new Error(`Self voting is disabled, but these Users are the Primary User for every Actor candidate and cannot submit a complete ballot: ${names}.`);
      }
    }

    for (const actor of actors) await AccountService.rememberParticipation(actor);

    const session = {
      id: randomId("poll"),
      createdAt: Date.now(),
      createdBy: game.user.id,
      folderId: config.actorFolderId,
      profileId: profile.id,
      profileName: profile.name,
      allowSelfVoting: profile.allowSelfVoting === true,
      ballotVisibility: profile.ballotVisibility === BALLOT_VISIBILITY.PUBLIC ? BALLOT_VISIBILITY.PUBLIC : BALLOT_VISIBILITY.SECRET,
      questions: foundry.utils.deepClone(profile.questions),
      candidates: actors.map(actor => ({
        actorId: actor.id,
        name: actor.name,
        img: actor.img ?? "icons/svg/mystery-man.svg",
        primaryUserId: AccountService.primaryUser(actor)?.id ?? ""
      })),
      eligibleUserIds,
      ballots: {},
      status: "open"
    };

    runtime.activeVote = session;
    await SettingsService.setRuntime(runtime);
    game.socket.emit(this.SOCKET, { type: "vote-open", sessionId: session.id });
    Hooks.callAll(`${MODULE_ID}.voteUpdated`, session);
    return session;
  }

  static async submit(sessionId, selections) {
    const session = this.active();
    if (!session || session.id !== sessionId || session.status !== "open") throw new Error("This poll is no longer open.");
    if (!session.eligibleUserIds.includes(game.user.id)) throw new Error("You are not eligible to vote in this poll.");
    if (session.ballots?.[game.user.id]) throw new Error("Your ballot has already been submitted.");

    const clean = this.#validateSelections(session, game.user.id, selections);
    game.socket.emit(this.SOCKET, {
      type: "vote-submit",
      sessionId,
      userId: game.user.id,
      selections: clean
    });
  }

  static counts(session = this.active()) {
    const counts = {};
    for (const question of session?.questions ?? []) {
      counts[question.id] = {};
      for (const choice of this.choicesForQuestion(session, question)) counts[question.id][choice.valueId] = 0;
    }
    for (const ballot of Object.values(session?.ballots ?? {})) {
      for (const [questionId, valueId] of Object.entries(ballot ?? {})) {
        if (counts[questionId]?.[valueId] !== undefined) counts[questionId][valueId] += 1;
      }
    }
    return counts;
  }

  static choicesForQuestion(session, question) {
    if (question.voteType === VOTE_TYPES.OPTION) {
      return (question.options ?? []).map(option => ({
        valueId: String(option.id),
        name: String(option.label),
        description: String(option.description ?? ""),
        img: "",
        type: VOTE_TYPES.OPTION
      }));
    }
    return (session?.candidates ?? []).map(candidate => ({
      valueId: String(candidate.actorId),
      actorId: String(candidate.actorId),
      name: candidate.name,
      description: "",
      img: candidate.img,
      primaryUserId: this.candidatePrimaryUserId(candidate),
      type: VOTE_TYPES.ACTOR
    }));
  }

  static results(session = this.active()) {
    if (!session) return [];
    const counts = this.counts(session);
    return (session.questions ?? []).map(question => {
      const rows = this.choicesForQuestion(session, question)
        .map(choice => ({ ...choice, votes: Number(counts[question.id]?.[choice.valueId] ?? 0) }))
        .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
      const top = rows[0]?.votes ?? 0;
      const tied = rows.filter(row => row.votes === top);
      const needsTieBreak = tied.length > 1 && question.resolveTiesByGM !== false;
      const winnerValueIds = tied.length === 1 ? [tied[0].valueId] : question.resolveTiesByGM === false ? tied.map(row => row.valueId) : [];
      return { question, rows, top, tied, needsTieBreak, winnerValueIds };
    });
  }

  static ballotDetails(session = this.active()) {
    if (!session) return [];
    const questions = new Map((session.questions ?? []).map(question => [question.id, question]));
    return Object.entries(session.ballots ?? {}).map(([userId, ballot]) => {
      const user = game.users.get(userId);
      const selections = Object.entries(ballot ?? {}).map(([questionId, valueId]) => {
        const question = questions.get(questionId);
        const choice = question ? this.choicesForQuestion(session, question).find(row => row.valueId === valueId) : null;
        return {
          questionId,
          choiceValueId: String(valueId),
          shortLabel: question?.shortLabel ?? question?.title ?? "Question",
          questionTitle: question?.title ?? "Question",
          choiceName: choice?.name ?? "Unknown"
        };
      });
      return { userId, userName: user?.name ?? userId, selections };
    }).sort((a, b) => a.userName.localeCompare(b.userName));
  }

  static async cancel() {
    if (!game.user?.isGM) throw new Error("Only a GM can cancel a poll.");
    const session = this.active();
    if (!session || session.status !== "open") throw new Error("There is no open poll to cancel.");
    const submitted = Object.keys(session.ballots ?? {}).length;
    const accepted = await confirmDialog({
      title: "Cancel Voting?",
      content: `<p>Cancel <strong>${htmlEscape(session.profileName)}</strong>?</p>`
        + `<p>${submitted} ballot(s) have been submitted. They will not be counted.</p>`
        + `<p><strong>No points will be awarded.</strong> The Voting Profile will be preserved.</p>`,
      yes: "Cancel Voting",
      danger: true
    });
    if (!accepted) return null;

    // Guard the GM-side socket writer while the cancellation is persisted.
    this.#cancellingSessionId = session.id;
    try {
      await this.#ballotWriteQueue;
      const runtime = SettingsService.runtime();
      const current = this.#normalizeSession(runtime.activeVote);
      if (!current || current.id !== session.id || current.status !== "open") {
        throw new Error("The poll changed while the cancellation was being confirmed. Nothing was cancelled.");
      }
      const record = {
        sessionId: current.id,
        status: "cancelled",
        profileId: current.profileId,
        profileName: current.profileName,
        startedAt: current.createdAt,
        cancelledAt: Date.now(),
        cancelledBy: game.user.id,
        submittedBallots: Object.keys(current.ballots ?? {}).length
      };
      runtime.cancelledSessions = [...(runtime.cancelledSessions ?? []), record].slice(-100);
      runtime.activeVote = null;
      await SettingsService.setRuntime(runtime);
      game.socket.emit(this.SOCKET, { type: "vote-cancelled", sessionId: current.id });
      Hooks.callAll(`${MODULE_ID}.voteUpdated`, null);
      try {
        await ChatMessage.create({
          content: `<section class="pr-chat-card pr-chat-poll-cancelled">`
            + `<header><i class="fa-solid fa-ban" aria-hidden="true"></i><strong>Poll Cancelled</strong></header>`
            + `<p><strong>${htmlEscape(current.profileName)}</strong> was cancelled by the GM. No votes were counted and no points were awarded.</p>`
            + `</section>`
        });
      } catch (chatError) {
        console.error(`${MODULE_ID} | Poll was cancelled but its Chat notice could not be published.`, chatError);
      }
      return record;
    } finally {
      this.#cancellingSessionId = "";
    }
  }

  static async requestClose() {
    if (!game.user.isGM) return null;
    const session = this.active();
    if (!session || session.status !== "open") throw new Error("There is no open poll.");
    const submitted = Object.keys(session.ballots ?? {}).length;
    const total = session.eligibleUserIds.length;
    if (submitted === 0) throw new Error("At least one ballot must be submitted before the poll can be finalized.");
    if (submitted < total) {
      const accepted = await confirmDialog({
        title: "Finish Poll Early?",
        content: `<p><strong>${submitted} of ${total}</strong> eligible players have voted.</p><p>Unsubmitted ballots will not be counted.</p>`,
        yes: "Finish Poll",
        danger: true
      });
      if (!accepted) return null;
    }
    const results = this.results(session);
    return { session, results, ties: results.filter(row => row.needsTieBreak) };
  }

  static async finalize(tieChoices = {}) {
    if (!game.user.isGM) throw new Error("Only a GM can finalize a poll.");
    const runtime = SettingsService.runtime();
    const session = this.#normalizeSession(runtime.activeVote);
    if (!session || session.status !== "open") throw new Error("There is no open poll to finalize.");
    if (runtime.finalizedSessionIds.includes(session.id)) {
      runtime.activeVote = null;
      await SettingsService.setRuntime(runtime);
      return [];
    }

    session.status = "finalizing";
    runtime.activeVote = session;
    await SettingsService.setRuntime(runtime);

    const resolved = this.results(session).map(row => {
      if (!row.needsTieBreak) return row;
      const winnerValueId = String(tieChoices[row.question.id] ?? "");
      if (!winnerValueId || !row.tied.some(choice => choice.valueId === winnerValueId)) {
        throw new Error(`Resolve the tie for ${row.question.title} before finalizing.`);
      }
      return { ...row, winnerValueIds: [winnerValueId], needsTieBreak: false };
    });

    for (const row of resolved) {
      if (row.question.voteType !== VOTE_TYPES.ACTOR || row.question.points <= 0) continue;
      for (const actorId of row.winnerValueIds) {
        const actor = game.actors.get(actorId);
        if (!actor) continue;
        await AccountService.commit(actor, {
          delta: row.question.points,
          type: "voting",
          title: row.question.title,
          description: `Poll winner in “${session.profileName}” with ${row.top} vote(s).`,
          sourceId: `poll:${session.id}:${row.question.id}:${actorId}`,
          batchId: session.id
        });
      }
    }

    if (SettingsService.get().postVotingResultsToChat) {
      await ChatMessage.create({ content: this.#chatResults(session, resolved) });
    }

    runtime.activeVote = null;
    runtime.finalizedSessionIds.push(session.id);
    await SettingsService.setRuntime(runtime);
    game.socket.emit(this.SOCKET, { type: "vote-closed", sessionId: session.id });
    Hooks.callAll(`${MODULE_ID}.voteUpdated`, null);
    return resolved;
  }

  static async remindPending() {
    if (!game.user.isGM) return;
    const session = this.active();
    if (!session) return;
    game.socket.emit(this.SOCKET, { type: "vote-remind", sessionId: session.id });
    ui.notifications.info("Poll reminder sent to pending players.");
  }

  static async maybePromptCurrentUser({ force = false } = {}) {
    if (game.user.isGM) return;
    const session = this.active();
    if (!session || session.status !== "open") return;
    if (!session.eligibleUserIds.includes(game.user.id)) return;
    if (session.ballots?.[game.user.id]) return;
    const { VotingApp } = await import("../apps/voting-app.mjs");
    if (VotingApp.current?.rendered) {
      if (force) VotingApp.current.bringToTop?.();
      return;
    }
    VotingApp.current = new VotingApp({ sessionId: session.id });
    VotingApp.current.render({ force: true });
  }

  static #normalizeSession(session) {
    if (!session || Array.isArray(session.questions) || !Array.isArray(session.categories)) return session;
    return {
      ...session,
      profileId: session.profileId || "legacy-session-awards",
      profileName: session.profileName || "Session Awards",
      ballotVisibility: session.ballotVisibility || BALLOT_VISIBILITY.SECRET,
      questions: session.categories.map((category, index) => ({
        id: category.id || `question-${index + 1}`,
        title: category.title || `Question ${index + 1}`,
        shortLabel: category.shortLabel || `Q${index + 1}`,
        description: category.description || "",
        voteType: VOTE_TYPES.ACTOR,
        points: Math.max(0, Math.trunc(Number(category.points) || 0)),
        resolveTiesByGM: true,
        options: []
      }))
    };
  }

  static #validateSelections(session, userId, selections) {
    const clean = {};
    for (const question of session.questions ?? []) {
      const valueId = String(selections?.[question.id] ?? "");
      const choices = this.choicesForQuestion(session, question);
      const choice = choices.find(row => row.valueId === valueId);
      if (!choice) throw new Error(`Select one valid answer for ${question.title}.`);
      if (question.voteType === VOTE_TYPES.ACTOR && !session.allowSelfVoting && choice.primaryUserId === userId) {
        throw new Error("Self voting is disabled for this poll.");
      }
      clean[question.id] = valueId;
    }
    if (Object.keys(clean).length !== (session.questions?.length ?? 0)) throw new Error("Complete every question before submitting.");
    return clean;
  }

  static #chatResults(session, resolved) {
    const publicBallots = session.ballotVisibility === BALLOT_VISIBILITY.PUBLIC;
    const ballotDetails = this.ballotDetails(session);
    const votersByQuestionChoice = new Map();
    for (const ballot of ballotDetails) {
      for (const selection of ballot.selections) {
        const key = `${selection.questionId}\u0000${selection.choiceValueId}`;
        if (!votersByQuestionChoice.has(key)) votersByQuestionChoice.set(key, []);
        votersByQuestionChoice.get(key).push(ballot.userName);
      }
    }

    const questionBlocks = resolved.map(row => {
      const winnerSet = new Set(row.winnerValueIds);
      const choices = row.rows.map(choice => {
        const winner = winnerSet.has(choice.valueId);
        const voters = publicBallots ? votersByQuestionChoice.get(`${row.question.id}\u0000${choice.name}`) ?? [] : [];
        const awarded = winner && row.question.voteType === VOTE_TYPES.ACTOR && row.question.points > 0
          ? ` <span class="pr-chat-points">+${row.question.points} points</span>`
          : "";
        const voterLine = publicBallots && voters.length
          ? `<small class="pr-chat-voters">${htmlEscape(voters.join(", "))}</small>`
          : "";
        return `<li class="${winner ? "winner" : ""}"><span><strong>${htmlEscape(choice.name)}</strong> — ${choice.votes} vote${choice.votes === 1 ? "" : "s"}${awarded}</span>${voterLine}</li>`;
      }).join("");
      const tie = row.winnerValueIds.length > 1 ? `<p class="pr-chat-tie"><i class="fa-solid fa-scale-balanced"></i> Tie accepted: ${htmlEscape(row.winnerValueIds.map(id => row.rows.find(choice => choice.valueId === id)?.name ?? "Unknown").join(", "))}</p>` : "";
      return `<section class="pr-chat-question"><h4>${htmlEscape(row.question.title)}</h4>${tie}<ul>${choices}</ul></section>`;
    }).join("");

    const privacy = publicBallots ? "Public ballots — voter names are shown below." : "Secret ballots — only totals are shown.";
    return `<section class="pr-chat-card pr-chat-poll"><header><i class="fa-solid fa-square-poll-vertical"></i><strong>${htmlEscape(session.profileName)} — Poll Results</strong></header><p class="pr-chat-privacy">${privacy}</p>${questionBlocks}</section>`;
  }

  static async #onSocket(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "vote-open") return this.maybePromptCurrentUser();
    if (payload.type === "vote-remind") return this.maybePromptCurrentUser({ force: true });
    if (payload.type === "vote-closed" || payload.type === "vote-cancelled") {
      const { VotingApp } = await import("../apps/voting-app.mjs");
      if (VotingApp.current?.sessionId === payload.sessionId) await VotingApp.current.close();
      return;
    }
    if (payload.type === "vote-accepted") {
      if (game.user.isGM) Hooks.callAll(`${MODULE_ID}.voteUpdated`, this.active());
      return;
    }
    if (payload.type !== "vote-submit" || !isPrimaryGM()) return;
    // Socket updates and GM cancellation share this per-client queue. Any
    // submitted ballot that reaches the queue after cancellation is rejected.
    const process = async () => {
      if (this.#cancellingSessionId === payload.sessionId) return;
      const runtime = SettingsService.runtime();
      const session = this.#normalizeSession(runtime.activeVote);
      if (!session || session.id !== payload.sessionId || session.status !== "open") return;
      const userId = String(payload.userId ?? "");
      if (!session.eligibleUserIds.includes(userId) || session.ballots?.[userId]) return;

      let selections;
      try {
        selections = this.#validateSelections(session, userId, payload.selections ?? {});
      } catch (_error) {
        return;
      }
      session.ballots ??= {};
      session.ballots[userId] = selections;
      runtime.activeVote = session;
      await SettingsService.setRuntime(runtime);
      Hooks.callAll(`${MODULE_ID}.voteUpdated`, session);
      game.socket.emit(this.SOCKET, { type: "vote-accepted", sessionId: session.id, userId });
    };
    this.#ballotWriteQueue = this.#ballotWriteQueue.then(process, process);
    await this.#ballotWriteQueue;
  }
}
