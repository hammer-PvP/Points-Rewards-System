export const MODULE_ID = "points-and-rewards";
export const MODULE_TITLE = "Polls, Points & Rewards";
export const MODULE_VERSION = "0.4.3";
export const SUPPORT_URL = "https://buymeacoffee.com/hammer.pvp";

export const POINT_METHODS = Object.freeze({
  ACCOUNT: "account",
  CHARACTER: "character"
});

export const VOTE_TYPES = Object.freeze({
  ACTOR: "actor",
  OPTION: "option"
});

export const BALLOT_VISIBILITY = Object.freeze({
  SECRET: "secret",
  PUBLIC: "public"
});

export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 8;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;
export const OWNER_LEVEL = 3;
export const WORLD_SCHEMA_VERSION = 3;

export const DEFAULT_REASON = Object.freeze({
  id: "default-reason",
  title: "Default",
  description: "",
  points: 1,
  virtual: true
});

export const DEFAULT_BENEFIT = Object.freeze({
  id: "default-benefit",
  name: "Default",
  description: "Default reward benefit.",
  cost: 1,
  virtual: true
});

export const DEFAULT_QUESTIONS = Object.freeze([
  {
    id: "question-1",
    title: "Question 1",
    shortLabel: "Q1",
    description: "Edit this voting question in Polls, Points & Rewards settings.",
    voteType: VOTE_TYPES.ACTOR,
    points: 1,
    resolveTiesByGM: true,
    options: []
  },
  {
    id: "question-2",
    title: "Question 2",
    shortLabel: "Q2",
    description: "Edit this voting question in Polls, Points & Rewards settings.",
    voteType: VOTE_TYPES.ACTOR,
    points: 1,
    resolveTiesByGM: true,
    options: []
  }
]);

export function defaultVotingProfile() {
  return {
    id: "session-awards",
    name: "Session Awards",
    allowSelfVoting: false,
    ballotVisibility: BALLOT_VISIBILITY.SECRET,
    questions: foundry.utils.deepClone(DEFAULT_QUESTIONS)
  };
}

export function defaultConfig() {
  const profile = defaultVotingProfile();
  return {
    actorFolderId: "",
    pointMethod: POINT_METHODS.CHARACTER,
    allowNegativeBalance: false,
    postVotingResultsToChat: true,
    showSheetPoints: true,
    showRedemptionBalanceInChat: false,
    votingProfiles: [profile],
    giveReasons: [],
    benefits: []
  };
}

export function defaultRuntime() {
  return {
    activeVote: null,
    finalizedSessionIds: []
  };
}

export function defaultWorldState() {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    revision: 0,
    updatedAt: 0,
    updatedBy: "",
    integrity: { algorithm: "FNV-1A-32", hash: "" },
    migrations: { legacyFlagsImported: false, importedAt: 0, summary: null },
    userAccounts: {},
    identityChanges: [],
    migrationArchives: [],
    closedAccounts: []
  };
}
