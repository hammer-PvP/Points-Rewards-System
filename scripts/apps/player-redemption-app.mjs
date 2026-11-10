import { MODULE_ID } from "../constants.mjs";
import { AccountService } from "../services/account-service.mjs";
import { PlayerRedemptionService } from "../services/player-redemption-service.mjs";
import { SettingsService } from "../services/settings-service.mjs";
import { confirmDialog, htmlEscape } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PlayerRedemptionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static current = null;

  static DEFAULT_OPTIONS = {
    id: "points-rewards-player-redemption",
    classes: ["points-rewards-system", "pr-player-redemption-app"],
    position: { width: 525, height: 580 },
    window: { title: "Redeem Benefit", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/player-redemption.hbs` } };

  static open(actor = null) {
    if (this.current?.rendered) {
      if (actor && PlayerRedemptionService.canRedeemActor(actor)) this.current.actorId = actor.id;
      void this.current.render({ force: true });
      this.current.bringToTop?.();
      return this.current;
    }
    const app = new this({ actorId: actor?.id ?? "" });
    this.current = app;
    void app.render({ force: true });
    return app;
  }

  constructor({ actorId = "", ...options } = {}) {
    super(options);
    this.actorId = actorId;
    this.benefitId = "";
    this._busy = false;
  }

  async _prepareContext() {
    const actors = PlayerRedemptionService.eligibleActors();
    if (!actors.some(actor => actor.id === this.actorId)) this.actorId = actors[0]?.id ?? "";
    const benefits = PlayerRedemptionService.benefits();
    if (!benefits.some(benefit => benefit.id === this.benefitId)) this.benefitId = benefits[0]?.id ?? "";
    return {
      actors: actors.map(actor => ({ id: actor.id, name: actor.name, balance: AccountService.balance(actor), selected: actor.id === this.actorId })),
      hasActors: Boolean(actors.length), hasMultipleActors: actors.length > 1,
      benefits: benefits.map(benefit => ({ ...benefit, selected: benefit.id === this.benefitId })),
      hasBenefits: Boolean(benefits.length), allowNegativeBalance: SettingsService.get().allowNegativeBalance
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelector('[name="character"]')?.addEventListener("change", event => {
      this.actorId = event.currentTarget.value;
      this.#updatePreview();
    });
    root.querySelector('[name="benefit"]')?.addEventListener("change", event => {
      this.benefitId = event.currentTarget.value;
      this.#updatePreview();
    });
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", () => void this.close());
    root.querySelector('[data-action="confirm-redeem"]')?.addEventListener("click", event => void this.#redeem(event));
    this.#updatePreview();
  }

  #updatePreview() {
    const root = this.element;
    if (!root) return;
    const actor = game.actors.get(this.actorId);
    const benefit = PlayerRedemptionService.benefits().find(row => row.id === this.benefitId);
    const valid = actor && benefit && PlayerRedemptionService.canRedeemActor(actor);
    const balance = valid ? AccountService.balance(actor) : 0;
    const cost = valid ? Number(benefit.cost) : 0;
    const after = balance - cost;
    const allowDebt = SettingsService.get().allowNegativeBalance;
    const allowed = valid && (allowDebt || after >= 0);
    const setText = (selector, text) => { const el = root.querySelector(selector); if (el) el.textContent = text; };
    setText("[data-benefit-name]", valid ? benefit.name : "Choose a benefit");
    setText("[data-benefit-description]", valid ? benefit.description : "The configured effect will be displayed here.");
    setText("[data-current-balance]", String(balance));
    setText("[data-cost]", `-${cost}`);
    setText("[data-after-balance]", String(after));
    const warning = root.querySelector("[data-debt-warning]");
    if (warning) {
      warning.hidden = !valid || after >= 0;
      warning.textContent = allowDebt ? `Warning: this redemption creates ${Math.abs(after)} points of debt.` : "Insufficient points to redeem this benefit.";
    }
    const button = root.querySelector('[data-action="confirm-redeem"]');
    if (button) button.disabled = this._busy || !allowed;
    const select = root.querySelector('[name="benefit"]');
    if (select) for (const option of select.options) {
      const row = PlayerRedemptionService.benefits().find(benefit => benefit.id === option.value);
      option.disabled = !allowDebt && Number(row?.cost || 0) > balance;
      option.textContent = row ? `${row.name} — ${row.cost} Points${option.disabled ? " (Insufficient Points)" : ""}` : "Unavailable";
    }
  }

  async #redeem(event) {
    event.preventDefault();
    if (this._busy) return;
    const actor = game.actors.get(this.actorId);
    const benefit = PlayerRedemptionService.benefits().find(row => row.id === this.benefitId);
    if (!actor || !benefit || !PlayerRedemptionService.canRedeemActor(actor)) return;
    const balance = AccountService.balance(actor);
    const after = balance - benefit.cost;
    if (after < 0 && !SettingsService.get().allowNegativeBalance) return ui.notifications.warn("Insufficient points.");
    const accepted = await confirmDialog({
      title: "Confirm Benefit Redemption",
      content: `<p><strong>${htmlEscape(actor.name)}</strong> will redeem <strong>${htmlEscape(benefit.name)}</strong> for ${benefit.cost} Points.</p><p>${htmlEscape(benefit.description)}</p><p>Balance: ${balance} → <strong>${after}</strong></p>${after < 0 ? `<p class="pr-debt-warning">This creates a debt of ${Math.abs(after)} Points.</p>` : ""}`,
      yes: "Confirm Redemption", danger: after < 0
    });
    if (!accepted) return;
    this._busy = true;
    this.#updatePreview();
    try {
      const result = await PlayerRedemptionService.request(actor.id, benefit.id);
      // Never display an undefined notification even if an older GM client or
      // unexpected response omits the message; the ledger is not changed here.
      const message = typeof result?.message === "string" && result.message.trim()
        ? result.message
        : (result?.ok === true ? "Benefit redeemed successfully."
          : result?.pending === true ? "Redemption submitted. Await the GM confirmation."
          : "The redemption could not be confirmed. Check with the GM before trying again.");
      if (result?.ok === true) {
        ui.notifications.info(message);
        await this.close();
      } else if (result?.pending === true) {
        ui.notifications.warn(message);
        await this.close();
      } else {
        ui.notifications.error(message);
        await this.render({ force: true });
      }
    } catch (error) {
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this._busy = false;
      if (this.rendered) this.#updatePreview();
    }
  }

  async close(options = {}) {
    if (PlayerRedemptionApp.current === this) PlayerRedemptionApp.current = null;
    return super.close(options);
  }
}
