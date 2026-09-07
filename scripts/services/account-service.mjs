import { MODULE_ID, OWNER_LEVEL, POINT_METHODS } from "../constants.mjs";
import { SettingsService } from "./settings-service.mjs";
import { WorldStoreService } from "./world-store-service.mjs";
import { actorFolderActors, formatDateTime, randomId } from "../utils.mjs";

function emptyLedgerAccount() {
  return { balance: 0, ledger: [] };
}

function normalizeLedgerAccount(raw) {
  const account = raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : emptyLedgerAccount();
  account.balance = Math.trunc(Number(account.balance) || 0);
  account.ledger = Array.isArray(account.ledger) ? account.ledger.filter(Boolean) : [];
  return account;
}

function ledgerSum(account) {
  return (account?.ledger ?? []).reduce((sum, entry) => sum + Math.trunc(Number(entry?.delta) || 0), 0);
}

function reconcileImportedAccount(raw, { title = "Legacy Balance Import", description = "Imported from Points & Rewards System v0.0.1 document flags." } = {}) {
  const account = normalizeLedgerAccount(raw);
  const sum = ledgerSum(account);
  if (sum !== account.balance) {
    const delta = account.balance - sum;
    account.ledger.push({
      id: randomId("legacy"), timestamp: Date.now(), delta, before: sum, after: account.balance,
      type: "migration", title, description, sourceId: randomId("legacy-source"), batchId: "",
      actorId: "", actorName: "", userId: "", userName: "", createdBy: game.user?.id ?? ""
    });
  }
  return account;
}

function currentUserName(userId, fallback = "Unknown User") {
  return game.users.get(userId)?.name ?? fallback;
}

function currentActorName(actorId, fallback = "Unknown Actor") {
  return game.actors.get(actorId)?.name ?? fallback;
}

export class AccountService {
  static configuredActors(config = SettingsService.get()) {
    return actorFolderActors(config.actorFolderId);
  }

  static nonGMOwners(actor) {
    if (!actor) return [];
    const ownership = actor.ownership ?? {};
    return game.users
      .filter(user => !user.isGM && Number(ownership[user.id] ?? 0) >= OWNER_LEVEL)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static #findUserAccountByUserId(state, userId) {
    if (!userId) return null;
    return Object.values(state.userAccounts ?? {}).find(account => account?.linkedUserId === userId) ?? null;
  }

