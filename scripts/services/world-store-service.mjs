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

function normalizeLedgerAccount(raw) {
  const account = raw && typeof raw === "object" ? clone(raw) : { balance: 0, ledger: [] };
  account.balance = Math.trunc(Number(account.balance) || 0);
  account.ledger = Array.isArray(account.ledger) ? account.ledger.filter(Boolean) : [];
  return account;
}

export class WorldStoreService {
  static raw() {
    const raw = game.settings.get(MODULE_ID, "worldState");
    return raw && typeof raw === "object" ? clone(raw) : {};
  }

  static normalize(raw) {
    const base = defaultWorldState();
    const state = foundry.utils.mergeObject(base, raw && typeof raw === "object" ? clone(raw) : {}, { inplace: false });
    state.schemaVersion = WORLD_SCHEMA_VERSION;
    state.revision = Math.max(0, Math.trunc(Number(state.revision) || 0));
    state.updatedAt = Math.max(0, Number(state.updatedAt) || 0);
    state.updatedBy = String(state.updatedBy || "");
    state.userAccounts = state.userAccounts && typeof state.userAccounts === "object" ? state.userAccounts : {};
    state.identityChanges = Array.isArray(state.identityChanges) ? state.identityChanges.slice(-500) : [];
    state.migrationArchives = Array.isArray(state.migrationArchives) ? state.migrationArchives.slice(-50) : [];
    state.closedAccounts = Array.isArray(state.closedAccounts) ? state.closedAccounts.slice(-500) : [];
    state.migrations = state.migrations && typeof state.migrations === "object" ? state.migrations : base.migrations;
    state.integrity = state.integrity && typeof state.integrity === "object" ? state.integrity : base.integrity;

    // v0.0.3 schema normalization freezes the User association that existed in v0.0.2.
    // Future Foundry ownership changes never alter this Primary User implicitly.
    for (const userAccount of Object.values(state.userAccounts)) {
      if (!userAccount || typeof userAccount !== "object") continue;
      userAccount.linkedUserId = String(userAccount.linkedUserId || "");
      userAccount.userNameSnapshot = String(userAccount.userNameSnapshot || "Unknown User");
      userAccount.syntheticForActorId = String(userAccount.syntheticForActorId || "");
      userAccount.shared = normalizeLedgerAccount(userAccount.shared);
      userAccount.actorSubaccounts = userAccount.actorSubaccounts && typeof userAccount.actorSubaccounts === "object" ? userAccount.actorSubaccounts : {};
      for (const sub of Object.values(userAccount.actorSubaccounts)) {
        if (!sub || typeof sub !== "object") continue;
        sub.linkedActorId = String(sub.linkedActorId || "");
        sub.actorNameSnapshot = String(sub.actorNameSnapshot || "Unknown Actor");
        sub.actorUuidSnapshot = String(sub.actorUuidSnapshot || (sub.linkedActorId ? `Actor.${sub.linkedActorId}` : ""));
        sub.account = normalizeLedgerAccount(sub.account);
        if (!Object.prototype.hasOwnProperty.call(sub, "primaryUserId")) sub.primaryUserId = userAccount.linkedUserId || "";
        sub.primaryUserId = String(sub.primaryUserId || "");
        if (!Object.prototype.hasOwnProperty.call(sub, "primaryUserNameSnapshot")) {
          sub.primaryUserNameSnapshot = sub.primaryUserId ? userAccount.userNameSnapshot : "";
        }
        sub.primaryUserNameSnapshot = String(sub.primaryUserNameSnapshot || "");
        if (!Object.prototype.hasOwnProperty.call(sub, "primaryUserSource")) {
          sub.primaryUserSource = sub.primaryUserId ? "legacy-v0.0.2" : "pending";
        }
        sub.primaryUserSource = String(sub.primaryUserSource || "pending");
        sub.primaryUserUpdatedAt = Math.max(0, Number(sub.primaryUserUpdatedAt) || sub.createdAt || 0);
        sub.primaryUserUpdatedBy = String(sub.primaryUserUpdatedBy || "");
      }
    }
    return state;
  }

  static get() {
    return this.normalize(this.raw());
  }

  static backup() {
    const raw = game.settings.get(MODULE_ID, "worldStateBackup");
    return this.normalize(raw ?? {});
  }

  static fingerprintPayload(state) {
    const payload = clone(state);
    payload.integrity = { algorithm: "SHA-256", hash: "" };
    return stable(payload);
  }

  static async fingerprint(state) {
    return sha256(this.fingerprintPayload(state));
  }

  static async verify(state = null) {
    // Verify the exact persisted shape. This is important during schema upgrades: normalizing
    // an older valid state must not make its previous fingerprint look corrupt.
    const persisted = state && typeof state === "object" ? clone(state) : this.raw();
    const expected = String(persisted.integrity?.hash || "");
    if (!expected) return { ok: true, missing: true, expected: "", actual: "" };
    const actual = await this.fingerprint(persisted);
    return { ok: expected === actual, missing: false, expected, actual };
  }

  static async save(nextState, { backup = true } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can write Points & Rewards world data.");
    const rawCurrent = this.raw();
    const currentCheck = await this.verify(rawCurrent);
    if (!currentCheck.ok) throw new Error("Points & Rewards blocked a write because the current World data failed its integrity check. The previous backup is still available.");
    const current = this.normalize(rawCurrent);
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
    if (backup) await game.settings.set(MODULE_ID, "worldStateBackup", rawCurrent);
    await game.settings.set(MODULE_ID, "worldState", state);
    const rereadRaw = this.raw();
    const check = await this.verify(rereadRaw);
    if (!check.ok) throw new Error("Points & Rewards world data failed its post-write integrity check.");
    return this.normalize(rereadRaw);
  }

  static async initialize() {
    if (!game.user?.isGM) return { ok: true, skipped: true };
    const raw = this.raw();
    const check = await this.verify(raw);
    if (!check.ok) {
      console.error(`${MODULE_ID} | World-state integrity mismatch.`, check);
      ui.notifications.error("Points & Rewards detected a world-data integrity mismatch. The previous backup was preserved; avoid point changes until the data is reviewed.", { permanent: true });
      return { ok: false, check };
    }
    const storedSchema = Math.max(0, Math.trunc(Number(raw.schemaVersion) || 0));
    const normalized = this.normalize(raw);
    if (check.missing || storedSchema < WORLD_SCHEMA_VERSION) {
      // Establish the current schema/fingerprint while preserving the exact prior persisted state as backup.
      const saved = await this.save(normalized, { backup: true });
      return { ok: true, check, upgraded: storedSchema < WORLD_SCHEMA_VERSION, state: saved };
    }
    return { ok: true, check, upgraded: false, state: normalized };
  }
}
