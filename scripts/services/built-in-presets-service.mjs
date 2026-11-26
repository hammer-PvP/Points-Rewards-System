import { MODULE_ID } from "../constants.mjs";
import { EcosystemTransferService, ECOSYSTEM_EXPORT_TYPES } from "./ecosystem-transfer-service.mjs";
import { randomId } from "../utils.mjs";

const BASE = `modules/${MODULE_ID}/data`;
const key = value => String(value ?? "").trim().toLocaleLowerCase();
const copy = value => foundry.utils.deepClone(value);

/** Data-only presets. Nothing is imported on module startup. */
export class BuiltInPresetsService {
  static async #readJson(path) {
    const response = await fetch(`${BASE}/presets/${path}`);
    if (!response.ok) throw new Error(`Could not load built-in preset (${response.status}).`);
    return response.json();
  }

  static async catalog() {
    const data = await this.#readJson("catalog.json");
    if (!Array.isArray(data?.presets)) throw new Error("Built-in preset catalog is invalid.");
    return data.presets;
  }

  static async get(presetId, catalog = null) {
    const entries = catalog ?? await this.catalog();
    const entry = entries.find(item => item.id === presetId);
    if (!entry || !/^[a-z0-9-]+$/i.test(entry.id) || entry.dataFile !== `${entry.id}.json`) {
      throw new Error("Unknown built-in preset.");
    }
    const parsed = EcosystemTransferService.parse(await this.#readJson(entry.dataFile), ECOSYSTEM_EXPORT_TYPES.ALL);
    return { entry, data: parsed.data };
  }

  static groups(config) {
    return (Array.isArray(config?.importedPresetGroups) ? config.importedPresetGroups : [])
      .filter(group => group && typeof group === "object" && group.id && group.name)
      .map(group => ({
        id: String(group.id), name: String(group.name),
        votingIds: Array.isArray(group.votingIds) ? group.votingIds.map(String) : [],
        reasonIds: Array.isArray(group.reasonIds) ? group.reasonIds.map(String) : [],
        benefitIds: Array.isArray(group.benefitIds) ? group.benefitIds.map(String) : []
      }));
  }

  static rename(groups, groupId, newName) {
    const name = String(newName ?? "").trim();
    if (!name || name.length > 100) throw new Error("Preset name must contain 1–100 characters.");
    if (groups.some(group => group.id !== groupId && key(group.name) === key(name))) {
      throw new Error("Another imported preset already has this name.");
    }
    const result = copy(groups);
    const found = result.find(group => group.id === groupId);
    if (!found) throw new Error("This imported preset was not found.");
    found.name = name;
    return result;
  }

  /** Remove stale membership after manual edits or JSON imports. Do not touch unrelated entries. */
  static prune(config) {
    const known = {
      votingIds: new Set((config.votingProfiles ?? []).map(row => row.id)),
      reasonIds: new Set((config.giveReasons ?? []).map(row => row.id)),
      benefitIds: new Set((config.benefits ?? []).map(row => row.id))
    };
    return this.groups(config).map(group => ({ ...group,
      votingIds: group.votingIds.filter(id => known.votingIds.has(id)),
      reasonIds: group.reasonIds.filter(id => known.reasonIds.has(id)),
      benefitIds: group.benefitIds.filter(id => known.benefitIds.has(id))
    }));
  }

  /**
   * Name-matched replacement replaces only the records owned by that imported group.
   * Editing/renaming an imported set does not lock its ordinary World records.
   * Source data has already passed the existing ecosystem schema validator.
   */
  static apply(config, importedData, presetName) {
    const name = String(presetName ?? "").trim();
    if (!name) throw new Error("A preset name is required.");
    const next = copy(config);
    next.votingProfiles = Array.isArray(next.votingProfiles) ? next.votingProfiles : [];
    next.giveReasons = Array.isArray(next.giveReasons) ? next.giveReasons : [];
    next.benefits = Array.isArray(next.benefits) ? next.benefits : [];
    const groups = this.groups(next);
    const previous = groups.find(group => key(group.name) === key(name)) ?? null;
    if (previous) {
      const votes = new Set(previous.votingIds), reasons = new Set(previous.reasonIds), benefits = new Set(previous.benefitIds);
      next.votingProfiles = next.votingProfiles.filter(row => !votes.has(row.id));
      next.giveReasons = next.giveReasons.filter(row => !reasons.has(row.id));
      next.benefits = next.benefits.filter(row => !benefits.has(row.id));
    } else if (!groups.length && next.votingProfiles.length === 1) {
      // Remove only the untouched virtual initial profile. Never delete a customized one.
      const first = next.votingProfiles[0];
      const defaultQuestions = first?.questions ?? [];
      if (first?.id === "session-awards" && first.name === "Session Awards" && defaultQuestions.length === 2 &&
        defaultQuestions.every((q, index) => q.id === `question-${index + 1}` && q.title === `Question ${index + 1}` && q.points === 1 && q.description === "Edit this voting question in Polls, Points & Rewards settings.")) {
        next.votingProfiles = [];
      }
    }
    const newProfiles = importedData.votingProfiles.map(profile => ({ ...copy(profile), id: randomId("profile"),
      questions: profile.questions.map(question => ({ ...copy(question), id: randomId("question"),
        options: (question.options ?? []).map(option => ({ ...copy(option), id: randomId("option") }))
      }))
    }));
    const newReasons = importedData.givePointReasons.map(row => ({ ...copy(row), id: randomId("reason") }));
    const newBenefits = importedData.redeemBenefits.map(row => ({ ...copy(row), id: randomId("benefit") }));
    next.votingProfiles.push(...newProfiles);
    next.giveReasons.push(...newReasons);
    next.benefits.push(...newBenefits);
    const group = {
      id: previous?.id ?? randomId("preset"), name,
      votingIds: newProfiles.map(row => row.id),
      reasonIds: newReasons.map(row => row.id),
      benefitIds: newBenefits.map(row => row.id)
    };
    next.importedPresetGroups = previous ? groups.map(item => item.id === previous.id ? group : item) : [...groups, group];
    return { config: next, group, replacing: Boolean(previous) };
  }
}
