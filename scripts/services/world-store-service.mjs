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

function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Pure JavaScript SHA-256 used only to verify legacy v0.0.2/v0.0.3 fingerprints.
// This avoids depending on WebCrypto availability in a browser, Foundry Desktop, HTTP, or HTTPS.
function sha256Legacy(text) {
  const bytes = new TextEncoder().encode(text);
  const words = [];
  const bitLength = bytes.length * 8;
  for (let i = 0; i < bytes.length; i += 1) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (24 - bitLength % 32));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < words.length; offset += 16) {
    const w = new Array(64);
    for (let i = 0; i < 16; i += 1) w[i] = words[offset + i] | 0;
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h = [
      (h[0] + a) | 0,(h[1] + b) | 0,(h[2] + c) | 0,(h[3] + d) | 0,
      (h[4] + e) | 0,(h[5] + f) | 0,(h[6] + g) | 0,(h[7] + hh) | 0
    ];
  }
  return h.map(value => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

function normalizeLedgerAccount(raw) {
  const account = raw && typeof raw === "object" ? clone(raw) : { balance: 0, ledger: [] };
  account.balance = Math.trunc(Number(account.balance) || 0);
  account.ledger = Array.isArray(account.ledger) ? account.ledger.filter(Boolean) : [];
  return account;
}

export class WorldStoreService {
  static INTEGRITY_ALGORITHM = "FNV-1A-32";

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
        if (!Object.prototype.hasOwnProperty.call(sub, "primaryUserNameSnapshot")) sub.primaryUserNameSnapshot = sub.primaryUserId ? userAccount.userNameSnapshot : "";
        sub.primaryUserNameSnapshot = String(sub.primaryUserNameSnapshot || "");
        if (!Object.prototype.hasOwnProperty.call(sub, "primaryUserSource")) sub.primaryUserSource = sub.primaryUserId ? "legacy-v0.0.2" : "pending";
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

  static fingerprintPayload(state, algorithm = this.INTEGRITY_ALGORITHM) {
    const payload = clone(state);
    payload.integrity = { algorithm, hash: "" };
    return stable(payload);
  }

  static fingerprint(state) {
    return fnv1a(this.fingerprintPayload(state, this.INTEGRITY_ALGORITHM));
  }

  static legacyFingerprint(state, expected) {
    const payload = this.fingerprintPayload(state, "SHA-256");
    if (String(expected).startsWith("fnv1a-")) return fnv1a(payload);
    return sha256Legacy(payload);
  }

  static async verify(state = null) {
    const persisted = state && typeof state === "object" ? clone(state) : this.raw();
    const expected = String(persisted.integrity?.hash || "");
    if (!expected) return { ok: true, missing: true, expected: "", actual: "", legacy: false };

    const storedAlgorithm = String(persisted.integrity?.algorithm || "").toUpperCase();
    const isCurrent = storedAlgorithm === this.INTEGRITY_ALGORITHM || storedAlgorithm === "FNV1A-32";
    const actual = isCurrent ? this.fingerprint(persisted) : this.legacyFingerprint(persisted, expected);
    return { ok: expected === actual, missing: false, expected, actual, legacy: !isCurrent, algorithm: storedAlgorithm || "LEGACY" };
  }

  static async save(nextState, { backup = true } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can write Polls, Points & Rewards world data.");
    const rawCurrent = this.raw();
    const currentCheck = await this.verify(rawCurrent);
    if (!currentCheck.ok) throw new Error("Polls, Points & Rewards blocked a write because the current World data failed its integrity check. The previous backup is still available.");
    const current = this.normalize(rawCurrent);
    const requestedRevision = Math.max(0, Math.trunc(Number(nextState?.revision) || 0));
    if (requestedRevision !== current.revision) throw new Error(`Polls, Points & Rewards blocked a stale World-data write (expected revision ${current.revision}, received ${requestedRevision}). Reopen the window and try again.`);

    const state = this.normalize(nextState);
    state.revision = current.revision + 1;
    state.updatedAt = Date.now();
    state.updatedBy = String(game.user.id || "");
    state.integrity = { algorithm: this.INTEGRITY_ALGORITHM, hash: "" };
    state.integrity.hash = this.fingerprint(state);
    if (backup) await game.settings.set(MODULE_ID, "worldStateBackup", rawCurrent);
    await game.settings.set(MODULE_ID, "worldState", state);
    const rereadRaw = this.raw();
    const check = await this.verify(rereadRaw);
    if (!check.ok) throw new Error("Polls, Points & Rewards world data failed its post-write integrity check.");
    return this.normalize(rereadRaw);
  }

  static async initialize() {
    if (!game.user?.isGM) return { ok: true, skipped: true };
    const raw = this.raw();
    const check = await this.verify(raw);
    if (!check.ok) {
      console.error(`${MODULE_ID} | World-state integrity mismatch.`, check);
      ui.notifications.error("Polls, Points & Rewards detected a world-data integrity mismatch. The previous backup was preserved; avoid point changes until the data is reviewed.", { permanent: true });
      return { ok: false, check };
    }
    const storedSchema = Math.max(0, Math.trunc(Number(raw.schemaVersion) || 0));
    const normalized = this.normalize(raw);
    const needsPortableFingerprint = check.legacy || String(raw.integrity?.algorithm || "").toUpperCase() !== this.INTEGRITY_ALGORITHM;
    if (check.missing || storedSchema < WORLD_SCHEMA_VERSION || needsPortableFingerprint) {
      const saved = await this.save(normalized, { backup: true });
      return { ok: true, check, upgraded: storedSchema < WORLD_SCHEMA_VERSION || needsPortableFingerprint, state: saved };
    }
    return { ok: true, check, upgraded: false, state: normalized };
  }
}