  static #findSubaccountByActorId(state, actorId) {
    if (!actorId) return null;
    for (const userAccount of Object.values(state.userAccounts ?? {})) {
      for (const sub of Object.values(userAccount?.actorSubaccounts ?? {})) {
        if (sub?.linkedActorId === actorId) return { userAccount, sub };
      }
    }
    return null;
  }

  static #inferInitialPrimaryUser(actor) {
    if (!actor) return null;
    const legacyExplicitId = String(actor.getFlag?.(MODULE_ID, "accountUserId") ?? "");
    const legacyExplicit = legacyExplicitId ? game.users.get(legacyExplicitId) : null;
    if (legacyExplicit && !legacyExplicit.isGM) return legacyExplicit;
    const owners = this.nonGMOwners(actor);
    return owners.length === 1 ? owners[0] : null;
  }

  static primaryUser(actor, state = WorldStoreService.get()) {
    if (!actor) return null;
    const linked = this.#findSubaccountByActorId(state, actor.id);
    if (linked) {
      const primaryId = String(linked.sub?.primaryUserId || "");
      const user = primaryId ? game.users.get(primaryId) : null;
      return user && !user.isGM ? user : null;
    }
    return this.#inferInitialPrimaryUser(actor);
  }

  // Backward-compatible alias used by older internal surfaces. In v0.0.3 this means
  // Points & Rewards Primary User, not transient Foundry ownership.
  static accountOwner(actor) {
    return this.primaryUser(actor);
  }

  static #newUserAccount(user = null, { syntheticForActor = null } = {}) {
    return {
      id: randomId("prs-user"),
      linkedUserId: user?.id ?? "",
      userNameSnapshot: user?.name ?? (syntheticForActor ? `Unassigned — ${syntheticForActor.name}` : "Unassigned User"),
      syntheticForActorId: syntheticForActor?.id ?? "",
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      shared: emptyLedgerAccount(),
      actorSubaccounts: {}
    };
  }

  static #newSubaccount(actor, primaryUser = null, source = primaryUser ? "auto" : "pending") {
    return {
      id: randomId("prs-actor"),
      linkedActorId: actor?.id ?? "",
      actorNameSnapshot: actor?.name ?? "Unknown Actor",
      actorUuidSnapshot: actor?.uuid ?? (actor?.id ? `Actor.${actor.id}` : ""),
      primaryUserId: primaryUser?.id ?? "",
      primaryUserNameSnapshot: primaryUser?.name ?? "",
      primaryUserSource: source,
      primaryUserUpdatedAt: Date.now(),
      primaryUserUpdatedBy: String(game.user?.id ?? ""),
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      account: emptyLedgerAccount()
    };
  }

  static #ensureUserAccount(state, user = null, { actor = null } = {}) {
    if (user) {
      let account = this.#findUserAccountByUserId(state, user.id);
      if (!account) {
        account = this.#newUserAccount(user);
        state.userAccounts[account.id] = account;
      }
      account.userNameSnapshot = user.name;
      account.lastSeenAt = Date.now();
      account.shared = normalizeLedgerAccount(account.shared);
      account.actorSubaccounts = account.actorSubaccounts && typeof account.actorSubaccounts === "object" ? account.actorSubaccounts : {};
      return account;
    }

    if (actor) {
      const existing = Object.values(state.userAccounts).find(account => account?.syntheticForActorId === actor.id);
      if (existing) return existing;
      const account = this.#newUserAccount(null, { syntheticForActor: actor });
      state.userAccounts[account.id] = account;
      return account;
    }
    return null;
  }

  static #ensureSubaccount(state, actor, primaryUser = undefined) {
    let found = this.#findSubaccountByActorId(state, actor.id);
    if (found) {
      found.sub.actorNameSnapshot = actor.name;
      found.sub.actorUuidSnapshot = actor.uuid ?? `Actor.${actor.id}`;
      found.sub.lastSeenAt = Date.now();
      found.sub.account = normalizeLedgerAccount(found.sub.account);
      // Once a Primary User exists, transient Foundry ownership changes must never re-home it.
      return found;
    }
    const inferred = primaryUser === undefined ? this.#inferInitialPrimaryUser(actor) : primaryUser;
    const userAccount = this.#ensureUserAccount(state, inferred, { actor });
    const source = inferred ? "auto" : "pending";
    const sub = this.#newSubaccount(actor, inferred, source);
    userAccount.actorSubaccounts[sub.id] = sub;
    return { userAccount, sub };
  }

  static async rememberParticipation(actor) {
    if (!actor || !game.user?.isGM) return;
    const state = WorldStoreService.get();
    const before = this.#findSubaccountByActorId(state, actor.id);
    const found = this.#ensureSubaccount(state, actor);
    if (!before && found.sub.primaryUserId) {
      this.#recordIdentityChange(state, actor, found.sub, {
        oldUserId: "",
        oldUserName: "",
        newUserId: found.sub.primaryUserId,
        newUserName: found.sub.primaryUserNameSnapshot,
        source: "auto"
      });
    }
    await WorldStoreService.save(state);
  }

  static #recordIdentityChange(state, actor, sub, { oldUserId = "", oldUserName = "", newUserId = "", newUserName = "", source = "gm" } = {}) {
    state.identityChanges = Array.isArray(state.identityChanges) ? state.identityChanges : [];
    state.identityChanges.push({
      id: randomId("identity"),
      timestamp: Date.now(),
      actorId: actor?.id ?? sub?.linkedActorId ?? "",
      actorNameSnapshot: actor?.name ?? sub?.actorNameSnapshot ?? "Unknown Actor",
      actorSubaccountId: sub?.id ?? "",
      oldUserId: String(oldUserId || ""),
      oldUserNameSnapshot: String(oldUserName || ""),
      newUserId: String(newUserId || ""),
      newUserNameSnapshot: String(newUserName || ""),
      source: String(source || "gm"),
      changedBy: String(game.user?.id ?? "")
    });
    state.identityChanges = state.identityChanges.slice(-500);
  }

  static #cleanupSyntheticAccount(state, userAccount) {
    if (!userAccount?.syntheticForActorId) return;
    const noSubs = !Object.keys(userAccount.actorSubaccounts ?? {}).length;
    const noShared = normalizeLedgerAccount(userAccount.shared).balance === 0;
    if (noSubs && noShared) delete state.userAccounts[userAccount.id];
  }

  static #rehomeSubaccount(state, found, actor, primaryUser) {
    const sourceAccount = found.userAccount;
    const targetAccount = primaryUser
      ? this.#ensureUserAccount(state, primaryUser)
      : this.#ensureUserAccount(state, null, { actor });
    if (sourceAccount.id !== targetAccount.id) {
      delete sourceAccount.actorSubaccounts[found.sub.id];
      targetAccount.actorSubaccounts[found.sub.id] = found.sub;
      this.#cleanupSyntheticAccount(state, sourceAccount);
    }
    return { userAccount: targetAccount, sub: found.sub };
  }

  static async ensureConfiguredPrimaryUsers(config = SettingsService.get()) {
    if (!game.user?.isGM) return { changed: false, assigned: 0, pending: 0 };
    const state = WorldStoreService.get();
    let changed = false;
    let assigned = 0;
    let pending = 0;

    for (const actor of this.configuredActors(config)) {
      let found = this.#findSubaccountByActorId(state, actor.id);
      if (!found) {
        const inferred = this.#inferInitialPrimaryUser(actor);
        found = this.#ensureSubaccount(state, actor, inferred);
        changed = true;
        if (inferred) {
          assigned += 1;
          this.#recordIdentityChange(state, actor, found.sub, { newUserId: inferred.id, newUserName: inferred.name, source: "auto" });
        } else pending += 1;
        continue;
      }

      found.sub.actorNameSnapshot = actor.name;
      found.sub.actorUuidSnapshot = actor.uuid ?? `Actor.${actor.id}`;
      found.sub.lastSeenAt = Date.now();
      if (!found.sub.primaryUserId && found.sub.primaryUserSource === "pending") {
        const inferred = this.#inferInitialPrimaryUser(actor);
        if (inferred) {
          found = this.#rehomeSubaccount(state, found, actor, inferred);
          found.sub.primaryUserId = inferred.id;
          found.sub.primaryUserNameSnapshot = inferred.name;
          found.sub.primaryUserSource = "auto";
          found.sub.primaryUserUpdatedAt = Date.now();
          found.sub.primaryUserUpdatedBy = String(game.user.id || "");
          this.#recordIdentityChange(state, actor, found.sub, { newUserId: inferred.id, newUserName: inferred.name, source: "auto" });
          changed = true;
          assigned += 1;
        } else pending += 1;
      }
    }

    if (changed) await WorldStoreService.save(state);
    return { changed, assigned, pending };
  }

  static normalizationRows(config = SettingsService.get()) {
    const state = WorldStoreService.get();
    return this.configuredActors(config).map(actor => {
      const owners = this.nonGMOwners(actor);
      const found = this.#findSubaccountByActorId(state, actor.id);
      const primaryUserId = String(found?.sub?.primaryUserId || "");
      const primary = primaryUserId ? game.users.get(primaryUserId) : null;
      const snapshot = String(found?.sub?.primaryUserNameSnapshot || "");
      let status = "Normalized";
      let statusKey = "normalized";
      if (primaryUserId && !primary) { status = "Missing User"; statusKey = "missing"; }
      else if (!primaryUserId && owners.length > 1) { status = "Multiple Owners"; statusKey = "multiple"; }
      else if (!primaryUserId) { status = "Unassigned"; statusKey = "unassigned"; }
      return {
        actorId: actor.id,
        actorName: actor.name,
        actorImg: actor.img ?? "icons/svg/mystery-man.svg",
        owners: owners.map(user => user.name),
        ownersLabel: owners.map(user => user.name).join(", ") || "No non-GM Owners",
        ownerCount: owners.length,
        primaryUserId,
        primaryUserName: (primary?.name ?? snapshot) || "Unassigned",
        missingPrimaryUser: Boolean(primaryUserId && !primary),
        status,
        statusKey
      };
    });
  }

  static primaryAssignmentPreview(assignments = {}) {
    const state = WorldStoreService.get();
    const changes = [];
    for (const [actorId, desiredIdRaw] of Object.entries(assignments ?? {})) {
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      const found = this.#findSubaccountByActorId(state, actor.id);
      const oldId = String(found?.sub?.primaryUserId || "");
      const desiredId = String(desiredIdRaw || "");
      if (oldId === desiredId) continue;
      const oldName = oldId ? (game.users.get(oldId)?.name ?? found?.sub?.primaryUserNameSnapshot ?? "Missing User") : "Unassigned";
      const newName = desiredId ? (game.users.get(desiredId)?.name ?? "Missing User") : "Unassigned";
      changes.push({ actorId, actorName: actor.name, oldUserId: oldId, oldUserName: oldName, newUserId: desiredId, newUserName: newName });
    }
    return changes;
  }

  static async applyPrimaryAssignments(assignments = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can change Primary User assignments.");
    const state = WorldStoreService.get();
    const changes = [];

    for (const [actorId, desiredIdRaw] of Object.entries(assignments ?? {})) {
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      const desiredId = String(desiredIdRaw || "");
      const desiredUser = desiredId ? game.users.get(desiredId) : null;
      if (desiredId && (!desiredUser || desiredUser.isGM)) throw new Error(`Primary User for ${actor.name} must be an existing non-GM User.`);

      let found = this.#findSubaccountByActorId(state, actor.id);
      if (!found) found = this.#ensureSubaccount(state, actor, undefined);
      const oldId = String(found.sub.primaryUserId || "");
      if (oldId === desiredId) continue;
      const oldName = oldId ? (game.users.get(oldId)?.name ?? found.sub.primaryUserNameSnapshot ?? "Missing User") : "Unassigned";
      const newName = desiredUser?.name ?? "Unassigned";

      found = this.#rehomeSubaccount(state, found, actor, desiredUser);
      found.sub.primaryUserId = desiredUser?.id ?? "";
      found.sub.primaryUserNameSnapshot = desiredUser?.name ?? "";
      found.sub.primaryUserSource = desiredUser ? "gm" : "gm-unassigned";
      found.sub.primaryUserUpdatedAt = Date.now();
      found.sub.primaryUserUpdatedBy = String(game.user.id || "");
      this.#recordIdentityChange(state, actor, found.sub, { oldUserId: oldId, oldUserName: oldName, newUserId: desiredId, newUserName: newName, source: "gm" });
      changes.push({ actorId: actor.id, actorName: actor.name, oldUserId: oldId, oldUserName: oldName, newUserId: desiredId, newUserName: newName });
    }

    if (changes.length) {
      await WorldStoreService.save(state);
      Hooks.callAll(`${MODULE_ID}.primaryUsersChanged`, { changes });
    }
    return changes;
  }

  static hasWorldAccount(actor) {
    if (!actor) return false;
    return Boolean(this.#findSubaccountByActorId(WorldStoreService.get(), actor.id));
  }

  static trackedActors() {
    const current = new Map(this.configuredActors().map(actor => [actor.id, actor]));
    const state = WorldStoreService.get();
    for (const userAccount of Object.values(state.userAccounts)) {
      for (const sub of Object.values(userAccount.actorSubaccounts ?? {})) {
        const actor = game.actors.get(sub.linkedActorId);
        if (actor) current.set(actor.id, actor);
      }
    }
    // Legacy v0.0.1 flags are considered only until the one-time import runs.
    for (const actor of game.actors) {
      if (actor.getFlag?.(MODULE_ID, "account") || actor.getFlag?.(MODULE_ID, "participating")) current.set(actor.id, actor);
    }
    return Array.from(current.values());
  }

  static targetFor(actor, method = SettingsService.get().pointMethod) {
    if (!actor) return null;
    return method === POINT_METHODS.ACCOUNT ? this.primaryUser(actor) : actor;
  }

  static accountForActor(actor, method = SettingsService.get().pointMethod) {
    if (!actor) return emptyLedgerAccount();
    const state = WorldStoreService.get();
    const found = this.#findSubaccountByActorId(state, actor.id);
    if (!found) return emptyLedgerAccount();
    if (method === POINT_METHODS.ACCOUNT) {
      const primaryId = String(found.sub.primaryUserId || "");
      if (!primaryId) return emptyLedgerAccount();
      const primaryAccount = this.#findUserAccountByUserId(state, primaryId);
      return primaryAccount ? normalizeLedgerAccount(primaryAccount.shared) : normalizeLedgerAccount(found.userAccount.shared);
    }
    return normalizeLedgerAccount(found.sub.account);
  }

  static balance(actor, method = SettingsService.get().pointMethod) {
    return this.accountForActor(actor, method).balance;
  }

  static ledger(actor, method = SettingsService.get().pointMethod) {
    return this.accountForActor(actor, method).ledger;
  }

  static accountRows(config = SettingsService.get()) {
    const actors = this.configuredActors(config);
    if (config.pointMethod === POINT_METHODS.CHARACTER) {
      return actors.map(actor => ({
        id: actor.id,
        actorId: actor.id,
        name: actor.name,
        actorIds: [actor.id],
        balance: this.balance(actor, POINT_METHODS.CHARACTER),
        type: "actor"
      }));
    }

    const rows = new Map();
    for (const actor of actors) {
      const user = this.primaryUser(actor);
      if (!user) continue;
      const row = rows.get(user.id) ?? {
        id: user.id,
        userId: user.id,
        name: user.name,
        actorIds: [],
        actorNames: [],
        balance: this.balance(actor, POINT_METHODS.ACCOUNT),
        type: "user"
      };
      row.actorIds.push(actor.id);
      row.actorNames.push(actor.name);
      rows.set(user.id, row);
    }
    return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  static resolveRowActor(row) {
    if (!row) return null;
    if (row.actorId) return game.actors.get(row.actorId) ?? null;
    const id = row.actorIds?.[0];
    return id ? game.actors.get(id) ?? null : null;
  }

  static #containerForActor(state, actor, method, { create = false } = {}) {
    let found = this.#findSubaccountByActorId(state, actor?.id);
    if (!found && create && actor) found = this.#ensureSubaccount(state, actor);
    if (!found) return null;
    if (method === POINT_METHODS.ACCOUNT) {
      const primaryId = String(found.sub.primaryUserId || "");
      if (!primaryId) return null;
      let primaryAccount = this.#findUserAccountByUserId(state, primaryId);
      if (!primaryAccount && create) {
        const primaryUser = game.users.get(primaryId);
        if (primaryUser && !primaryUser.isGM) primaryAccount = this.#ensureUserAccount(state, primaryUser);
      }
      if (!primaryAccount) return null;
      primaryAccount.shared = normalizeLedgerAccount(primaryAccount.shared);
      return { container: primaryAccount.shared, userAccount: primaryAccount, sub: found.sub };
    }
    found.sub.account = normalizeLedgerAccount(found.sub.account);
    return { container: found.sub.account, userAccount: found.userAccount, sub: found.sub };
  }

  static async commit(actor, {
    delta,
    type = "award",
    title = "Point adjustment",
    description = "",
    sourceId = "",
    batchId = "",
    method = SettingsService.get().pointMethod,
    createdBy = game.user?.id ?? ""
  } = {}) {
    if (!game.user?.isGM) throw new Error("Only a GM can change point balances.");
    if (!actor) throw new Error("No Actor was provided for this point commit.");
    delta = Math.trunc(Number(delta) || 0);
    if (!delta) throw new Error("Point commits cannot have a zero value.");

    const state = WorldStoreService.get();
    const resolved = this.#containerForActor(state, actor, method, { create: true });
    if (!resolved) throw new Error(`Could not resolve a point account for ${actor.name}.`);
    const account = resolved.container;
    if (sourceId && account.ledger.some(entry => entry.sourceId === sourceId)) {
      return { skipped: true, account: foundry.utils.deepClone(account), target: this.targetFor(actor, method) };
    }

    const owner = this.primaryUser(actor, state);
    const before = account.balance;
    const after = before + delta;
    const entry = {
      id: randomId("tx"),
      timestamp: Date.now(),
      delta,
      before,
      after,
      type,
      title: String(title || "Point adjustment"),
      description: String(description || ""),
      sourceId: String(sourceId || ""),
      batchId: String(batchId || ""),
      actorId: actor.id,
      actorName: actor.name,
      actorSubaccountId: resolved.sub.id,
      userId: owner?.id ?? resolved.userAccount.linkedUserId ?? "",
      userName: owner?.name ?? resolved.userAccount.userNameSnapshot ?? "",
      accountType: method,
      accountId: method === POINT_METHODS.ACCOUNT ? resolved.userAccount.id : resolved.sub.id,
      createdBy: String(createdBy || "")
    };
    account.balance = after;
    account.ledger.push(entry);
    if (account.ledger.length > 500) account.ledger = account.ledger.slice(-500);
    const saved = await WorldStoreService.save(state);
    const refreshed = this.accountForActor(actor, method);
    Hooks.callAll(`${MODULE_ID}.pointsChanged`, { actor, target: this.targetFor(actor, method), account: refreshed, entry, worldRevision: saved.revision });
    return { skipped: false, account: refreshed, target: this.targetFor(actor, method), entry };
  }

  static async reverse(actor, entry, method = SettingsService.get().pointMethod) {
    if (!entry?.id) throw new Error("No transaction was selected for reversal.");
    return this.commit(actor, {
      delta: -Math.trunc(Number(entry.delta) || 0),
      type: "reversal",
      title: `Reversal — ${entry.title || "Point adjustment"}`,
      description: `Reverses transaction ${entry.id}.`,
      sourceId: `reversal:${entry.id}`,
      method
    });
  }

  static recentForActor(actor, limit = 10) {
    return this.ledger(actor)
      .slice(-Math.max(1, limit))
      .reverse()
      .map(entry => ({ ...entry, when: formatDateTime(entry.timestamp) }));
  }

  static migrationPreview(fromMethod, toMethod) {
    if (fromMethod === toMethod) return { rows: [], warnings: [] };
    const state = WorldStoreService.get();
    const warnings = [];
    const rows = [];

    if (fromMethod === POINT_METHODS.ACCOUNT && toMethod === POINT_METHODS.CHARACTER) {
      for (const userAccount of Object.values(state.userAccounts)) {
        const actors = Object.values(userAccount.actorSubaccounts ?? {})
          .map(sub => game.actors.get(sub.linkedActorId))
          .filter(Boolean);
        if (!actors.length) continue;
        const balance = normalizeLedgerAccount(userAccount.shared).balance;
        const share = Math.floor(balance / actors.length);
        const remainder = balance - (share * actors.length);
        rows.push({
          label: currentUserName(userAccount.linkedUserId, userAccount.userNameSnapshot),
          before: balance,
          after: actors.map(actor => `${actor.name}: ${share}`).join(" · "),
          remainder
        });
        if (remainder) warnings.push(`${currentUserName(userAccount.linkedUserId, userAccount.userNameSnapshot)}: ${remainder} point(s) will be discarded by rounding.`);
      }
    } else {
      for (const userAccount of Object.values(state.userAccounts)) {
        const actorRows = Object.values(userAccount.actorSubaccounts ?? {}).map(sub => ({
          name: currentActorName(sub.linkedActorId, sub.actorNameSnapshot),
          balance: normalizeLedgerAccount(sub.account).balance
        }));
        if (!actorRows.length) continue;
        const total = actorRows.reduce((sum, row) => sum + row.balance, 0);
        rows.push({
          label: currentUserName(userAccount.linkedUserId, userAccount.userNameSnapshot),
          before: actorRows.map(row => `${row.name}: ${row.balance}`).join(" · "),
          after: total,
          remainder: 0
        });
      }
    }
    return { rows, warnings };
  }

  static async migrate(fromMethod, toMethod) {
    if (!game.user?.isGM || fromMethod === toMethod) return;
    const state = WorldStoreService.get();
    const now = Date.now();
    const archive = { id: randomId("method-migration"), timestamp: now, fromMethod, toMethod, snapshot: foundry.utils.deepClone(state.userAccounts) };
    state.migrationArchives.push(archive);
    state.migrationArchives = state.migrationArchives.slice(-50);

    if (fromMethod === POINT_METHODS.ACCOUNT && toMethod === POINT_METHODS.CHARACTER) {
      for (const userAccount of Object.values(state.userAccounts)) {
        const activeSubs = Object.values(userAccount.actorSubaccounts ?? {}).filter(sub => game.actors.get(sub.linkedActorId));
        if (!activeSubs.length) continue;
        const old = normalizeLedgerAccount(userAccount.shared);
        const share = Math.floor(old.balance / activeSubs.length);
        const remainder = old.balance - (share * activeSubs.length);
        for (const sub of activeSubs) {
          const name = currentActorName(sub.linkedActorId, sub.actorNameSnapshot);
          sub.account = {
            balance: share,
            ledger: [{
              id: randomId("migration"), timestamp: now, delta: share, before: 0, after: share,
              type: "migration", title: "Point Method Conversion",
              description: `Account-Wide → Character-Based. Source account: ${currentUserName(userAccount.linkedUserId, userAccount.userNameSnapshot)}.`,
              sourceId: `migration:${archive.id}:${sub.id}`, batchId: archive.id,
              actorId: sub.linkedActorId, actorName: name, actorSubaccountId: sub.id,
              userId: userAccount.linkedUserId, userName: userAccount.userNameSnapshot,
              accountType: POINT_METHODS.CHARACTER, accountId: sub.id, createdBy: game.user.id
            }]
          };
        }
        userAccount.shared = emptyLedgerAccount();
        if (remainder) archive.remainder = (archive.remainder ?? 0) + remainder;
      }
    } else {
      for (const userAccount of Object.values(state.userAccounts)) {
        const subs = Object.values(userAccount.actorSubaccounts ?? {});
        if (!subs.length) continue;
        const total = subs.reduce((sum, sub) => sum + normalizeLedgerAccount(sub.account).balance, 0);
        userAccount.shared = {
          balance: total,
          ledger: [{
            id: randomId("migration"), timestamp: now, delta: total, before: 0, after: total,
            type: "migration", title: "Point Method Conversion",
            description: `Character-Based → Account-Wide. ${subs.map(sub => `${currentActorName(sub.linkedActorId, sub.actorNameSnapshot)}: ${normalizeLedgerAccount(sub.account).balance}`).join("; ")}`,
            sourceId: `migration:${archive.id}:${userAccount.id}`, batchId: archive.id,
            actorId: subs[0]?.linkedActorId ?? "", actorName: subs[0]?.actorNameSnapshot ?? userAccount.userNameSnapshot,
            actorSubaccountId: subs[0]?.id ?? "", userId: userAccount.linkedUserId, userName: userAccount.userNameSnapshot,
            accountType: POINT_METHODS.ACCOUNT, accountId: userAccount.id, createdBy: game.user.id
          }]
        };
        for (const sub of subs) sub.account = emptyLedgerAccount();
      }
    }
    await WorldStoreService.save(state);
    Hooks.callAll(`${MODULE_ID}.methodMigrated`, { fromMethod, toMethod });
  }

  static async migrateLegacyFlags() {
    if (!game.user?.isGM) return { imported: false, reason: "not-gm" };
    const state = WorldStoreService.get();
    if (state.migrations?.legacyFlagsImported) return { imported: false, reason: "already-imported" };

    let actorAccounts = 0;
    let userAccounts = 0;
    let transactions = 0;

    for (const actor of game.actors) {
      const raw = actor.getFlag?.(MODULE_ID, "account");
      const legacyOwnerId = String(actor.getFlag?.(MODULE_ID, "accountUserId") ?? "");
      const legacyOwner = legacyOwnerId ? game.users.get(legacyOwnerId) : null;
      const owner = legacyOwner && !legacyOwner.isGM ? legacyOwner : this.accountOwner(actor);
      const hasRaw = raw && typeof raw === "object" && (Number(raw.balance) || Array.isArray(raw.ledger) && raw.ledger.length);
      const participated = Boolean(actor.getFlag?.(MODULE_ID, "participating"));
      if (!hasRaw && !participated && !legacyOwnerId) continue;
      const found = this.#ensureSubaccount(state, actor, owner);
      if (hasRaw) {
        found.sub.account = reconcileImportedAccount(raw);
        actorAccounts += 1;
        transactions += found.sub.account.ledger.length;
      }
    }

    for (const user of game.users) {
      if (user.isGM) continue;
      const raw = user.getFlag?.(MODULE_ID, "account");
      const hasRaw = raw && typeof raw === "object" && (Number(raw.balance) || Array.isArray(raw.ledger) && raw.ledger.length);
      if (!hasRaw) continue;
      const userAccount = this.#ensureUserAccount(state, user);
      userAccount.shared = reconcileImportedAccount(raw);
      userAccounts += 1;
      transactions += userAccount.shared.ledger.length;
    }

    state.migrations = {
      legacyFlagsImported: true,
      importedAt: Date.now(),
      summary: { actorAccounts, userAccounts, transactions }
    };
    await WorldStoreService.save(state);
    if (actorAccounts || userAccounts) {
      ui.notifications.info(`Polls, Points & Rewards migrated ${actorAccounts} character account(s) and ${userAccounts} user account(s) into protected World storage.`);
    }
    return { imported: true, actorAccounts, userAccounts, transactions };
  }

  static #containerRows(method = SettingsService.get().pointMethod) {
    const state = WorldStoreService.get();
    const rows = [];
    if (method === POINT_METHODS.CHARACTER) {
      for (const userAccount of Object.values(state.userAccounts)) {
        for (const sub of Object.values(userAccount.actorSubaccounts ?? {})) {
          const actor = game.actors.get(sub.linkedActorId);
          const account = normalizeLedgerAccount(sub.account);
          rows.push({
            key: `sub:${sub.id}`,
            internalId: sub.id,
            parentId: userAccount.id,
            type: "actor",
            orphan: !actor,
            name: actor?.name ?? sub.actorNameSnapshot,
            ownerName: currentUserName(userAccount.linkedUserId, userAccount.userNameSnapshot),
            balance: account.balance,
            oldId: sub.linkedActorId,
            lastSeenAt: sub.lastSeenAt ?? sub.createdAt ?? 0
          });
        }
      }
      const knownActors = new Set(rows.filter(row => !row.orphan).map(row => row.oldId));
      for (const actor of this.configuredActors()) {
        if (knownActors.has(actor.id)) continue;
        rows.push({
          key: `actor:${actor.id}`,
          internalId: "",
          parentId: "",
          type: "actor",
          orphan: false,
          name: actor.name,
          ownerName: this.primaryUser(actor)?.name ?? "No Primary User",
          balance: 0,
          oldId: actor.id,
          lastSeenAt: Date.now(),
          virtual: true
        });
      }
    } else {
      for (const userAccount of Object.values(state.userAccounts)) {
        const user = userAccount.linkedUserId ? game.users.get(userAccount.linkedUserId) : null;
        rows.push({
          key: `userAccount:${userAccount.id}`,
          internalId: userAccount.id,
          type: "user",
          orphan: !user,
          name: user?.name ?? userAccount.userNameSnapshot,
          ownerName: Object.values(userAccount.actorSubaccounts ?? {}).map(sub => currentActorName(sub.linkedActorId, sub.actorNameSnapshot)).join(", ") || "No linked Actors",
          balance: normalizeLedgerAccount(userAccount.shared).balance,
          oldId: userAccount.linkedUserId,
          lastSeenAt: userAccount.lastSeenAt ?? userAccount.createdAt ?? 0
        });
      }
      const knownUsers = new Set(rows.filter(row => !row.orphan).map(row => row.oldId));
      for (const actor of this.configuredActors()) {
        const user = this.primaryUser(actor);
        if (!user || knownUsers.has(user.id)) continue;
        knownUsers.add(user.id);
        rows.push({
          key: `user:${user.id}`,
          internalId: "",
          type: "user",
          orphan: false,
          name: user.name,
          ownerName: actor.name,
          balance: 0,
          oldId: user.id,
          lastSeenAt: Date.now(),
          virtual: true
        });
      }
    }
    return rows.sort((a, b) => Number(b.orphan) - Number(a.orphan) || a.name.localeCompare(b.name));
  }

  static transferOptions(method = SettingsService.get().pointMethod) {
    const all = this.#containerRows(method);
    return {
      sources: all.filter(row => row.balance !== 0),
      destinations: all
    };
  }

  static #resolveTransferContainer(state, key, method, { create = false } = {}) {
    const [kind, id] = String(key || "").split(":");
    if (method === POINT_METHODS.CHARACTER) {
      if (kind === "actor") {
        const actor = game.actors.get(id);
        if (!actor || !create) return null;
        const found = this.#ensureSubaccount(state, actor);
        return { account: found.sub.account, userAccount: found.userAccount, sub: found.sub, actor };
      }
      if (kind === "sub") {
        for (const userAccount of Object.values(state.userAccounts)) {
          const sub = userAccount.actorSubaccounts?.[id];
          if (sub) return { account: sub.account = normalizeLedgerAccount(sub.account), userAccount, sub, actor: game.actors.get(sub.linkedActorId) ?? null };
        }
      }
      return null;
    }

    if (kind === "user") {
      const user = game.users.get(id);
      if (!user || !create) return null;
      const userAccount = this.#ensureUserAccount(state, user);
      userAccount.shared = normalizeLedgerAccount(userAccount.shared);
      return { account: userAccount.shared, userAccount, sub: null, user };
    }
    if (kind === "userAccount") {
      const userAccount = state.userAccounts[id];
      if (!userAccount) return null;
      userAccount.shared = normalizeLedgerAccount(userAccount.shared);
      return { account: userAccount.shared, userAccount, sub: null, user: game.users.get(userAccount.linkedUserId) ?? null };
    }
    return null;
  }

  static async transferAll(sourceKey, destinationKey, method = SettingsService.get().pointMethod) {
    if (!game.user?.isGM) throw new Error("Only a GM can transfer point balances.");
    if (!sourceKey || !destinationKey || sourceKey === destinationKey) throw new Error("Choose two different point accounts.");
    const state = WorldStoreService.get();
    const source = this.#resolveTransferContainer(state, sourceKey, method, { create: false });
    const destination = this.#resolveTransferContainer(state, destinationKey, method, { create: true });
    if (!source || !destination) throw new Error("One of the selected point accounts could not be resolved.");
    if (source.account === destination.account) throw new Error("Source and destination resolve to the same point account.");
    const amount = Math.trunc(Number(source.account.balance) || 0);
    if (!amount) throw new Error("The source account has no balance to transfer.");

    const transferId = randomId("transfer");
    const now = Date.now();
    const sourceBefore = source.account.balance;
    const destinationBefore = destination.account.balance;
    const sourceName = source.actor?.name ?? source.sub?.actorNameSnapshot ?? source.user?.name ?? source.userAccount.userNameSnapshot;
    const destinationName = destination.actor?.name ?? destination.sub?.actorNameSnapshot ?? destination.user?.name ?? destination.userAccount.userNameSnapshot;

    const common = {
      timestamp: now, type: "transfer", sourceId: transferId, batchId: transferId,
      createdBy: game.user.id, transferId,
      sourceNameSnapshot: sourceName, destinationNameSnapshot: destinationName
    };
    source.account.balance = 0;
    source.account.ledger.push({
      ...common, id: randomId("tx"), delta: -amount, before: sourceBefore, after: 0,
      title: "Account Transfer Out", description: `Full balance transferred to ${destinationName}.`
    });
    destination.account.balance = destinationBefore + amount;
    destination.account.ledger.push({
      ...common, id: randomId("tx"), delta: amount, before: destinationBefore, after: destinationBefore + amount,
      title: "Account Transfer In", description: `Full balance transferred from ${sourceName}.`
    });
    if (source.account.ledger.length > 500) source.account.ledger = source.account.ledger.slice(-500);
    if (destination.account.ledger.length > 500) destination.account.ledger = destination.account.ledger.slice(-500);

    const sourceOrphan = method === POINT_METHODS.CHARACTER ? !source.actor : !source.user;
    if (sourceOrphan) {
      state.closedAccounts.push({
        id: randomId("closed"), closedAt: now, transferId, method,
        sourceAccountId: method === POINT_METHODS.CHARACTER ? source.sub.id : source.userAccount.id,
        sourceNameSnapshot: sourceName, sourceLinkedId: method === POINT_METHODS.CHARACTER ? source.sub.linkedActorId : source.userAccount.linkedUserId,
        destinationAccountId: method === POINT_METHODS.CHARACTER ? destination.sub.id : destination.userAccount.id,
        destinationNameSnapshot: destinationName, amount
      });
      state.closedAccounts = state.closedAccounts.slice(-500);

      if (method === POINT_METHODS.CHARACTER) {
        delete source.userAccount.actorSubaccounts[source.sub.id];
        const noSubs = !Object.keys(source.userAccount.actorSubaccounts ?? {}).length;
        const noShared = normalizeLedgerAccount(source.userAccount.shared).balance === 0;
        const noUser = !source.userAccount.linkedUserId || !game.users.get(source.userAccount.linkedUserId);
        if (noSubs && noShared && noUser) delete state.userAccounts[source.userAccount.id];
      } else {
        const allSubsZero = Object.values(source.userAccount.actorSubaccounts ?? {}).every(sub => normalizeLedgerAccount(sub.account).balance === 0);
        if (allSubsZero) delete state.userAccounts[source.userAccount.id];
      }
    }

    await WorldStoreService.save(state);
    Hooks.callAll(`${MODULE_ID}.pointsChanged`, { actor: destination.actor ?? null, account: foundry.utils.deepClone(destination.account), entry: destination.account.ledger.at(-1) });
    return { transferId, amount, sourceName, destinationName, destinationBalance: destination.account.balance, sourceOrphan, cleaned: sourceOrphan };
  }
}
