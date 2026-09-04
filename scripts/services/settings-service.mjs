import {
  DEFAULT_BENEFIT,
  DEFAULT_REASON,
  MAX_CATEGORIES,
  MIN_CATEGORIES,
  MODULE_ID,
  POINT_METHODS,
  defaultConfig,
  defaultRuntime
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
  }

  static get() {
    return foundry.utils.mergeObject(defaultConfig(), game.settings.get(MODULE_ID, "config") ?? {}, { inplace: false });
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

  static normalize(config) {
    const merged = foundry.utils.mergeObject(defaultConfig(), config ?? {}, { inplace: false });
    merged.actorFolderId = String(merged.actorFolderId ?? "");
    merged.pointMethod = merged.pointMethod === POINT_METHODS.ACCOUNT ? POINT_METHODS.ACCOUNT : POINT_METHODS.CHARACTER;
    merged.allowSelfVoting = merged.allowSelfVoting === true;
    merged.allowNegativeBalance = merged.allowNegativeBalance === true;
    merged.postVotingResultsToChat = merged.postVotingResultsToChat !== false;
    merged.showSheetPoints = merged.showSheetPoints !== false;

    merged.categories = (Array.isArray(merged.categories) ? merged.categories : [])
      .slice(0, MAX_CATEGORIES)
      .map((row, index) => ({
        id: String(row.id || `category-${index + 1}`),
        title: String(row.title || `Category ${index + 1}`).trim(),
        shortLabel: String(row.shortLabel || `CAT ${index + 1}`).trim().slice(0, 12),
        description: String(row.description || "").trim(),
        points: Math.max(1, Math.trunc(Number(row.points) || 1))
      }));
    while (merged.categories.length < MIN_CATEGORIES) {
      const index = merged.categories.length;
      merged.categories.push({
        id: `category-${index + 1}`,
        title: `Category ${index + 1}`,
        shortLabel: `CAT ${index + 1}`,
        description: "Edit this voting category in Points & Rewards System settings.",
        points: 1
      });
    }

    merged.giveReasons = (Array.isArray(merged.giveReasons) ? merged.giveReasons : [])
      .filter(row => row && String(row.title ?? "").trim())
      .map(row => ({
        id: String(row.id || foundry.utils.randomID()),
        title: String(row.title).trim(),
        description: String(row.description ?? "").trim(),
        points: Math.max(1, Math.trunc(Number(row.points) || 1))
      }));

    merged.benefits = (Array.isArray(merged.benefits) ? merged.benefits : [])
      .filter(row => row && String(row.name ?? "").trim() && String(row.description ?? "").trim())
      .map(row => ({
        id: String(row.id || foundry.utils.randomID()),
        name: String(row.name).trim(),
        description: String(row.description).trim(),
        cost: Math.max(1, Math.trunc(Number(row.cost) || 1))
      }));
    return merged;
  }
}
