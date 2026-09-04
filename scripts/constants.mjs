export const MODULE_ID = "points-and-rewards";
export const MODULE_TITLE = "Points & Rewards System";
export const MODULE_VERSION = "0.0.1";
export const SUPPORT_URL = "https://buymeacoffee.com/hammer.pvp";

export const POINT_METHODS = Object.freeze({
  ACCOUNT: "account",
  CHARACTER: "character"
});

export const MIN_CATEGORIES = 2;
export const MAX_CATEGORIES = 8;
export const OWNER_LEVEL = 3;

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

export const DEFAULT_CATEGORIES = Object.freeze([
  {
    id: "category-1",
    title: "Category 1",
    shortLabel: "CAT 1",
    description: "Edit this voting category in Points & Rewards System settings.",
    points: 1
  },
  {
    id: "category-2",
    title: "Category 2",
    shortLabel: "CAT 2",
    description: "Edit this voting category in Points & Rewards System settings.",
    points: 1
  }
]);

export function defaultConfig() {
  return {
    actorFolderId: "",
    pointMethod: POINT_METHODS.CHARACTER,
    allowSelfVoting: false,
    allowNegativeBalance: false,
    postVotingResultsToChat: true,
    showSheetPoints: true,
    categories: foundry.utils.deepClone(DEFAULT_CATEGORIES),
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
