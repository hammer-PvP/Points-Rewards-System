import {
  BALLOT_VISIBILITY,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  MIN_QUESTIONS,
  MODULE_ID,
  MODULE_VERSION,
  VOTE_TYPES
} from "../constants.mjs";

export const ECOSYSTEM_EXPORT_TYPES = Object.freeze({
  ALL: "all",
  VOTING: "voting-profiles",
  REASONS: "give-point-reasons",
  BENEFITS: "redeem-benefits"
});

const LEGACY_VOTING_TYPE = "voting-categories";
const SCHEMA_VERSION = 2;

function cleanOption(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Voting option #${index + 1} is invalid.`);
  const label = String(row.label ?? "").trim();
  if (!label) throw new Error(`Voting option #${index + 1} needs a label.`);
  return {
    label: label.slice(0, 80),
    description: String(row.description ?? "").trim().slice(0, 180)
  };
}

function cleanQuestion(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Voting question #${index + 1} is invalid.`);
  const title = String(row.title ?? "").trim();
  const shortLabel = String(row.shortLabel ?? "").trim().slice(0, 12);
  const description = String(row.description ?? "").trim().slice(0, 220);
  const voteType = row.voteType === VOTE_TYPES.OPTION ? VOTE_TYPES.OPTION : VOTE_TYPES.ACTOR;
  const points = voteType === VOTE_TYPES.ACTOR ? Math.trunc(Number(row.points)) : 0;
  if (!title) throw new Error(`Voting question #${index + 1} needs a title.`);
  if (!shortLabel) throw new Error(`Voting question #${index + 1} needs a short label.`);
  if (!Number.isInteger(points) || points < 0) throw new Error(`Voting question #${index + 1} needs a non-negative integer point value.`);
  const options = voteType === VOTE_TYPES.OPTION
    ? (Array.isArray(row.options) ? row.options : []).map((option, optionIndex) => cleanOption(option, optionIndex))
    : [];
  if (voteType === VOTE_TYPES.OPTION && (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS)) {
    throw new Error(`Option Vote question #${index + 1} must contain ${MIN_OPTIONS}–${MAX_OPTIONS} options.`);
  }
  return {
    title: title.slice(0, 80),
    shortLabel,
    description,
    voteType,
    points,
    resolveTiesByGM: row.resolveTiesByGM !== false,
    options
  };
}

function cleanProfile(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Voting Profile #${index + 1} is invalid.`);
  const name = String(row.name ?? "").trim();
  if (!name) throw new Error(`Voting Profile #${index + 1} needs a name.`);
  const questions = (Array.isArray(row.questions) ? row.questions : []).map((question, questionIndex) => cleanQuestion(question, questionIndex));
  if (questions.length < MIN_QUESTIONS || questions.length > MAX_QUESTIONS) {
    throw new Error(`Voting Profile #${index + 1} must contain ${MIN_QUESTIONS}–${MAX_QUESTIONS} questions.`);
  }
  return {
    name: name.slice(0, 80),
    allowSelfVoting: row.allowSelfVoting === true,
    ballotVisibility: row.ballotVisibility === BALLOT_VISIBILITY.PUBLIC ? BALLOT_VISIBILITY.PUBLIC : BALLOT_VISIBILITY.SECRET,
    questions
  };
}

function cleanLegacyCategory(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Voting category #${index + 1} is invalid.`);
  const title = String(row.title ?? "").trim();
  const shortLabel = String(row.shortLabel ?? "").trim().slice(0, 12);
  const points = Math.trunc(Number(row.points));
  if (!title || !shortLabel || !Number.isInteger(points) || points < 1) throw new Error(`Legacy voting category #${index + 1} is invalid.`);
  return {
    title: title.slice(0, 80),
    shortLabel,
    description: String(row.description ?? "").trim().slice(0, 220),
    voteType: VOTE_TYPES.ACTOR,
    points,
    resolveTiesByGM: true,
    options: []
  };
}

function cleanReason(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Give Point Reason #${index + 1} is invalid.`);
  const title = String(row.title ?? "").trim();
  const description = String(row.description ?? "").trim().slice(0, 220);
  const points = Math.trunc(Number(row.points));
  if (!title) throw new Error(`Give Point Reason #${index + 1} needs a title.`);
  if (!Number.isInteger(points) || points < 1) throw new Error(`Give Point Reason #${index + 1} needs a positive integer point value.`);
  return { title: title.slice(0, 80), description, points };
}

function cleanBenefit(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Redeem Benefit #${index + 1} is invalid.`);
  const name = String(row.name ?? "").trim();
  const description = String(row.description ?? "").trim();
  const cost = Math.trunc(Number(row.cost));
  if (!name) throw new Error(`Redeem Benefit #${index + 1} needs a name.`);
  if (!description) throw new Error(`Redeem Benefit #${index + 1} needs a description.`);
  if (!Number.isInteger(cost) || cost < 1) throw new Error(`Redeem Benefit #${index + 1} needs a positive integer cost.`);
  return { name: name.slice(0, 80), description: description.slice(0, 260), cost };
}

