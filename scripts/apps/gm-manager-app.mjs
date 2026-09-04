import { MODULE_ID, POINT_METHODS } from "../constants.mjs";
import { AccountService } from "../services/account-service.mjs";
import { SettingsService } from "../services/settings-service.mjs";
import { VotingService } from "../services/voting-service.mjs";
import { TieBreakApp } from "./tie-break-app.mjs";
import { confirmDialog, htmlEscape, randomId } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class GMManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static current = null;

  constructor(options = {}) {
    super(options);
    this.activeTab = String(options.activeTab ?? "voting");
    this._busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "points-rewards-manager",
    classes: ["points-rewards-system", "pr-manager-app", "standard-form"],
    tag: "form",
    position: { width: 760, height: 700 },
    window: { title: "Points & Rewards System", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/manager.hbs` }
  };

  async _prepareContext() {
    if (!game.user.isGM) throw new Error("Only a GM can use Points & Rewards Manager.");
    const config = SettingsService.get();
    const actors = AccountService.configuredActors(config);
    const accountRows = AccountService.accountRows(config);
    const reasons = SettingsService.reasons(config);
    const benefits = SettingsService.benefits(config);
    const activeVote = VotingService.active();
    const submittedIds = new Set(Object.keys(activeVote?.ballots ?? {}));
    const eligibleUsers = (activeVote?.eligibleUserIds ?? []).map(id => game.users.get(id)).filter(Boolean);

    return {
      config,
      activeTab: this.activeTab,
      hasFolder: Boolean(config.actorFolderId),
      folderName: game.folders.get(config.actorFolderId)?.name ?? "No folder selected",
      actors: actors.map(actor => ({
        id: actor.id,
        name: actor.name,
        img: actor.img ?? "icons/svg/mystery-man.svg",
        balance: AccountService.balance(actor),
        ownerName: AccountService.accountOwner(actor)?.name ?? "No Player Owner"
      })),
      redeemActors: actors
        .filter(actor => config.pointMethod !== POINT_METHODS.ACCOUNT || AccountService.accountOwner(actor))
        .map(actor => ({
          id: actor.id,
          name: actor.name,
          img: actor.img ?? "icons/svg/mystery-man.svg",
          balance: AccountService.balance(actor),
          ownerName: AccountService.accountOwner(actor)?.name ?? "No Player Owner"
        })),
      accountRows: accountRows.map(row => ({
        ...row,
        secondary: row.type === "user" ? row.actorNames.join(", ") : "Character account"
      })),
      reasons,
      benefits,
      activeVote: activeVote ? {
        ...activeVote,
        submitted: submittedIds.size,
        total: activeVote.eligibleUserIds.length,
        pendingNames: eligibleUsers.filter(user => !submittedIds.has(user.id)).map(user => user.name).join(", ") || "None"
      } : null,
      accountWide: config.pointMethod === POINT_METHODS.ACCOUNT,
      allowNegativeBalance: config.allowNegativeBalance
    };
  }

  _onRender() {
    GMManagerApp.current = this;
    const root = this.element;
    root.querySelectorAll("[data-manager-tab]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      this.#setTab(button.dataset.managerTab);
    }));

    root.querySelector('[data-action="start-vote"]')?.addEventListener("click", event => void this.#startVote(event));
    root.querySelector('[data-action="finish-vote"]')?.addEventListener("click", event => void this.#finishVote(event));
    root.querySelector('[data-action="remind-vote"]')?.addEventListener("click", event => {
      event.preventDefault();
      void VotingService.remindPending();
    });

    root.querySelector('[data-action="select-all-recipients"]')?.addEventListener("click", event => {
      event.preventDefault();
      root.querySelectorAll('input[name="recipient"]:not(:disabled)').forEach(input => { input.checked = true; });
      this.#refreshRecipientLabel();
    });
    root.querySelector('[data-action="clear-recipients"]')?.addEventListener("click", event => {
      event.preventDefault();
      root.querySelectorAll('input[name="recipient"]').forEach(input => { input.checked = false; });
      this.#refreshRecipientLabel();
    });
    root.querySelectorAll('input[name="recipient"]').forEach(input => input.addEventListener("change", () => this.#refreshRecipientLabel()));
    root.querySelector('[name="giveReason"]')?.addEventListener("change", () => this.#refreshGiveReason());
    root.querySelector('[data-action="give-points"]')?.addEventListener("click", event => void this.#givePoints(event));

    root.querySelector('[name="redeemActor"]')?.addEventListener("change", () => this.#refreshRedeem());
    root.querySelector('[name="redeemBenefit"]')?.addEventListener("change", () => this.#refreshRedeemPreview());
    root.querySelector('[data-action="redeem-benefit"]')?.addEventListener("click", event => void this.#redeem(event));

    this.#setTab(this.activeTab, { focus: false });
    this.#refreshRecipientLabel();
    this.#refreshGiveReason();
    this.#refreshRedeem();
  }

  async close(options = {}) {
    if (GMManagerApp.current === this) GMManagerApp.current = null;
    return super.close(options);
  }

  #setTab(tab, { focus = true } = {}) {
    const allowed = new Set(["voting", "give", "redeem"]);
    this.activeTab = allowed.has(tab) ? tab : "voting";
    for (const button of this.element.querySelectorAll("[data-manager-tab]")) {
      const active = button.dataset.managerTab === this.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of this.element.querySelectorAll("[data-manager-panel]")) {
      panel.hidden = panel.dataset.managerPanel !== this.activeTab;
    }
    if (focus) this.element.querySelector(`[data-manager-panel="${this.activeTab}"] input, [data-manager-panel="${this.activeTab}"] select, [data-manager-panel="${this.activeTab}"] button`)?.focus?.();
  }

  #refreshRecipientLabel() {
    const selected = Array.from(this.element.querySelectorAll('input[name="recipient"]:checked'));
    const label = this.element.querySelector("[data-recipient-label]");
    if (label) label.textContent = selected.length ? `${selected.length} selected` : "Select recipients...";
  }

  #refreshGiveReason() {
    const select = this.element.querySelector('[name="giveReason"]');
    const custom = this.element.querySelector("[data-custom-reason]");
    const preview = this.element.querySelector("[data-give-preview]");
    if (!select) return;
    const option = select.selectedOptions?.[0];
    const isCustom = select.value === "__custom__";
    if (custom) custom.hidden = !isCustom;
    if (preview) {
      if (isCustom) {
        const amount = Math.max(1, Math.trunc(Number(this.element.querySelector('[name="customPoints"]')?.value) || 1));
        preview.textContent = `+${amount} each`;
      } else {
        preview.textContent = `+${Math.max(1, Math.trunc(Number(option?.dataset.points) || 1))} each`;
      }
    }
    this.element.querySelector('[name="customPoints"]')?.addEventListener("input", () => {
      if (select.value === "__custom__" && preview) {
        const amount = Math.max(1, Math.trunc(Number(this.element.querySelector('[name="customPoints"]')?.value) || 1));
        preview.textContent = `+${amount} each`;
      }
    }, { once: true });
  }

  async #startVote(event) {
    event.preventDefault();
    if (this._busy) return;
    try {
      this._busy = true;
      await VotingService.start();
      ui.notifications.info("Session voting opened.");
      this.activeTab = "voting";
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Could not start voting.`, error);
      ui.notifications.error(error.message);
    } finally {
      this._busy = false;
    }
  }

  async #finishVote(event) {
    event.preventDefault();
    if (this._busy) return;
    try {
      this._busy = true;
      const close = await VotingService.requestClose();
      if (!close) return;
      if (close.ties.length) {
        new TieBreakApp(close.results).render({ force: true });
      } else {
        await VotingService.finalize({});
        ui.notifications.info("Voting finalized and points awarded.");
      }
      this.activeTab = "voting";
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Could not finish voting.`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this._busy = false;
    }
  }

  async #givePoints(event) {
    event.preventDefault();
    if (this._busy) return;
    const recipientIds = Array.from(this.element.querySelectorAll('input[name="recipient"]:checked')).map(input => input.value);
    if (!recipientIds.length) return ui.notifications.warn("Select at least one recipient.");
    const config = SettingsService.get();
    const reasonSelect = this.element.querySelector('[name="giveReason"]');
    const option = reasonSelect?.selectedOptions?.[0];
    let title = "";
    let description = "";
    let points = 0;
    if (reasonSelect?.value === "__custom__") {
      title = String(this.element.querySelector('[name="customReason"]')?.value ?? "").trim();
      description = String(this.element.querySelector('[name="customDescription"]')?.value ?? "").trim();
      points = Math.max(1, Math.trunc(Number(this.element.querySelector('[name="customPoints"]')?.value) || 1));
      if (!title) return ui.notifications.warn("Enter a reason for the custom award.");
    } else {
      title = String(option?.dataset.title ?? option?.textContent ?? "Point Award").trim();
      description = String(option?.dataset.description ?? "");
      points = Math.max(1, Math.trunc(Number(option?.dataset.points) || 1));
    }

    const rows = AccountService.accountRows(config).filter(row => recipientIds.includes(row.id));
    if (!rows.length) return ui.notifications.warn("No valid recipients were selected.");
    const names = rows.map(row => `<li>${htmlEscape(row.name)}</li>`).join("");
    const accepted = await confirmDialog({
      title: "Confirm Point Award",
      content: `<p><strong>${htmlEscape(title)}</strong> — +${points} points each</p><p>Recipients: ${rows.length}</p><ul>${names}</ul>`,
      yes: `Confirm +${points} Each`
    });
    if (!accepted) return;

    const batchId = randomId("batch");
    try {
      this._busy = true;
      for (const row of rows) {
        const actor = AccountService.resolveRowActor(row);
        if (!actor) continue;
        await AccountService.commit(actor, {
          delta: points,
          type: "award",
          title,
          description,
          batchId,
          sourceId: `award:${batchId}:${row.id}`
        });
      }
      ui.notifications.info(`${points} point(s) awarded to ${rows.length} recipient(s).`);
      this.activeTab = "give";
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Batch award failed.`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this._busy = false;
    }
  }

  #refreshRedeem() {
    const actorSelect = this.element.querySelector('[name="redeemActor"]');
    const balanceNode = this.element.querySelector("[data-redeem-balance]");
    const benefitSelect = this.element.querySelector('[name="redeemBenefit"]');
    if (!actorSelect || !benefitSelect) return;
    const actor = game.actors.get(actorSelect.value);
    const balance = actor ? AccountService.balance(actor) : 0;
    if (balanceNode) balanceNode.textContent = String(balance);
    const allowDebt = SettingsService.get().allowNegativeBalance;
    let available = 0;
    for (const option of benefitSelect.querySelectorAll("option[data-cost]")) {
      const cost = Math.max(1, Math.trunc(Number(option.dataset.cost) || 1));
      const allowed = allowDebt || cost <= balance;
      option.disabled = !allowed;
      option.hidden = !allowed;
      if (allowed) available += 1;
    }
    if (benefitSelect.selectedOptions?.[0]?.disabled) {
      const next = Array.from(benefitSelect.options).find(option => option.dataset.cost && !option.disabled);
      benefitSelect.value = next?.value ?? "";
    }
    const empty = this.element.querySelector("[data-no-affordable-benefits]");
    if (empty) empty.hidden = available > 0;
    this.#refreshRedeemPreview();
  }

  #refreshRedeemPreview() {
    const actorSelect = this.element.querySelector('[name="redeemActor"]');
    const benefitSelect = this.element.querySelector('[name="redeemBenefit"]');
    const preview = this.element.querySelector("[data-redeem-preview]");
    const button = this.element.querySelector('[data-action="redeem-benefit"]');
    if (!actorSelect || !benefitSelect || !preview || !button) return;
    const actor = game.actors.get(actorSelect.value);
    const option = benefitSelect.selectedOptions?.[0];
    if (!actor || !option?.dataset.cost || option.disabled) {
      preview.textContent = "Select an available benefit.";
      preview.classList.remove("debt");
      button.disabled = true;
      return;
    }
    const balance = AccountService.balance(actor);
    const cost = Math.max(1, Math.trunc(Number(option.dataset.cost) || 1));
    const after = balance - cost;
    preview.textContent = after < 0
      ? `After redemption: ${after} points — debt of ${Math.abs(after)} points.`
      : `After redemption: ${after} points.`;
    preview.classList.toggle("debt", after < 0);
    button.disabled = false;
  }

  async #redeem(event) {
    event.preventDefault();
    if (this._busy) return;
    const actor = game.actors.get(this.element.querySelector('[name="redeemActor"]')?.value);
    const select = this.element.querySelector('[name="redeemBenefit"]');
    const option = select?.selectedOptions?.[0];
    if (!actor || !option?.dataset.cost || option.disabled) return ui.notifications.warn("Select an Actor and an available benefit.");
    const cost = Math.max(1, Math.trunc(Number(option.dataset.cost) || 1));
    const name = String(option.dataset.name ?? option.textContent ?? "Benefit").trim();
    const description = String(option.dataset.description ?? "").trim();
    const before = AccountService.balance(actor);
    const after = before - cost;
    const allowDebt = SettingsService.get().allowNegativeBalance;
    if (after < 0 && !allowDebt) return ui.notifications.warn("This Actor does not have enough points for that benefit.");

    const warning = after < 0
      ? `<p class="pr-debt-warning"><strong>Warning:</strong> this redemption will put ${htmlEscape(actor.name)} at <strong>${after} points</strong> (${Math.abs(after)} points of debt).</p>`
      : "";
    const accepted = await confirmDialog({
      title: "Confirm Benefit Redemption",
      content: `<p><strong>${htmlEscape(actor.name)}</strong> will redeem <strong>${htmlEscape(name)}</strong> for ${cost} points.</p><p>${htmlEscape(description)}</p><p>Balance: ${before} → <strong>${after}</strong></p>${warning}`,
      yes: after < 0 ? `Redeem → ${after}` : "Redeem Benefit",
      danger: after < 0
    });
    if (!accepted) return;

    try {
      this._busy = true;
      const result = await AccountService.commit(actor, {
        delta: -cost,
        type: "redemption",
        title: name,
        description,
        sourceId: `redeem:${randomId("benefit")}`
      });
      const remaining = result.account.balance;
      await ChatMessage.create({
        content: `<section class="pr-chat-card pr-chat-redeem"><header><i class="fa-solid fa-gift"></i><strong>Reward Redeemed</strong></header><p><strong>${htmlEscape(actor.name)}</strong> activated <strong>${htmlEscape(name)}</strong> — ${htmlEscape(description)} <span class="pr-chat-cost">-${cost} points</span></p><footer>Remaining balance: <strong>${remaining}</strong>${remaining < 0 ? ` <span class="pr-debt-badge">DEBT ${Math.abs(remaining)}</span>` : ""}</footer></section>`
      });
      ui.notifications.info(`${actor.name} redeemed ${name} for ${cost} points.`);
      this.activeTab = "redeem";
      await this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Benefit redemption failed.`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this._busy = false;
    }
  }
}
