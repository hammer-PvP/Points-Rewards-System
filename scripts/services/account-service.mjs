import { MODULE_ID, OWNER_LEVEL, POINT_METHODS } from "../constants.mjs";
import { SettingsService } from "./settings-service.mjs";
import { actorFolderActors, formatDateTime, randomId } from "../utils.mjs";

function emptyAccount() {
  return { balance: 0, ledger: [] };
}

function normalizeAccount(raw) {
  const account = raw && typeof raw === "object" ? foundry.utils.deepClone(raw) : emptyAccount();
  account.balance = Math.trunc(Number(account.balance) || 0);
  account.ledger = Array.isArray(account.ledger) ? account.ledger.filter(Boolean) : [];
  return account;
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

  static accountOwner(actor) {
    if (!actor) return null;
    const owners = this.nonGMOwners(actor);
    if (!owners.length) return null;
    const explicitId = String(actor.getFlag(MODULE_ID, "accountUserId") ?? "");
    const explicit = owners.find(user => user.id === explicitId);
    if (explicit) return explicit;
    const assigned = owners.find(user => user.character?.id === actor.id);
    return assigned ?? owners[0];
  }

  static async rememberParticipation(actor) {
    if (!actor || !game.user?.isGM) return;
    const updates = {};
    if (!actor.getFlag(MODULE_ID, "participating")) updates[`flags.${MODULE_ID}.participating`] = true;
    const owner = this.accountOwner(actor);
    if (owner && actor.getFlag(MODULE_ID, "accountUserId") !== owner.id) {
      updates[`flags.${MODULE_ID}.accountUserId`] = owner.id;
    }
    if (Object.keys(updates).length) await actor.update(updates);
  }

  static trackedActors() {
    const config = SettingsService.get();
    const current = new Set(this.configuredActors(config).map(actor => actor.id));
    return game.actors.filter(actor => current.has(actor.id)
      || actor.getFlag(MODULE_ID, "participating")
      || actor.getFlag(MODULE_ID, "account"));
  }

  static targetFor(actor, method = SettingsService.get().pointMethod) {
    if (!actor) return null;
    if (method === POINT_METHODS.ACCOUNT) return this.accountOwner(actor);
    return actor;
  }

  static accountForActor(actor, method = SettingsService.get().pointMethod) {
    const target = this.targetFor(actor, method);
    return normalizeAccount(target?.getFlag(MODULE_ID, "account"));
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
      const user = this.accountOwner(actor);
      if (!user) continue;
      const row = rows.get(user.id) ?? {
        id: user.id,
        userId: user.id,
        name: user.name,
        actorIds: [],
        actorNames: [],
        balance: normalizeAccount(user.getFlag(MODULE_ID, "account")).balance,
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

    await this.rememberParticipation(actor);
    const target = this.targetFor(actor, method);
    if (!target) throw new Error(`Could not resolve a point account for ${actor.name}.`);
    const account = normalizeAccount(target.getFlag(MODULE_ID, "account"));
    if (sourceId && account.ledger.some(entry => entry.sourceId === sourceId)) {
      return { skipped: true, account, target };
    }

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
      accountType: method,
      accountId: target.id,
      createdBy: String(createdBy || "")
    };
    account.balance = after;
    account.ledger.push(entry);
    if (account.ledger.length > 500) account.ledger = account.ledger.slice(-500);
    await target.setFlag(MODULE_ID, "account", account);
    Hooks.callAll(`${MODULE_ID}.pointsChanged`, { actor, target, account, entry });
    return { skipped: false, account, target, entry };
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
    const actors = this.trackedActors();
    const warnings = [];
    const rows = [];

    if (fromMethod === POINT_METHODS.ACCOUNT && toMethod === POINT_METHODS.CHARACTER) {
      const users = new Map();
      for (const actor of actors) {
        const owner = this.accountOwner(actor);
        if (!owner) continue;
        const row = users.get(owner.id) ?? { user: owner, actors: [] };
        row.actors.push(actor);
        users.set(owner.id, row);
      }
      for (const { user, actors: owned } of users.values()) {
        const balance = normalizeAccount(user.getFlag(MODULE_ID, "account")).balance;
        if (!owned.length) continue;
        const share = Math.floor(balance / owned.length);
        const distributed = share * owned.length;
        const remainder = balance - distributed;
        rows.push({
          label: user.name,
          before: balance,
          after: owned.map(actor => `${actor.name}: ${share}`).join(" · "),
          remainder
        });
        if (remainder) warnings.push(`${user.name}: ${remainder} point(s) will be discarded by rounding.`);
      }
    } else {
      const users = new Map();
      for (const actor of actors) {
        const owner = this.accountOwner(actor);
        if (!owner) continue;
        const balance = normalizeAccount(actor.getFlag(MODULE_ID, "account")).balance;
        const row = users.get(owner.id) ?? { user: owner, total: 0, actors: [] };
        row.total += balance;
        row.actors.push(`${actor.name}: ${balance}`);
        users.set(owner.id, row);
      }
      for (const { user, total, actors: actorRows } of users.values()) {
        rows.push({ label: user.name, before: actorRows.join(" · "), after: total, remainder: 0 });
      }
    }
    return { rows, warnings };
  }

  static async migrate(fromMethod, toMethod) {
    if (!game.user?.isGM || fromMethod === toMethod) return;
    const actors = this.trackedActors();
    const now = Date.now();

    if (fromMethod === POINT_METHODS.ACCOUNT && toMethod === POINT_METHODS.CHARACTER) {
      const users = new Map();
      for (const actor of actors) {
        const owner = this.accountOwner(actor);
        if (!owner) continue;
        const row = users.get(owner.id) ?? { user: owner, actors: [] };
        row.actors.push(actor);
        users.set(owner.id, row);
      }
      for (const { user, actors: owned } of users.values()) {
        const old = normalizeAccount(user.getFlag(MODULE_ID, "account"));
        if (!owned.length) continue;
        const share = Math.floor(old.balance / owned.length);
        const remainder = old.balance - (share * owned.length);
        for (const actor of owned) {
          const entry = {
            id: randomId("migration"), timestamp: now, delta: share, before: 0, after: share,
            type: "migration", title: "Point Method Conversion",
            description: `Account-Wide → Character-Based. Source account: ${user.name}.`,
            sourceId: `migration:${now}:${user.id}:${actor.id}`, batchId: `migration:${now}`,
            actorId: actor.id, actorName: actor.name, accountType: POINT_METHODS.CHARACTER,
            accountId: actor.id, createdBy: game.user.id
          };
          await actor.setFlag(MODULE_ID, "account", { balance: share, ledger: [entry] });
          await this.rememberParticipation(actor);
        }
        await user.setFlag(MODULE_ID, "migrationArchive", {
          timestamp: now, from: POINT_METHODS.ACCOUNT, to: POINT_METHODS.CHARACTER,
          balance: old.balance, remainder, account: old
        });
        await user.setFlag(MODULE_ID, "account", emptyAccount());
      }
    } else {
      const users = new Map();
      for (const actor of actors) {
        const owner = this.accountOwner(actor);
        if (!owner) continue;
        const old = normalizeAccount(actor.getFlag(MODULE_ID, "account"));
        const row = users.get(owner.id) ?? { user: owner, total: 0, actors: [] };
        row.total += old.balance;
        row.actors.push({ actor, account: old });
        users.set(owner.id, row);
      }
      for (const { user, total, actors: actorRows } of users.values()) {
        const contextActor = actorRows[0]?.actor;
        const entry = {
          id: randomId("migration"), timestamp: now, delta: total, before: 0, after: total,
          type: "migration", title: "Point Method Conversion",
          description: `Character-Based → Account-Wide. ${actorRows.map(row => `${row.actor.name}: ${row.account.balance}`).join("; ")}`,
          sourceId: `migration:${now}:${user.id}`, batchId: `migration:${now}`,
          actorId: contextActor?.id ?? "", actorName: contextActor?.name ?? user.name,
          accountType: POINT_METHODS.ACCOUNT, accountId: user.id, createdBy: game.user.id
        };
        await user.setFlag(MODULE_ID, "account", { balance: total, ledger: [entry] });
        for (const row of actorRows) {
          await row.actor.setFlag(MODULE_ID, "migrationArchive", {
            timestamp: now, from: POINT_METHODS.CHARACTER, to: POINT_METHODS.ACCOUNT,
            account: row.account
          });
          await row.actor.setFlag(MODULE_ID, "account", emptyAccount());
          await this.rememberParticipation(row.actor);
        }
      }
    }
    Hooks.callAll(`${MODULE_ID}.methodMigrated`, { fromMethod, toMethod });
  }
}
