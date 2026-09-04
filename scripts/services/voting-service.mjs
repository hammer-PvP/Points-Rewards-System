import { MODULE_ID } from "../constants.mjs";
import { AccountService } from "./account-service.mjs";
import { SettingsService } from "./settings-service.mjs";
import { confirmDialog, htmlEscape, isPrimaryGM, randomId } from "../utils.mjs";

export class VotingService {
  static SOCKET = `module.${MODULE_ID}`;
  static apps = new Set();

  static registerSocket() {
    game.socket.on(this.SOCKET, payload => void this.#onSocket(payload));
  }

  static active() {
    return SettingsService.runtime().activeVote;
  }

  static eligibleUsers(actors) {
    const ids = new Set();
    for (const actor of actors) for (const user of AccountService.nonGMOwners(actor)) ids.add(user.id);
    return Array.from(ids);
  }

  static async start() {
    if (!game.user.isGM) throw new Error("Only a GM can start voting.");
    const runtime = SettingsService.runtime();
    if (runtime.activeVote) throw new Error("A voting session is already open.");
    const config = SettingsService.get();
    if (!config.actorFolderId) throw new Error("Select an Actor folder in Points & Rewards System settings first.");
    const actors = AccountService.configuredActors(config);
    if (actors.length < 2) throw new Error("The selected Actor folder needs at least two Actors for voting.");
    if (config.pointMethod === "account") {
      const missingAccount = actors.filter(actor => !AccountService.accountOwner(actor));
      if (missingAccount.length) throw new Error(`Account-Wide Points requires a non-GM Owner for every voting candidate. Missing: ${missingAccount.map(actor => actor.name).join(", ")}.`);
    }
    const eligibleUserIds = this.eligibleUsers(actors);
    if (!eligibleUserIds.length) throw new Error("No non-GM Owner users were found for the Actors in the selected folder.");
    if (!config.allowSelfVoting) {
      const unusable = eligibleUserIds.filter(userId => actors.every(actor => AccountService.nonGMOwners(actor).some(user => user.id === userId)));
      if (unusable.length) {
        const names = unusable.map(id => game.users.get(id)?.name ?? id).join(", ");
        throw new Error(`Self voting is disabled, but these Users own every candidate and cannot submit a ballot: ${names}.`);
      }
    }
    for (const actor of actors) await AccountService.rememberParticipation(actor);

    const session = {
      id: randomId("vote"),
      createdAt: Date.now(),
      createdBy: game.user.id,
      folderId: config.actorFolderId,
      allowSelfVoting: config.allowSelfVoting === true,
      categories: foundry.utils.deepClone(config.categories),
      candidates: actors.map(actor => ({
        actorId: actor.id,
        name: actor.name,
        img: actor.img ?? "icons/svg/mystery-man.svg",
        ownerUserIds: AccountService.nonGMOwners(actor).map(user => user.id)
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
    if (!session || session.id !== sessionId || session.status !== "open") throw new Error("This voting session is no longer open.");
    if (!session.eligibleUserIds.includes(game.user.id)) throw new Error("You are not eligible to vote in this session.");
    if (session.ballots?.[game.user.id]) throw new Error("Your ballot has already been submitted.");

    const categoryIds = session.categories.map(row => row.id);
    const candidateIds = new Set(session.candidates.map(row => row.actorId));
    const owned = new Set(session.candidates.filter(row => row.ownerUserIds.includes(game.user.id)).map(row => row.actorId));
    const clean = {};
    for (const categoryId of categoryIds) {
      const actorId = String(selections?.[categoryId] ?? "");
      if (!candidateIds.has(actorId)) throw new Error("Select one valid Actor in every category.");
      if (!session.allowSelfVoting && owned.has(actorId)) throw new Error("Self voting is disabled for this session.");
      clean[categoryId] = actorId;
    }
    game.socket.emit(this.SOCKET, {
      type: "vote-submit",
      sessionId,
      userId: game.user.id,
      selections: clean
    });
  }

  static counts(session = this.active()) {
    const counts = {};
    for (const category of session?.categories ?? []) {
      counts[category.id] = {};
      for (const candidate of session.candidates) counts[category.id][candidate.actorId] = 0;
    }
    for (const ballot of Object.values(session?.ballots ?? {})) {
      for (const [categoryId, actorId] of Object.entries(ballot ?? {})) {
        if (counts[categoryId]?.[actorId] !== undefined) counts[categoryId][actorId] += 1;
      }
    }
    return counts;
  }

  static results(session = this.active()) {
    if (!session) return [];
    const counts = this.counts(session);
    return session.categories.map(category => {
      const rows = session.candidates.map(candidate => ({
        ...candidate,
        votes: Number(counts[category.id]?.[candidate.actorId] ?? 0)
      })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
      const top = rows[0]?.votes ?? 0;
      const tied = rows.filter(row => row.votes === top);
      return { category, rows, top, tied, winnerActorId: tied.length === 1 ? tied[0].actorId : null };
    });
  }

  static async requestClose() {
    if (!game.user.isGM) return null;
    const session = this.active();
    if (!session) throw new Error("There is no open voting session.");
    const submitted = Object.keys(session.ballots ?? {}).length;
    const total = session.eligibleUserIds.length;
    if (submitted === 0) throw new Error("At least one ballot must be submitted before voting can be finalized.");
    if (submitted < total) {
      const accepted = await confirmDialog({
        title: "Finish Voting Early?",
        content: `<p><strong>${submitted} of ${total}</strong> eligible players have voted.</p><p>Unsubmitted ballots will not be counted.</p>`,
        yes: "Finish Voting",
        danger: true
      });
      if (!accepted) return null;
    }
    const results = this.results(session);
    return { session, results, ties: results.filter(row => row.tied.length > 1) };
  }

  static async finalize(tieChoices = {}) {
    if (!game.user.isGM) throw new Error("Only a GM can finalize voting.");
    const runtime = SettingsService.runtime();
    const session = runtime.activeVote;
    if (!session) throw new Error("There is no voting session to finalize.");
    if (runtime.finalizedSessionIds.includes(session.id)) {
      runtime.activeVote = null;
      await SettingsService.setRuntime(runtime);
      return;
    }

    session.status = "finalizing";
    runtime.activeVote = session;
    await SettingsService.setRuntime(runtime);

    const resolved = this.results(session).map(row => {
      const winnerActorId = row.winnerActorId ?? String(tieChoices[row.category.id] ?? "");
      if (!winnerActorId || !row.tied.some(candidate => candidate.actorId === winnerActorId)) {
        throw new Error(`Resolve the tie for ${row.category.title} before finalizing.`);
      }
      return { ...row, winnerActorId };
    });

    for (const row of resolved) {
      const actor = game.actors.get(row.winnerActorId);
      if (!actor) continue;
      await AccountService.commit(actor, {
        delta: row.category.points,
        type: "voting",
        title: row.category.title,
        description: `Session voting winner with ${row.top} vote(s).`,
        sourceId: `vote:${session.id}:${row.category.id}`,
        batchId: session.id
      });
    }

    if (SettingsService.get().postVotingResultsToChat) {
      const rows = resolved.map(row => {
        const winner = session.candidates.find(candidate => candidate.actorId === row.winnerActorId);
        return `<li><strong>${htmlEscape(row.category.title)}:</strong> ${htmlEscape(winner?.name ?? "Unknown")} <span class="pr-chat-points">+${row.category.points} points</span></li>`;
      }).join("");
      await ChatMessage.create({
        content: `<section class="pr-chat-card"><header><i class="fa-solid fa-award"></i><strong>Session Voting Results</strong></header><ul>${rows}</ul></section>`
      });
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
    ui.notifications.info("Voting reminder sent to pending players.");
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

  static async #onSocket(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "vote-open") return this.maybePromptCurrentUser();
    if (payload.type === "vote-remind") return this.maybePromptCurrentUser({ force: true });
    if (payload.type === "vote-closed") {
      const { VotingApp } = await import("../apps/voting-app.mjs");
      if (VotingApp.current?.sessionId === payload.sessionId) await VotingApp.current.close();
      return;
    }
    if (payload.type === "vote-accepted") {
      if (game.user.isGM) Hooks.callAll(`${MODULE_ID}.voteUpdated`, this.active());
      return;
    }
    if (payload.type !== "vote-submit" || !isPrimaryGM()) return;

    const runtime = SettingsService.runtime();
    const session = runtime.activeVote;
    if (!session || session.id !== payload.sessionId || session.status !== "open") return;
    const userId = String(payload.userId ?? "");
    if (!session.eligibleUserIds.includes(userId) || session.ballots?.[userId]) return;

    const categoryIds = new Set(session.categories.map(row => row.id));
    const candidates = new Map(session.candidates.map(row => [row.actorId, row]));
    const selections = {};
    for (const [categoryId, actorId] of Object.entries(payload.selections ?? {})) {
      if (!categoryIds.has(categoryId) || !candidates.has(actorId)) return;
      if (!session.allowSelfVoting && candidates.get(actorId).ownerUserIds.includes(userId)) return;
      selections[categoryId] = actorId;
    }
    if (Object.keys(selections).length !== session.categories.length) return;
    session.ballots ??= {};
    session.ballots[userId] = selections;
    runtime.activeVote = session;
    await SettingsService.setRuntime(runtime);
    Hooks.callAll(`${MODULE_ID}.voteUpdated`, session);
    game.socket.emit(this.SOCKET, { type: "vote-accepted", sessionId: session.id, userId });
  }
}
