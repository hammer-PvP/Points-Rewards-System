import { MAX_CATEGORIES, MIN_CATEGORIES, MODULE_ID, POINT_METHODS } from "../constants.mjs";
import { AccountService } from "../services/account-service.mjs";
import { SettingsService } from "../services/settings-service.mjs";
import { ECOSYSTEM_EXPORT_TYPES, EcosystemTransferService } from "../services/ecosystem-transfer-service.mjs";
import { actorFolderActors, chooseJsonFile, confirmDialog, downloadJsonFile, htmlEscape, importModeDialog, randomId } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PointsRewardsSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.activeTab = "general";
    this._settingsScrollTop = 0;
    this._busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "points-rewards-settings",
    classes: ["points-rewards-system", "pr-settings-app", "standard-form"],
    tag: "form",
    position: { width: 900, height: 780 },
    window: { title: "Points & Rewards System Settings", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext() {
    const config = SettingsService.get();
    if (game.user?.isGM) await AccountService.ensureConfiguredPrimaryUsers(config);
    const actorFolders = game.folders
      .filter(folder => folder.type === "Actor")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(folder => ({ id: folder.id, name: folder.name, selected: folder.id === config.actorFolderId }));
    const playerUsers = game.users.filter(user => !user.isGM).sort((a, b) => a.name.localeCompare(b.name));
    const normalizationRows = AccountService.normalizationRows(config).map(row => {
      const options = playerUsers.map(user => ({ id: user.id, name: user.name, selected: user.id === row.primaryUserId }));
      if (row.missingPrimaryUser && row.primaryUserId && !options.some(option => option.id === row.primaryUserId)) {
        options.unshift({ id: row.primaryUserId, name: `⚠ Missing — ${row.primaryUserName}`, selected: true, missing: true });
      }
      const statusIcon = row.statusKey === "normalized" ? "fa-circle-check" : row.statusKey === "multiple" ? "fa-users" : row.statusKey === "missing" ? "fa-triangle-exclamation" : "fa-circle-question";
      return { ...row, userOptions: options, unassignedSelected: !row.primaryUserId, statusIcon };
    });
    return {
      config,
      actorFolders,
      normalizationRows,
      categories: config.categories.map((row, index) => ({ ...row, position: index + 1 })),
      reasons: SettingsService.reasons(config),
      benefits: SettingsService.benefits(config),
      minCategories: MIN_CATEGORIES,
      maxCategories: MAX_CATEGORIES,
      accountSelected: config.pointMethod === POINT_METHODS.ACCOUNT,
      characterSelected: config.pointMethod === POINT_METHODS.CHARACTER
    };
  }

  _onRender() {
    const root = this.element;
    const body = root.querySelector(".pr-settings-body");
    if (body) {
      body.scrollTop = this._settingsScrollTop;
      body.addEventListener("scroll", () => { this._settingsScrollTop = body.scrollTop; }, { passive: true });
    }

    root.querySelectorAll("[data-settings-tab]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      this.#setTab(button.dataset.settingsTab);
    }));
    root.querySelector('[data-action="save"]')?.addEventListener("click", event => void this.#save(event));
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", event => { event.preventDefault(); this.close(); });

    root.querySelector('[data-action="add-category"]')?.addEventListener("click", event => { event.preventDefault(); this.#addCategory(); });
    root.querySelector('[data-action="add-reason"]')?.addEventListener("click", event => { event.preventDefault(); this.#addReason(); });
    root.querySelector('[data-action="add-benefit"]')?.addEventListener("click", event => { event.preventDefault(); this.#addBenefit(); });

    root.querySelectorAll("[data-export-config]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      this.#exportConfig(button.dataset.exportConfig);
    }));
    root.querySelectorAll("[data-import-config]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      void this.#importConfig(button.dataset.importConfig);
    }));

    root.addEventListener("click", event => {
      const button = event.target.closest?.("[data-row-action]");
      if (!button) return;
      event.preventDefault();
      this.#rowAction(button);
    });
    root.addEventListener("input", event => {
      if (event.target.closest?.("[data-category-list]")) this.#renumberCategories();
    });

    this.#setTab(this.activeTab, { focus: false });
    this.#renumberCategories();
  }

  #setTab(tab, { focus = true } = {}) {
    const allowed = new Set(["general", "identity", "voting", "reasons", "benefits"]);
    this.activeTab = allowed.has(tab) ? tab : "general";
    for (const button of this.element.querySelectorAll("[data-settings-tab]")) {
      const active = button.dataset.settingsTab === this.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of this.element.querySelectorAll("[data-settings-panel]")) panel.hidden = panel.dataset.settingsPanel !== this.activeTab;
    if (focus) this.element.querySelector(`[data-settings-panel="${this.activeTab}"] input, [data-settings-panel="${this.activeTab}"] select`)?.focus?.();
  }

  #rowAction(button) {
    const row = button.closest("[data-config-row]");
    if (!row) return;
    const action = button.dataset.rowAction;
    const list = row.parentElement;
    if (action === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (action === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    if (action === "delete") {
      const type = row.dataset.configRow;
      if (type === "category") {
        const rows = list.querySelectorAll('[data-config-row="category"]');
        if (rows.length <= MIN_CATEGORIES) return ui.notifications.warn(`At least ${MIN_CATEGORIES} voting categories are required.`);
        row.remove();
      } else {
        row.remove();
        if (!list.querySelector(`[data-config-row="${type}"]`)) {
          if (type === "reason") this.#addReason({ fallback: true });
          if (type === "benefit") this.#addBenefit({ fallback: true });
        }
      }
    }
    this.#renumberCategories();
  }

  #addCategory() {
    const list = this.element.querySelector("[data-category-list]");
    const count = list?.querySelectorAll('[data-config-row="category"]').length ?? 0;
    if (!list) return;
    if (count >= MAX_CATEGORIES) return ui.notifications.warn(`A maximum of ${MAX_CATEGORIES} voting categories is supported.`);
    list.insertAdjacentHTML("beforeend", this.#categoryRow({
      id: randomId("category"),
      title: `Category ${count + 1}`,
      shortLabel: `CAT ${count + 1}`,
      description: "",
      points: 1
    }));
    this.#renumberCategories();
  }

  #addReason({ fallback = false } = {}) {
    const list = this.element.querySelector("[data-reason-list]");
    if (!list) return;
    if (!fallback) list.querySelector('[data-config-row="reason"][data-virtual="true"]')?.remove();
    list.insertAdjacentHTML("beforeend", this.#reasonRow({
      id: fallback ? "default-reason" : randomId("reason"),
      title: fallback ? "Default" : "New Reason",
      description: "",
      points: 1,
      virtual: fallback
    }));
  }

  #addBenefit({ fallback = false } = {}) {
    const list = this.element.querySelector("[data-benefit-list]");
    if (!list) return;
    if (!fallback) list.querySelector('[data-config-row="benefit"][data-virtual="true"]')?.remove();
    list.insertAdjacentHTML("beforeend", this.#benefitRow({
      id: fallback ? "default-benefit" : randomId("benefit"),
      name: fallback ? "Default" : "New Benefit",
      description: fallback ? "Default reward benefit." : "Describe what this benefit grants.",
      cost: 1,
      virtual: fallback
    }));
  }

  #renumberCategories() {
    const rows = Array.from(this.element.querySelectorAll('[data-config-row="category"]'));
    rows.forEach((row, index) => {
      const badge = row.querySelector("[data-position]");
      if (badge) badge.textContent = `#${index + 1}`;
      for (const button of row.querySelectorAll("[data-row-action]")) {
        if (button.dataset.rowAction === "up") button.disabled = index === 0;
        if (button.dataset.rowAction === "down") button.disabled = index === rows.length - 1;
      }
    });
    const add = this.element.querySelector('[data-action="add-category"]');
    if (add) add.disabled = rows.length >= MAX_CATEGORIES;
  }

  #categoryRow(row) {
    return `<article class="pr-config-row pr-category-row" data-config-row="category" data-id="${htmlEscape(row.id)}">
      <div class="pr-position" data-position></div>
      <label>Title<input name="categoryTitle" value="${htmlEscape(row.title)}" maxlength="80" required></label>
      <label>Short Label<input name="categoryShort" value="${htmlEscape(row.shortLabel)}" maxlength="12" required></label>
      <label class="pr-grow">Description<input name="categoryDescription" value="${htmlEscape(row.description)}" maxlength="220"></label>
      <label class="pr-points-field">Points<input name="categoryPoints" type="number" min="1" step="1" value="${Math.max(1, Number(row.points) || 1)}" required></label>
      <div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move left"><i class="fa-solid fa-arrow-left"></i></button><button type="button" data-row-action="down" data-tooltip="Move right"><i class="fa-solid fa-arrow-right"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete category"><i class="fa-solid fa-trash"></i></button></div>
    </article>`;
  }

  #reasonRow(row) {
    return `<article class="pr-config-row" data-config-row="reason" data-id="${htmlEscape(row.id)}" data-virtual="${row.virtual ? "true" : "false"}">
      <label>Title<input name="reasonTitle" value="${htmlEscape(row.title)}" maxlength="80" required></label>
      <label class="pr-grow">Description<input name="reasonDescription" value="${htmlEscape(row.description)}" maxlength="220"></label>
      <label class="pr-points-field">Points<input name="reasonPoints" type="number" min="1" step="1" value="${Math.max(1, Number(row.points) || 1)}" required></label>
      <div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move up"><i class="fa-solid fa-arrow-up"></i></button><button type="button" data-row-action="down" data-tooltip="Move down"><i class="fa-solid fa-arrow-down"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete reason"><i class="fa-solid fa-trash"></i></button></div>
    </article>`;
  }

  #benefitRow(row) {
    return `<article class="pr-config-row" data-config-row="benefit" data-id="${htmlEscape(row.id)}" data-virtual="${row.virtual ? "true" : "false"}">
      <label>Name<input name="benefitName" value="${htmlEscape(row.name)}" maxlength="80" required></label>
      <label class="pr-grow">Description<input name="benefitDescription" value="${htmlEscape(row.description)}" maxlength="260" required></label>
      <label class="pr-points-field">Cost<input name="benefitCost" type="number" min="1" step="1" value="${Math.max(1, Number(row.cost) || 1)}" required></label>
      <div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move up"><i class="fa-solid fa-arrow-up"></i></button><button type="button" data-row-action="down" data-tooltip="Move down"><i class="fa-solid fa-arrow-down"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete benefit"><i class="fa-solid fa-trash"></i></button></div>
    </article>`;
  }

  #exportConfig(type) {
    try {
      const config = this.#serialize();
      const payload = EcosystemTransferService.build(type, config);
      const names = {
        [ECOSYSTEM_EXPORT_TYPES.ALL]: "points-rewards-ecosystem.json",
        [ECOSYSTEM_EXPORT_TYPES.VOTING]: "points-rewards-voting-categories.json",
        [ECOSYSTEM_EXPORT_TYPES.REASONS]: "points-rewards-give-point-reasons.json",
        [ECOSYSTEM_EXPORT_TYPES.BENEFITS]: "points-rewards-redeem-benefits.json"
      };
      downloadJsonFile(payload, names[type] ?? "points-rewards-config.json");
      ui.notifications.info("Points & Rewards configuration exported.");
    } catch (error) {
      console.error(`${MODULE_ID} | Configuration export failed.`, error);
      ui.notifications.error(error.message || "Points & Rewards configuration export failed.");
    }
  }

  async #importConfig(type) {
    if (this._busy) return;
    const picked = await chooseJsonFile();
    if (!picked) return;
    if (picked.error) return ui.notifications.error(`Could not read JSON file: ${picked.error.message}`);
    try {
      const parsed = EcosystemTransferService.parse(picked.data, type);
      const labels = {
        [ECOSYSTEM_EXPORT_TYPES.ALL]: "Voting Categories, Give Point Reasons, and Redeem Benefits",
        [ECOSYSTEM_EXPORT_TYPES.VOTING]: "Voting Categories",
        [ECOSYSTEM_EXPORT_TYPES.REASONS]: "Give Point Reasons",
        [ECOSYSTEM_EXPORT_TYPES.BENEFITS]: "Redeem Benefits"
      };
      const mode = await importModeDialog(labels[type] ?? "configuration");
      if (!mode) return;
      this._busy = true;
      if (type === ECOSYSTEM_EXPORT_TYPES.ALL) {
        this.#applyImportedSection(ECOSYSTEM_EXPORT_TYPES.VOTING, parsed.data.votingCategories, mode);
        this.#applyImportedSection(ECOSYSTEM_EXPORT_TYPES.REASONS, parsed.data.givePointReasons, mode);
        this.#applyImportedSection(ECOSYSTEM_EXPORT_TYPES.BENEFITS, parsed.data.redeemBenefits, mode);
      } else {
        const key = type === ECOSYSTEM_EXPORT_TYPES.VOTING ? "votingCategories" : type === ECOSYSTEM_EXPORT_TYPES.REASONS ? "givePointReasons" : "redeemBenefits";
        this.#applyImportedSection(type, parsed.data[key], mode);
      }
      ui.notifications.info(`Imported ${labels[type] ?? "Points & Rewards configuration"}. Review and click Save Settings to commit the changes.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Configuration import failed.`, error);
      ui.notifications.error(error.message || "Points & Rewards configuration import failed.", { permanent: true });
    } finally {
      this._busy = false;
    }
  }

  #applyImportedSection(type, importedRows, mode) {
    if (type === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      const list = this.element.querySelector("[data-category-list]");
      if (!list) throw new Error("Voting Categories list is unavailable.");
      const current = this.#serialize().categories.map(row => ({ title: row.title, shortLabel: row.shortLabel, description: row.description, points: row.points }));
      const rows = mode === "merge" ? EcosystemTransferService.merge(type, current, importedRows) : importedRows;
      list.innerHTML = rows.map(row => this.#categoryRow({ ...row, id: randomId("category") })).join("");
      this.#renumberCategories();
      return;
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      const list = this.element.querySelector("[data-reason-list]");
      if (!list) throw new Error("Give Point Reasons list is unavailable.");
      const current = this.#serialize().giveReasons.map(row => ({ title: row.title, description: row.description, points: row.points }));
      const rows = mode === "merge" ? EcosystemTransferService.merge(type, current, importedRows) : importedRows;
      list.innerHTML = rows.length ? rows.map(row => this.#reasonRow({ ...row, id: randomId("reason"), virtual: false })).join("") : "";
      if (!rows.length) this.#addReason({ fallback: true });
      return;
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      const list = this.element.querySelector("[data-benefit-list]");
      if (!list) throw new Error("Redeem Benefits list is unavailable.");
      const current = this.#serialize().benefits.map(row => ({ name: row.name, description: row.description, cost: row.cost }));
      const rows = mode === "merge" ? EcosystemTransferService.merge(type, current, importedRows) : importedRows;
      list.innerHTML = rows.length ? rows.map(row => this.#benefitRow({ ...row, id: randomId("benefit"), virtual: false })).join("") : "";
      if (!rows.length) this.#addBenefit({ fallback: true });
    }
  }

  #serialize() {
    const root = this.element;
    const pointMethod = root.querySelector('[name="pointMethod"]:checked')?.value === POINT_METHODS.ACCOUNT
      ? POINT_METHODS.ACCOUNT
      : POINT_METHODS.CHARACTER;
    const categories = Array.from(root.querySelectorAll('[data-config-row="category"]')).map((row, index) => ({
      id: row.dataset.id || randomId("category"),
      title: String(row.querySelector('[name="categoryTitle"]')?.value ?? "").trim(),
      shortLabel: String(row.querySelector('[name="categoryShort"]')?.value ?? "").trim(),
      description: String(row.querySelector('[name="categoryDescription"]')?.value ?? "").trim(),
      points: Math.max(1, Math.trunc(Number(row.querySelector('[name="categoryPoints"]')?.value) || 1)),
      order: index
    }));
    const giveReasons = Array.from(root.querySelectorAll('[data-config-row="reason"]')).map(row => {
      const title = String(row.querySelector('[name="reasonTitle"]')?.value ?? "").trim();
      const description = String(row.querySelector('[name="reasonDescription"]')?.value ?? "").trim();
      const points = Math.max(1, Math.trunc(Number(row.querySelector('[name="reasonPoints"]')?.value) || 1));
      if (row.dataset.virtual === "true" && title === "Default" && !description && points === 1) return null;
      return { id: row.dataset.virtual === "true" ? randomId("reason") : row.dataset.id || randomId("reason"), title, description, points };
    }).filter(Boolean);
    const benefits = Array.from(root.querySelectorAll('[data-config-row="benefit"]')).map(row => {
      const name = String(row.querySelector('[name="benefitName"]')?.value ?? "").trim();
      const description = String(row.querySelector('[name="benefitDescription"]')?.value ?? "").trim();
      const cost = Math.max(1, Math.trunc(Number(row.querySelector('[name="benefitCost"]')?.value) || 1));
      if (row.dataset.virtual === "true" && name === "Default" && description === "Default reward benefit." && cost === 1) return null;
      return { id: row.dataset.virtual === "true" ? randomId("benefit") : row.dataset.id || randomId("benefit"), name, description, cost };
    }).filter(Boolean);
    return {
      actorFolderId: String(root.querySelector('[name="actorFolderId"]')?.value ?? ""),
      pointMethod,
      allowSelfVoting: Boolean(root.querySelector('[name="allowSelfVoting"]')?.checked),
      allowNegativeBalance: Boolean(root.querySelector('[name="allowNegativeBalance"]')?.checked),
      postVotingResultsToChat: Boolean(root.querySelector('[name="postVotingResultsToChat"]')?.checked),
      showSheetPoints: Boolean(root.querySelector('[name="showSheetPoints"]')?.checked),
      categories,
      giveReasons,
      benefits
    };
  }

  #serializePrimaryAssignments() {
    return Object.fromEntries(Array.from(this.element.querySelectorAll("[data-normalization-row]")).map(row => [
      String(row.dataset.actorId || ""),
      String(row.querySelector('[name="primaryUser"]')?.value ?? "")
    ]).filter(([actorId]) => actorId));
  }

  #validate(config) {
    if (config.categories.length < MIN_CATEGORIES || config.categories.length > MAX_CATEGORIES) return `Voting requires ${MIN_CATEGORIES}–${MAX_CATEGORIES} categories.`;
    if (config.categories.some(row => !row.title || !row.shortLabel)) return "Every voting category needs a Title and Short Label.";
    if (config.giveReasons.some(row => !row.title)) return "Every Give Point reason needs a title.";
    if (config.benefits.some(row => !row.name || !row.description)) return "Every redeem benefit needs both a name and description.";
    return "";
  }

  async #save(event) {
    event.preventDefault();
    if (this._busy) return;
    const previous = SettingsService.get();
    const raw = this.#serialize();
    const primaryAssignments = this.#serializePrimaryAssignments();
    const error = this.#validate(raw);
    if (error) return ui.notifications.warn(error);
    const next = SettingsService.normalize(raw);

    try {
      this._busy = true;
      const primaryChanges = AccountService.primaryAssignmentPreview(primaryAssignments);
      if (primaryChanges.length) {
        const rows = primaryChanges.map(change => `<li><strong>${htmlEscape(change.actorName)}</strong>: ${htmlEscape(change.oldUserName)} → ${htmlEscape(change.newUserName)}</li>`).join("");
        const accepted = await confirmDialog({
          title: "Change Primary User Assignments?",
          content: `<p>Primary User controls point-account identity and self-voting. Foundry Ownership remains unchanged.</p><ul>${rows}</ul><p><strong>No point balance is transferred by this operation.</strong> In Account-Wide mode, the Actor will begin using the newly assigned User's existing shared balance.</p>`,
          yes: "Apply Primary Users",
          danger: false
        });
        if (!accepted) return;
        await AccountService.applyPrimaryAssignments(primaryAssignments);
      }
      if (previous.pointMethod !== next.pointMethod) {
        for (const actor of actorFolderActors(next.actorFolderId)) await AccountService.rememberParticipation(actor);
        const preview = AccountService.migrationPreview(previous.pointMethod, next.pointMethod);
        const rows = preview.rows.map(row => `<li><strong>${htmlEscape(row.label)}</strong>: ${htmlEscape(row.before)} → ${htmlEscape(row.after)}${row.remainder ? ` <em>(discard ${row.remainder})</em>` : ""}</li>`).join("");
        const warnings = preview.warnings.length ? `<div class="pr-debt-warning">${preview.warnings.map(warning => `<p>${htmlEscape(warning)}</p>`).join("")}</div>` : "";
        const accepted = await confirmDialog({
          title: "Convert Point Method?",
          content: `<p>Changing the point method migrates existing balances.</p><ul>${rows || "<li>No existing balances require conversion.</li>"}</ul>${warnings}<p>This operation is recorded as a point-method conversion.</p>`,
          yes: "Convert Points",
          danger: preview.warnings.length > 0
        });
        if (!accepted) return;
        await AccountService.migrate(previous.pointMethod, next.pointMethod);
      }
      await SettingsService.set(next);
      await AccountService.ensureConfiguredPrimaryUsers(next);
      ui.notifications.info("Points & Rewards System settings saved.");
      await this.close();
    } catch (saveError) {
      console.error(`${MODULE_ID} | Settings could not be saved.`, saveError);
      ui.notifications.error(saveError.message, { permanent: true });
    } finally {
      this._busy = false;
    }
  }
}
