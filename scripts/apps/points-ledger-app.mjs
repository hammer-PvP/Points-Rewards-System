import { MODULE_ID, POINT_METHODS } from "../constants.mjs";
import { AccountService } from "../services/account-service.mjs";
import { SettingsService } from "../services/settings-service.mjs";
import { formatDateTime, formatSigned } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PointsLedgerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instances = new Set();

  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    PointsLedgerApp.instances.add(this);
  }

  static DEFAULT_OPTIONS = {
    id: "points-rewards-ledger",
    classes: ["points-rewards-system", "pr-ledger-app"],
    position: { width: 520, height: 470 },
    window: { title: "Points", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/ledger.hbs` }
  };

  static refreshAll() {
    for (const app of this.instances) {
      if (app?.rendered) void app.render({ force: true });
    }
  }

  async close(options = {}) {
    PointsLedgerApp.instances.delete(this);
    return super.close(options);
  }

  async _prepareContext() {
    const config = SettingsService.get();
    const target = AccountService.targetFor(this.actor, config.pointMethod);
    const account = AccountService.accountForActor(this.actor, config.pointMethod);
    return {
      actor: this.actor,
      balance: account.balance,
      isDebt: account.balance < 0,
      debt: Math.abs(Math.min(0, account.balance)),
      accountWide: config.pointMethod === POINT_METHODS.ACCOUNT,
      accountLabel: config.pointMethod === POINT_METHODS.ACCOUNT ? target?.name ?? "Unassigned User" : this.actor.name,
      entries: account.ledger.slice(-10).reverse().map(entry => ({
        ...entry,
        signed: formatSigned(entry.delta),
        when: formatDateTime(entry.timestamp),
        positive: entry.delta > 0,
        negative: entry.delta < 0
      }))
    };
  }
}