function legacyCategoriesToProfiles(categories) {
  const questions = categories.map((row, index) => cleanLegacyCategory(row, index));
  if (questions.length < 2 || questions.length > MAX_QUESTIONS) throw new Error(`Legacy Voting Categories must contain 2–${MAX_QUESTIONS} entries.`);
  return [{
    name: "Session Awards",
    allowSelfVoting: false,
    ballotVisibility: BALLOT_VISIBILITY.SECRET,
    questions
  }];
}

export class EcosystemTransferService {
  static schemaVersion = SCHEMA_VERSION;

  static build(type, config) {
    const validTypes = Object.values(ECOSYSTEM_EXPORT_TYPES);
    if (!validTypes.includes(type)) throw new Error("Unknown Polls, Points & Rewards export type.");
    const data = {};
    if (type === ECOSYSTEM_EXPORT_TYPES.ALL || type === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      data.votingProfiles = (config.votingProfiles ?? []).map((row, index) => cleanProfile(row, index));
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.ALL || type === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      data.givePointReasons = (config.giveReasons ?? []).map((row, index) => cleanReason(row, index));
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.ALL || type === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      data.redeemBenefits = (config.benefits ?? []).map((row, index) => cleanBenefit(row, index));
    }
    return {
      module: MODULE_ID,
      moduleVersion: MODULE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportType: type,
      exportedAt: new Date().toISOString(),
      data
    };
  }

  static parse(raw, expectedType = ECOSYSTEM_EXPORT_TYPES.ALL) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The selected file is not a valid Polls, Points & Rewards JSON export.");
    if (String(raw.module ?? "") !== MODULE_ID) throw new Error("This JSON file was not exported by Polls, Points & Rewards.");
    const schemaVersion = Math.trunc(Number(raw.schemaVersion));
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) throw new Error(`Unsupported Polls, Points & Rewards export schema: ${raw.schemaVersion ?? "unknown"}.`);
    const exportType = String(raw.exportType ?? "");
    const validTypes = [...Object.values(ECOSYSTEM_EXPORT_TYPES), LEGACY_VOTING_TYPE];
    if (!validTypes.includes(exportType)) throw new Error("The Polls, Points & Rewards export type is missing or invalid.");

    const isLegacyVoting = schemaVersion === 1 && (exportType === LEGACY_VOTING_TYPE || Array.isArray(raw.data?.votingCategories));
    const requestedVoting = expectedType === ECOSYSTEM_EXPORT_TYPES.VOTING;
    if (expectedType !== ECOSYSTEM_EXPORT_TYPES.ALL && exportType !== ECOSYSTEM_EXPORT_TYPES.ALL && exportType !== expectedType && !(requestedVoting && isLegacyVoting)) {
      throw new Error(`This file contains ${exportType}, not ${expectedType}.`);
    }
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL && exportType !== ECOSYSTEM_EXPORT_TYPES.ALL) {
      throw new Error("Import All requires an Export All Polls, Points & Rewards JSON file.");
    }

    const source = raw.data && typeof raw.data === "object" ? raw.data : {};
    const data = {};
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL || expectedType === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      if (Array.isArray(source.votingProfiles)) {
        data.votingProfiles = source.votingProfiles.map((row, index) => cleanProfile(row, index));
      } else if (Array.isArray(source.votingCategories)) {
        data.votingProfiles = legacyCategoriesToProfiles(source.votingCategories);
      } else {
        throw new Error("The export does not contain Voting Profiles.");
      }
      if (!data.votingProfiles.length) throw new Error("At least one Voting Profile is required.");
    }
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL || expectedType === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      if (!Array.isArray(source.givePointReasons)) throw new Error("The export does not contain Give Point Reasons.");
      data.givePointReasons = source.givePointReasons.map((row, index) => cleanReason(row, index));
    }
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL || expectedType === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      if (!Array.isArray(source.redeemBenefits)) throw new Error("The export does not contain Redeem Benefits.");
      data.redeemBenefits = source.redeemBenefits.map((row, index) => cleanBenefit(row, index));
    }
    return { exportType, schemaVersion, data, legacy: schemaVersion < SCHEMA_VERSION };
  }

  static merge(type, current, imported) {
    const uniqueAdditions = (rows, keyOf, initial) => {
      const seen = new Set(initial.map(keyOf));
      const additions = [];
      for (const row of rows) {
        const key = keyOf(row);
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(row);
      }
      return additions;
    };
    if (type === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      const keyOf = row => String(row.name).trim().toLowerCase();
      return [...current, ...uniqueAdditions(imported, keyOf, current)];
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      const keyOf = row => String(row.title).trim().toLowerCase();
      return [...current, ...uniqueAdditions(imported, keyOf, current)];
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      const keyOf = row => String(row.name).trim().toLowerCase();
      return [...current, ...uniqueAdditions(imported, keyOf, current)];
    }
    throw new Error("Merge requires a specific Polls, Points & Rewards configuration section.");
  }
}
