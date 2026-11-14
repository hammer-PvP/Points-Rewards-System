import {
  BALLOT_VISIBILITY,
  DEFAULT_BENEFIT,
  DEFAULT_REASON,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  MIN_QUESTIONS,
  MODULE_ID,
  POINT_METHODS,
  VOTE_TYPES,
  defaultConfig,
  defaultRuntime,
  defaultVotingProfile,
  defaultWorldState
} from "../constants.mjs";

export class SettingsService {
  static register() {
    game.settings.register(MODULE_ID, "config", {
      scope: "world",
      config: false,
      type: Object,
      default: defaultConfig()
    });
    game.settings.register(MODULE_ID, "runtime", {
      scope: "world",
      config: false,
      type: Object,
      default: defaultRuntime()
    });
    game.settings.register(MODULE_ID, "worldState", {
      scope: "world",
      config: false,
      type: Object,
      default: defaultWorldState()
    });
    game.settings.register(MODULE_ID, "worldStateBackup", {
      scope: "world",
      config: false,
      type: Object,
      default: defaultWorldState()
    });
  }

  static get() {
    return this.normalize(game.settings.get(MODULE_ID, "config") ?? {});
  }

  static async set(config) {
    const normalized = this.normalize(config);
    await game.settings.set(MODULE_ID, "config", normalized);
    return normalized;
  }

  static runtime() {
    return foundry.utils.mergeObject(defaultRuntime(), game.settings.get(MODULE_ID, "runtime") ?? {}, { inplace: false });
  }

  static async setRuntime(runtime) {
    const clean = foundry.utils.mergeObject(defaultRuntime(), runtime ?? {}, { inplace: false });
    clean.finalizedSessionIds = Array.from(new Set(clean.finalizedSessionIds ?? [])).slice(-100);
    clean.cancelledSessions = (Array.isArray(clean.cancelledSessions) ? clean.cancelledSessions : []).filter(Boolean).slice(-100);
    await game.settings.set(MODULE_ID, "runtime", clean);
    return clean;
  }

  static reasons(config = this.get()) {
    const rows = Array.isArray(config.giveReasons) ? config.giveReasons.filter(Boolean) : [];
    return rows.length ? rows : [foundry.utils.deepClone(DEFAULT_REASON)];
  }

  static benefits(config = this.get()) {
    const rows = Array.isArray(config.benefits) ? config.benefits.filter(Boolean) : [];
    return rows.length ? rows : [foundry.utils.deepClone(DEFAULT_BENEFIT)];
  }

  static votingProfiles(config = this.get()) {
    return Array.isArray(config.votingProfiles) && config.votingProfiles.length
      ? config.votingProfiles
      : [defaultVotingProfile()];
  }

  static profileById(profileId, config = this.get()) {
    const id = String(profileId ?? "");
    return this.votingProfiles(config).find(profile => profile.id === id) ?? null;
  }

  static normalize(config) {
    const raw = config && typeof config === "object" ? foundry.utils.deepClone(config) : {};
    const merged = foundry.utils.mergeObject(defaultConfig(), raw, { inplace: false });
    merged.actorFolderId = String(merged.actorFolderId ?? "");
    merged.pointMethod = merged.pointMethod === POINT_METHODS.ACCOUNT ? POINT_METHODS.ACCOUNT : POINT_METHODS.CHARACTER;
    merged.allowNegativeBalance = merged.allowNegativeBalance === true;
    merged.postVotingResultsToChat = merged.postVotingResultsToChat !== false;
    merged.showSheetPoints = merged.showSheetPoints !== false;
    // Existing Worlds and fresh installs both keep remaining balances private by default.
    merged.showRedemptionBalanceInChat = merged.showRedemptionBalanceInChat === true;
    merged.notifyPointAdjustments = merged.notifyPointAdjustments !== false;

    const rawProfiles = Array.isArray(raw.votingProfiles) ? raw.votingProfiles : null;
    const legacyCategories = Array.isArray(raw.categories) ? raw.categories : [];
    if (rawProfiles?.length) {
      merged.votingProfiles = rawProfiles.map((profile, index) => this.#normalizeProfile(profile, index));
    } else if (legacyCategories.length) {
      merged.votingProfiles = [{
        id: "session-awards",
        name: "Session Awards",
        allowSelfVoting: raw.allowSelfVoting === true,
        ballotVisibility: BALLOT_VISIBILITY.SECRET,
        questions: legacyCategories.slice(0, MAX_QUESTIONS).map((row, index) => this.#normalizeQuestion({
          id: row.id || `question-${index + 1}`,
          title: row.title,
          shortLabel: row.shortLabel,
          description: row.description,
          voteType: VOTE_TYPES.ACTOR,
          points: row.points,
          resolveTiesByGM: true,
          options: []
        }, index))
      }];
    } else {
      merged.votingProfiles = [defaultVotingProfile()];
    }

