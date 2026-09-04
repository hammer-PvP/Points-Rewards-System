import { MAX_CATEGORIES, MIN_CATEGORIES, MODULE_ID, MODULE_VERSION } from "../constants.mjs";

export const ECOSYSTEM_EXPORT_TYPES = Object.freeze({
  ALL: "all",
  VOTING: "voting-categories",
  REASONS: "give-point-reasons",
  BENEFITS: "redeem-benefits"
});

const SCHEMA_VERSION = 1;

function cleanCategory(row, index = 0) {
  if (!row || typeof row !== "object") throw new Error(`Voting category #${index + 1} is invalid.`);
  const title = String(row.title ?? "").trim();
  const shortLabel = String(row.shortLabel ?? "").trim().slice(0, 12);
  const description = String(row.description ?? "").trim().slice(0, 220);
  const points = Math.trunc(Number(row.points));
  if (!title) throw new Error(`Voting category #${index + 1} needs a title.`);
  if (!shortLabel) throw new Error(`Voting category #${index + 1} needs a short label.`);
  if (!Number.isInteger(points) || points < 1) throw new Error(`Voting category #${index + 1} needs a positive integer point value.`);
  return { title: title.slice(0, 80), shortLabel, description, points };
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

export class EcosystemTransferService {
  static schemaVersion = SCHEMA_VERSION;

  static build(type, config) {
    const validTypes = Object.values(ECOSYSTEM_EXPORT_TYPES);
    if (!validTypes.includes(type)) throw new Error("Unknown Points & Rewards export type.");
    const data = {};
    if (type === ECOSYSTEM_EXPORT_TYPES.ALL || type === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      data.votingCategories = (config.categories ?? []).map((row, index) => cleanCategory(row, index));
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
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The selected file is not a valid Points & Rewards JSON export.");
    if (String(raw.module ?? "") !== MODULE_ID) throw new Error("This JSON file was not exported by Points & Rewards System.");
    const schemaVersion = Math.trunc(Number(raw.schemaVersion));
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) throw new Error(`Unsupported Points & Rewards export schema: ${raw.schemaVersion ?? "unknown"}.`);
    const exportType = String(raw.exportType ?? "");
    const validTypes = Object.values(ECOSYSTEM_EXPORT_TYPES);
    if (!validTypes.includes(exportType)) throw new Error("The Points & Rewards export type is missing or invalid.");
    if (expectedType !== ECOSYSTEM_EXPORT_TYPES.ALL && exportType !== ECOSYSTEM_EXPORT_TYPES.ALL && exportType !== expectedType) {
      throw new Error(`This file contains ${exportType}, not ${expectedType}.`);
    }
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL && exportType !== ECOSYSTEM_EXPORT_TYPES.ALL) {
      throw new Error("Import All requires an Export All Points & Rewards JSON file.");
    }

    const source = raw.data && typeof raw.data === "object" ? raw.data : {};
    const data = {};
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL || expectedType === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      if (!Array.isArray(source.votingCategories)) throw new Error("The export does not contain Voting Categories.");
      data.votingCategories = source.votingCategories.map((row, index) => cleanCategory(row, index));
      if (data.votingCategories.length < MIN_CATEGORIES || data.votingCategories.length > MAX_CATEGORIES) throw new Error(`Voting Categories must contain ${MIN_CATEGORIES}–${MAX_CATEGORIES} entries.`);
    }
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL || expectedType === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      if (!Array.isArray(source.givePointReasons)) throw new Error("The export does not contain Give Point Reasons.");
      data.givePointReasons = source.givePointReasons.map((row, index) => cleanReason(row, index));
    }
    if (expectedType === ECOSYSTEM_EXPORT_TYPES.ALL || expectedType === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      if (!Array.isArray(source.redeemBenefits)) throw new Error("The export does not contain Redeem Benefits.");
      data.redeemBenefits = source.redeemBenefits.map((row, index) => cleanBenefit(row, index));
    }
    return { exportType, schemaVersion, data };
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
      const keyOf = row => `${String(row.title).trim().toLowerCase()}\u0000${String(row.shortLabel).trim().toLowerCase()}`;
      const additions = uniqueAdditions(imported, keyOf, current);
      if (current.length + additions.length > MAX_CATEGORIES) throw new Error(`Merge would create ${current.length + additions.length} voting categories. The maximum is ${MAX_CATEGORIES}.`);
      return [...current, ...additions];
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      const keyOf = row => String(row.title).trim().toLowerCase();
      return [...current, ...uniqueAdditions(imported, keyOf, current)];
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      const keyOf = row => String(row.name).trim().toLowerCase();
      return [...current, ...uniqueAdditions(imported, keyOf, current)];
    }
    throw new Error("Merge requires a specific Points & Rewards configuration section.");
  }
}
