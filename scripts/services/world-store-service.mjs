import { MODULE_ID, WORLD_SCHEMA_VERSION, defaultWorldState } from "../constants.mjs";

function clone(value) {
  return foundry.utils.deepClone(value);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text) {
  try {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  } catch (_error) {
    // Integrity fingerprints are an additional corruption detector, never the only source of truth.
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
}

export class WorldStoreService {
  static normalize(raw) {
    const base = defaultWorldState();
    const state = foundry.utils.mergeObject(base, raw && typeof raw === "object" ? clone(raw) : {}, { inplace: false });
    state.schemaVersion = WORLD_SCHEMA_VERSION;
    state.revision = Math.max(0, Math.trunc(Number(state.revision) || 0));
    state.updatedAt = Math.max(0, Number(state.updatedAt) || 0);
    state.updatedBy = String(state.updatedBy || "");
    state.userAccounts = state.userAccounts && typeof state.userAccounts === "object" ? state.userAccounts : {};
    state.migrationArchives = Array.isArray(state.migrationArchives) ? state.migrationArchives.slice(-50) : [];
    state.closedAccounts = Array.isArray(state.closedAccounts) ? state.closedAccounts.slice(-500) : [];
    state.migrations = state.migrations && typeof state.migrations === "object" ? state.migrations : base.migrations;
    state.integrity = state.integrity && typeof state.integrity === "object" ? state.integrity : base.integrity;
    return state;
  }

  static get() {
    return this.normalize(game.settings.get(MODULE_ID, "worldState") ?? {});
  }

  static backup() {
    return this.normalize(game.settings.get(MODULE_ID, "worldStateBackup") ?? {});
  }

  static fingerprintPayload(state) {
    const payload = clone(state);
    payload.integrity = { algorithm: "SHA-256", hash: "" };
    return stable(payload);
  }

  static async fingerprint(state) {
    return sha256(this.fingerprintPayload(state));
  }

  static async verify(state = this.get()) {
    const expected = String(state.integrity?.hash || "");
    if (!expected) return { ok: true, missing: true, expected: "", actual: "" };
    const actual = await this.fingerprint(state);
    return { ok: expected === actual, missing: false, expected, actual };
  }

  static async save(nextState, { backup = true } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can write Points & Rewards world data.");
    const current = this.get();
    const currentCheck = await this.verify(current);
    if (!currentCheck.ok) throw new Error("Points & Rewards blocked a write because the current World data failed its integrity check. The previous backup is still available.");
    const requestedRevision = Math.max(0, Math.trunc(Number(nextState?.revision) || 0));
    if (requestedRevision !== current.revision) {
      throw new Error(`Points & Rewards blocked a stale World-data write (expected revision ${current.revision}, received ${requestedRevision}). Reopen the window and try again.`);
    }
    const state = this.normalize(nextState);
    state.revision = current.revision + 1;
    state.updatedAt = Date.now();
    state.updatedBy = String(game.user.id || "");
    state.integrity = { algorithm: "SHA-256", hash: "" };
    state.integrity.hash = await this.fingerprint(state);
    if (backup) await game.settings.set(MODULE_ID, "worldStateBackup", current);
    await game.settings.set(MODULE_ID, "worldState", state);
    const reread = this.get();
    const check = await this.verify(reread);
    if (!check.ok) throw new Error("Points & Rewards world data failed its post-write integrity check.");
    return reread;
  }

  static async initialize() {
    if (!game.user?.isGM) return { ok: true, skipped: true };
    const state = this.get();
    const check = await this.verify(state);
    if (!check.ok) {
      console.error(`${MODULE_ID} | World-state integrity mismatch.`, check);
      ui.notifications.error("Points & Rewards detected a world-data integrity mismatch. The previous backup was preserved; avoid point changes until the data is reviewed.", { permanent: true });
      return { ok: false, check };
    }
    if (check.missing) {
      // First v0.0.2 write establishes a fingerprint without changing account content.
      await this.save(state, { backup: false });
    }
    return { ok: true, check };
  }
}