    merged.votingProfiles = merged.votingProfiles.filter(Boolean);
    if (!merged.votingProfiles.length) merged.votingProfiles = [defaultVotingProfile()];
    merged.votingProfiles = this.#dedupeProfileIds(merged.votingProfiles);

    merged.giveReasons = (Array.isArray(merged.giveReasons) ? merged.giveReasons : [])
      .filter(row => row && String(row.title ?? "").trim())
      .map(row => ({
        id: String(row.id || foundry.utils.randomID()),
        title: String(row.title).trim().slice(0, 80),
        description: String(row.description ?? "").trim().slice(0, 220),
        points: Math.max(1, Math.trunc(Number(row.points) || 1))
      }));

    merged.benefits = (Array.isArray(merged.benefits) ? merged.benefits : [])
      .filter(row => row && String(row.name ?? "").trim() && String(row.description ?? "").trim())
      .map(row => ({
        id: String(row.id || foundry.utils.randomID()),
        name: String(row.name).trim().slice(0, 80),
        description: String(row.description).trim().slice(0, 260),
        cost: Math.max(1, Math.trunc(Number(row.cost) || 1))
      }));

    // Legacy fields are intentionally not used after normalization.
    delete merged.categories;
    delete merged.allowSelfVoting;
    return merged;
  }

  static #normalizeProfile(profile, index = 0) {
    const source = profile && typeof profile === "object" ? profile : {};
    const id = String(source.id || `profile-${index + 1}`);
    const name = String(source.name || `Voting Profile ${index + 1}`).trim().slice(0, 80) || `Voting Profile ${index + 1}`;
    const questions = (Array.isArray(source.questions) ? source.questions : [])
      .slice(0, MAX_QUESTIONS)
      .map((question, questionIndex) => this.#normalizeQuestion(question, questionIndex));
    while (questions.length < MIN_QUESTIONS) {
      questions.push(this.#normalizeQuestion({
        id: `question-${questions.length + 1}`,
        title: `Question ${questions.length + 1}`,
        shortLabel: `Q${questions.length + 1}`,
        description: "",
        voteType: VOTE_TYPES.ACTOR,
        points: 0,
        resolveTiesByGM: true,
        options: []
      }, questions.length));
    }
    return {
      id,
      name,
      allowSelfVoting: source.allowSelfVoting === true,
      ballotVisibility: source.ballotVisibility === BALLOT_VISIBILITY.PUBLIC ? BALLOT_VISIBILITY.PUBLIC : BALLOT_VISIBILITY.SECRET,
      questions
    };
  }

  static #normalizeQuestion(question, index = 0) {
    const source = question && typeof question === "object" ? question : {};
    const voteType = source.voteType === VOTE_TYPES.OPTION ? VOTE_TYPES.OPTION : VOTE_TYPES.ACTOR;
    const title = String(source.title || `Question ${index + 1}`).trim().slice(0, 80) || `Question ${index + 1}`;
    const shortLabel = String(source.shortLabel || `Q${index + 1}`).trim().slice(0, 12) || `Q${index + 1}`;
    const options = voteType === VOTE_TYPES.OPTION
      ? this.#normalizeOptions(source.options)
      : [];
    return {
      id: String(source.id || `question-${index + 1}`),
      title,
      shortLabel,
      description: String(source.description ?? "").trim().slice(0, 220),
      voteType,
      points: voteType === VOTE_TYPES.ACTOR ? Math.max(0, Math.trunc(Number(source.points) || 0)) : 0,
      resolveTiesByGM: source.resolveTiesByGM !== false,
      options
    };
  }

  static #normalizeOptions(options) {
    const rows = (Array.isArray(options) ? options : [])
      .slice(0, MAX_OPTIONS)
      .map((option, index) => ({
        id: String(option?.id || `option-${index + 1}`),
        label: String(option?.label || `Option ${index + 1}`).trim().slice(0, 80) || `Option ${index + 1}`,
        description: String(option?.description ?? "").trim().slice(0, 180)
      }));
    while (rows.length < MIN_OPTIONS) {
      rows.push({
        id: `option-${rows.length + 1}`,
        label: `Option ${rows.length + 1}`,
        description: ""
      });
    }
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.id)) row.id = foundry.utils.randomID();
      seen.add(row.id);
    }
    return rows;
  }

  static #dedupeProfileIds(profiles) {
    const seen = new Set();
    return profiles.map(profile => {
      if (seen.has(profile.id)) profile.id = foundry.utils.randomID();
      seen.add(profile.id);
      const questionSeen = new Set();
      profile.questions = profile.questions.map(question => {
        if (questionSeen.has(question.id)) question.id = foundry.utils.randomID();
        questionSeen.add(question.id);
        return question;
      });
      return profile;
    });
  }
}
