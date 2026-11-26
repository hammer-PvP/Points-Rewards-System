import {
  BALLOT_VISIBILITY,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  MIN_QUESTIONS,
  MODULE_ID,
  POINT_METHODS,
  VOTE_TYPES
} from "../constants.mjs";
import { AccountService } from "../services/account-service.mjs";
import { SettingsService } from "../services/settings-service.mjs";
import { ECOSYSTEM_EXPORT_TYPES, EcosystemTransferService } from "../services/ecosystem-transfer-service.mjs";
import { BuiltInPresetsService } from "../services/built-in-presets-service.mjs";
import { PresetJournalService } from "../services/preset-journal-service.mjs";
import { actorFolderActors, chooseJsonFile, confirmDialog, downloadJsonFile, htmlEscape, importModeDialog, randomId } from "../utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PointsRewardsSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.activeTab = "general";
    this.selectedProfileId = "";
    this._settingsScrollTop = 0;
    this._busy = false;
    this._presetGroups = null;
    this._presetCatalog = null;
    this._selectedBuiltIn = null;
    this._presetPreviewTab = "overview";
    this._pendingJournalJobs = new Map();
  }

  static DEFAULT_OPTIONS = {
    id: "points-rewards-settings",
    classes: ["points-rewards-system", "pr-settings-app", "standard-form"],
    tag: "form",
    position: { width: 960, height: 820 },
    window: { title: "Polls, Points & Rewards Settings", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/settings.hbs` }
  };

  async _prepareContext() {
    const config = SettingsService.get();
    if (!this._presetGroups) this._presetGroups = BuiltInPresetsService.groups(config);
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

    const profiles = SettingsService.votingProfiles(config);
    if (!this.selectedProfileId || !profiles.some(profile => profile.id === this.selectedProfileId)) this.selectedProfileId = profiles[0]?.id ?? "";
    const votingProfiles = profiles.map((profile, profileIndex) => ({
      ...profile,
      selected: profile.id === this.selectedProfileId,
      publicBallots: profile.ballotVisibility === BALLOT_VISIBILITY.PUBLIC,
      questions: profile.questions.map((question, questionIndex) => ({
        ...question,
        position: questionIndex + 1,
        isActor: question.voteType === VOTE_TYPES.ACTOR,
        isOption: question.voteType === VOTE_TYPES.OPTION,
        options: (question.options ?? []).map((option, optionIndex) => ({ ...option, position: optionIndex + 1 }))
      })),
      position: profileIndex + 1
    }));

    return {
      config,
      actorFolders,
      normalizationRows,
      votingProfiles,
      reasons: SettingsService.reasons(config),
      benefits: SettingsService.benefits(config),
      minQuestions: MIN_QUESTIONS,
      maxQuestions: MAX_QUESTIONS,
      minOptions: MIN_OPTIONS,
      maxOptions: MAX_OPTIONS,
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
    root.querySelector('[data-action="open-presets"]')?.addEventListener("click", event => { event.preventDefault(); void this.#openPresets(); });
    root.querySelectorAll('[data-action="close-presets"]').forEach(button => button.addEventListener("click", event => { event.preventDefault(); this.#closePresets(); }));
    root.querySelector('[name="builtInPresetSelect"]')?.addEventListener("change", event => { void this.#chooseBuiltIn(event.currentTarget.value); });
    root.querySelector('[data-action="import-built-in"]')?.addEventListener("click", event => { event.preventDefault(); void this.#importBuiltIn(); });
    root.querySelectorAll('[data-preset-preview-tab]').forEach(button => button.addEventListener("click", event => { event.preventDefault(); this.#setPresetPreviewTab(button.dataset.presetPreviewTab); }));
    root.querySelector('[data-imported-preset-groups]')?.addEventListener("click", event => {
      const button = event.target.closest('[data-action="rename-imported-preset"]');
      if (button) { event.preventDefault(); this.#renameImportedGroup(button.dataset.groupId); }
    });
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", event => { event.preventDefault(); this.close(); });

    root.querySelector('[name="votingProfileSelect"]')?.addEventListener("change", event => this.#setVotingProfile(event.currentTarget.value));
    root.querySelector('[data-action="add-profile"]')?.addEventListener("click", event => { event.preventDefault(); this.#addProfile(); });
    root.querySelector('[data-action="delete-profile"]')?.addEventListener("click", event => { event.preventDefault(); this.#deleteProfile(); });
    root.querySelector('[data-action="add-question"]')?.addEventListener("click", event => { event.preventDefault(); this.#addQuestion(); });
    root.querySelector('[data-action="add-reason"]')?.addEventListener("click", event => { event.preventDefault(); this.#addReason(); });
    root.querySelector('[data-action="add-benefit"]')?.addEventListener("click", event => { event.preventDefault(); this.#addBenefit(); });

    root.querySelectorAll("[data-export-config]").forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      void this.#exportConfig(button.dataset.exportConfig);
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
    root.addEventListener("change", event => {
      if (event.target.matches?.('[name="questionType"]')) this.#syncQuestionType(event.target.closest('[data-config-row="question"]'));
    });
    root.addEventListener("input", event => {
      if (event.target.matches?.('[name="profileName"]')) {
        const panel = event.target.closest("[data-voting-profile]");
        const option = root.querySelector(`[name="votingProfileSelect"] option[value="${cssEscape(panel?.dataset.profileId ?? "")}"]`);
        if (option) option.textContent = String(event.target.value || "Unnamed Profile");
      }
      if (event.target.closest?.("[data-question-list], [data-option-list]")) this.#renumberVotingRows();
    });

    this.#setTab(this.activeTab, { focus: false });
    this.#setVotingProfile(this.selectedProfileId, { focus: false });
    this.#renumberVotingRows();
    root.querySelectorAll('[data-config-row="question"]').forEach(row => this.#syncQuestionType(row, { initial: true }));
  }

  async #openPresets() {
    if (this._busy) return;
    const modal = this.element.querySelector('[data-preset-dialog]');
    if (!modal) return;
    modal.hidden = false;
    this.#renderImportedGroups();
    try {
      if (!this._presetCatalog) this._presetCatalog = await BuiltInPresetsService.catalog();
      const select = modal.querySelector('[name="builtInPresetSelect"]');
      select.innerHTML = this._presetCatalog.map(item => `<option value="${htmlEscape(item.id)}">${htmlEscape(item.name)}</option>`).join("");
      await this.#chooseBuiltIn(select.value);
    } catch (error) {
      console.error(`${MODULE_ID} | Built-in presets could not be loaded`, error);
      ui.notifications.error(error.message || "Could not load built-in presets.");
    }
  }

  #closePresets() {
    const modal = this.element.querySelector('[data-preset-dialog]');
    if (modal) modal.hidden = true;
  }

  async #chooseBuiltIn(presetId) {
    const host = this.element.querySelector('[data-preset-preview]');
    if (!host) return;
    host.textContent = "Loading preset preview…";
    this._selectedBuiltIn = null;
    const importButton = this.element.querySelector('[data-action="import-built-in"]');
    if (importButton) importButton.disabled = true;
    try {
      const selected = await BuiltInPresetsService.get(presetId, this._presetCatalog);
      // Ignore a slower, older selection arriving after the GM selected another preset.
      if (this.element.querySelector('[name="builtInPresetSelect"]')?.value !== presetId) return;
      this._selectedBuiltIn = selected;
      if (importButton) importButton.disabled = false;
      this.#renderBuiltInPreview();
    } catch (error) {
      this._selectedBuiltIn = null;
      host.textContent = error.message || "Could not open preset.";
    }
  }

  #setPresetPreviewTab(tab) {
    this._presetPreviewTab = ["overview", "voting", "reasons", "benefits", "journals"].includes(tab) ? tab : "overview";
    for (const button of this.element.querySelectorAll('[data-preset-preview-tab]')) button.classList.toggle("active", button.dataset.presetPreviewTab === this._presetPreviewTab);
    this.#renderBuiltInPreview();
  }

  #renderBuiltInPreview() {
    const host = this.element.querySelector('[data-preset-preview]');
    const selected = this._selectedBuiltIn;
    if (!host || !selected) return;
    const { entry, data } = selected;
    const escaped = htmlEscape;
    const sameName = this._presetGroups.some(group => group.name.trim().toLowerCase() === entry.name.trim().toLowerCase());
    const header = `<div class="pr-preset-facts"><strong>${escaped(entry.name)}</strong><span>${entry.language === "pt-BR" ? "Brazilian Portuguese (PT-BR) — Text is provided in PT-BR." : "English (EN)"}</span><small>${data.votingProfiles.length} Voting · ${data.givePointReasons.length} Reasons · ${data.redeemBenefits.length} Benefits · 2 optional Journals</small>${sameName ? '<small class="pr-preset-warning">Importing will replace only the imported set with this name. Existing edits in that set will be lost after confirmation.</small>' : ""}</div>`;
    const list = (rows, titleOf, detailsOf) => `<ul class="pr-preset-preview-list">${rows.map(row => `<li><strong>${escaped(titleOf(row))}</strong><span>${escaped(detailsOf(row))}</span></li>`).join("")}</ul>`;
    let content;
    switch (this._presetPreviewTab) {
      case "voting":
        content = data.votingProfiles.map(p => `<h4>${escaped(p.name)} · ${p.ballotVisibility === "public" ? "Public" : "Secret"} ballots</h4>${list(p.questions, q => `${q.title} (${q.points} points)`, q => `${q.description}${q.resolveTiesByGM ? " · GM resolves ties" : ""}${q.options.length ? ` · Options: ${q.options.map(o => o.label).join(", ")}` : ""}`)}`).join(""); break;
      case "reasons": content = list(data.givePointReasons, r => `${r.title} (+${r.points})`, r => r.description); break;
      case "benefits": content = list(data.redeemBenefits, r => `${r.name} (${r.cost} points)`, r => r.description); break;
      case "journals": content = `<p>The optional player guides are created in <strong>${entry.language === "pt-BR" ? "Pontos / Ganhando, Gastando" : "Points / Earning, Spending"}</strong>. Players have Observer/read-only access. Existing edited guides are preserved unless you explicitly choose to update them.</p>`; break;
      default: content = `<p>${entry.displayName === "Optional 1" ? "MVP vote with one winner, six GM reasons, and 23 campaign benefits." : "Three end-of-session award questions, three GM reasons, and ten heroic benefits."} Everything is editable after import. Nothing is created until you save Settings.</p>`;
    }
    host.innerHTML = `${header}<div class="pr-preset-preview-content">${content}</div>`;
  }

  #renderImportedGroups() {
    const host = this.element.querySelector('[data-imported-preset-groups]');
    if (!host) return;
    host.innerHTML = this._presetGroups.length ? this._presetGroups.map(group => `<div class="pr-preset-group-row"><input aria-label="Imported preset name" maxlength="100" value="${htmlEscape(group.name)}" data-imported-group-input="${htmlEscape(group.id)}"><button type="button" data-action="rename-imported-preset" data-group-id="${htmlEscape(group.id)}"><i class="fa-solid fa-pen"></i> Rename</button></div>`).join("") : '<p class="pr-preset-note">No imported preset groups in this World yet.</p>';
  }

  #renameImportedGroup(groupId) {
    const input = Array.from(this.element.querySelectorAll('[data-imported-group-input]')).find(item => item.dataset.importedGroupInput === groupId);
    if (!input) return;
    try {
      this._presetGroups = BuiltInPresetsService.rename(this._presetGroups, groupId, input.value);
      this.#renderImportedGroups();
      this.#renderBuiltInPreview();
      ui.notifications.info("Preset renamed in the editor. Click Save Settings to apply it to this World.");
    } catch (error) { ui.notifications.warn(error.message); }
  }

  async #importBuiltIn() {
    if (this._busy || !this._selectedBuiltIn || this.element.querySelector('[name="builtInPresetSelect"]')?.value !== this._selectedBuiltIn.entry.id) return;
    const { entry, data } = this._selectedBuiltIn;
    const current = this.#serialize();
    const old = this._presetGroups.find(group => group.name.trim().toLowerCase() === entry.name.trim().toLowerCase());
    const confirmation = old
      ? `This replaces only <strong>${htmlEscape(entry.name)}</strong> (its ${old.votingIds.length} voting profiles, ${old.reasonIds.length} reasons, and ${old.benefitIds.length} benefits). Manual data and other imported sets are preserved. <strong>Edits within this same-name group will be replaced.</strong>`
      : `Import <strong>${htmlEscape(entry.name)}</strong> as a new editable set. Other configured data will be preserved.`;
    const accepted = await confirmDialog({ title: old ? "Replace Imported Preset?" : "Import Built-in Preset?", content: `<p>${confirmation}</p><p>Review the staged changes and click <strong>Save Settings</strong> to commit. No balances, Actors, or point history will change.</p>`, yes: old ? "Replace This Preset" : "Import This Preset", danger: Boolean(old) });
    if (!accepted) return;
    try {
      this._busy = true;
      const result = BuiltInPresetsService.apply(current, data, entry.name);
      this._presetGroups = result.config.importedPresetGroups;
      this.#replaceConfigurationEditors(result.config);
      if (this.element.querySelector('[name="createPresetJournals"]')?.checked) {
        this._pendingJournalJobs.set(result.group.id, { entry, groupId: result.group.id, updateExisting: Boolean(this.element.querySelector('[name="updatePresetJournals"]')?.checked) });
      } else this._pendingJournalJobs.delete(result.group.id);
      this.#renderImportedGroups();
      this.#closePresets();
      ui.notifications.info(`Staged ${entry.name}. Click Save Settings to apply${this._pendingJournalJobs.has(result.group.id) ? " and create Player Journals" : ""}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Built-in preset import failed`, error);
      ui.notifications.error(error.message || "Preset import failed.");
    } finally { this._busy = false; }
  }

  #replaceConfigurationEditors(config) {
    const host = this.element.querySelector("[data-profile-panels]");
    const select = this.element.querySelector('[name="votingProfileSelect"]');
    const reasons = this.element.querySelector("[data-reason-list]");
    const benefits = this.element.querySelector("[data-benefit-list]");
    if (!host || !select || !reasons || !benefits) throw new Error("Settings editor is unavailable.");
    host.innerHTML = config.votingProfiles.map(profile => this.#profilePanel(profile)).join("");
    select.innerHTML = config.votingProfiles.map(profile => `<option value="${htmlEscape(profile.id)}">${htmlEscape(profile.name)}</option>`).join("");
    reasons.innerHTML = config.giveReasons.length ? config.giveReasons.map(row => this.#reasonRow({ ...row, virtual: false })).join("") : "";
    benefits.innerHTML = config.benefits.length ? config.benefits.map(row => this.#benefitRow({ ...row, virtual: false })).join("") : "";
    if (!config.giveReasons.length) this.#addReason({ fallback: true });
    if (!config.benefits.length) this.#addBenefit({ fallback: true });
    this.#setVotingProfile(this.selectedProfileId, { focus: false });
    this.element.querySelectorAll('[data-config-row="question"]').forEach(row => this.#syncQuestionType(row, { initial: true }));
    this.#renumberVotingRows();
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

  #setVotingProfile(profileId, { focus = true } = {}) {
    const panels = Array.from(this.element.querySelectorAll("[data-voting-profile]"));
    if (!panels.length) return;
    const selected = panels.find(panel => panel.dataset.profileId === String(profileId)) ?? panels[0];
    this.selectedProfileId = selected.dataset.profileId;
    const select = this.element.querySelector('[name="votingProfileSelect"]');
    if (select) select.value = this.selectedProfileId;
    for (const panel of panels) panel.hidden = panel !== selected;
    const deleteButton = this.element.querySelector('[data-action="delete-profile"]');
    if (deleteButton) deleteButton.disabled = panels.length <= 1;
    const addQuestion = this.element.querySelector('[data-action="add-question"]');
    if (addQuestion) addQuestion.disabled = selected.querySelectorAll('[data-config-row="question"]').length >= MAX_QUESTIONS;
    if (focus) selected.querySelector('input[name="profileName"]')?.focus?.();
  }

  #addProfile() {
    const host = this.element.querySelector("[data-profile-panels]");
    const select = this.element.querySelector('[name="votingProfileSelect"]');
    if (!host || !select) return;
    const id = randomId("profile");
    const number = host.querySelectorAll("[data-voting-profile]").length + 1;
    select.insertAdjacentHTML("beforeend", `<option value="${htmlEscape(id)}">Voting Profile ${number}</option>`);
    host.insertAdjacentHTML("beforeend", this.#profilePanel({
      id,
      name: `Voting Profile ${number}`,
      allowSelfVoting: false,
      ballotVisibility: BALLOT_VISIBILITY.SECRET,
      questions: [{ id: randomId("question"), title: "Question 1", shortLabel: "Q1", description: "", voteType: VOTE_TYPES.OPTION, points: 0, resolveTiesByGM: true, options: this.#defaultOptions() }]
    }));
    this.#setVotingProfile(id);
    this.#renumberVotingRows();
    this.element.querySelectorAll(`[data-voting-profile][data-profile-id="${cssEscape(id)}"] [data-config-row="question"]`).forEach(row => this.#syncQuestionType(row, { initial: true }));
  }

  #deleteProfile() {
    const panels = Array.from(this.element.querySelectorAll("[data-voting-profile]"));
    if (panels.length <= 1) return ui.notifications.warn("At least one Voting Profile is required.");
    const current = panels.find(panel => panel.dataset.profileId === this.selectedProfileId);
    if (!current) return;
    const select = this.element.querySelector('[name="votingProfileSelect"]');
    select?.querySelector(`option[value="${cssEscape(this.selectedProfileId)}"]`)?.remove();
    current.remove();
    const remaining = Array.from(this.element.querySelectorAll("[data-voting-profile]"));
    this.#setVotingProfile(remaining[0]?.dataset.profileId ?? "");
  }

  #addQuestion() {
    const panel = this.element.querySelector(`[data-voting-profile][data-profile-id="${cssEscape(this.selectedProfileId)}"]`);
    const list = panel?.querySelector("[data-question-list]");
    const count = list?.querySelectorAll('[data-config-row="question"]').length ?? 0;
    if (!list) return;
    if (count >= MAX_QUESTIONS) return ui.notifications.warn(`A maximum of ${MAX_QUESTIONS} questions is supported per Voting Profile.`);
    const row = {
      id: randomId("question"), title: `Question ${count + 1}`, shortLabel: `Q${count + 1}`, description: "",
      voteType: VOTE_TYPES.ACTOR, points: 0, resolveTiesByGM: true, options: this.#defaultOptions()
    };
    list.insertAdjacentHTML("beforeend", this.#questionRow(row));
    const inserted = list.lastElementChild;
    this.#syncQuestionType(inserted, { initial: true });
    this.#renumberVotingRows();
  }

  #addReason({ fallback = false } = {}) {
    const list = this.element.querySelector("[data-reason-list]");
    if (!list) return;
    if (!fallback) list.querySelector('[data-config-row="reason"][data-virtual="true"]')?.remove();
    list.insertAdjacentHTML("beforeend", this.#reasonRow({
      id: fallback ? "default-reason" : randomId("reason"), title: fallback ? "Default" : "New Reason", description: "", points: 1, virtual: fallback
    }));
  }

  #addBenefit({ fallback = false } = {}) {
    const list = this.element.querySelector("[data-benefit-list]");
    if (!list) return;
    if (!fallback) list.querySelector('[data-config-row="benefit"][data-virtual="true"]')?.remove();
    list.insertAdjacentHTML("beforeend", this.#benefitRow({
      id: fallback ? "default-benefit" : randomId("benefit"), name: fallback ? "Default" : "New Benefit",
      description: fallback ? "Default reward benefit." : "Describe what this benefit grants.", cost: 1, virtual: fallback
    }));
  }

  #rowAction(button) {
    const row = button.closest("[data-config-row]");
    if (!row) return;
    const action = button.dataset.rowAction;
    const list = row.parentElement;
    const type = row.dataset.configRow;
    if (action === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (action === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    if (action === "add-option" && type === "question") {
      const optionList = row.querySelector("[data-option-list]");
      const count = optionList?.querySelectorAll('[data-config-row="option"]').length ?? 0;
      if (!optionList) return;
      if (count >= MAX_OPTIONS) return ui.notifications.warn(`A maximum of ${MAX_OPTIONS} options is supported per question.`);
      optionList.insertAdjacentHTML("beforeend", this.#optionRow({ id: randomId("option"), label: `Option ${count + 1}`, description: "" }));
    }
    if (action === "delete") {
      if (type === "question") {
        const rows = list.querySelectorAll('[data-config-row="question"]');
        if (rows.length <= MIN_QUESTIONS) return ui.notifications.warn(`At least ${MIN_QUESTIONS} question is required in every Voting Profile.`);
        row.remove();
      } else if (type === "option") {
        const rows = list.querySelectorAll('[data-config-row="option"]');
        if (rows.length <= MIN_OPTIONS) return ui.notifications.warn(`Option Vote questions require at least ${MIN_OPTIONS} options.`);
        row.remove();
      } else {
        row.remove();
        if (!list.querySelector(`[data-config-row="${type}"]`)) {
          if (type === "reason") this.#addReason({ fallback: true });
          if (type === "benefit") this.#addBenefit({ fallback: true });
        }
      }
    }
    this.#renumberVotingRows();
  }

  #renumberVotingRows() {
    for (const profile of this.element.querySelectorAll("[data-voting-profile]")) {
      const questions = Array.from(profile.querySelectorAll(':scope [data-question-list] > [data-config-row="question"]'));
      questions.forEach((row, index) => {
        row.querySelector("[data-position]").textContent = `#${index + 1}`;
        row.querySelectorAll(':scope > .pr-question-head [data-row-action]').forEach(button => {
          if (button.dataset.rowAction === "up") button.disabled = index === 0;
          if (button.dataset.rowAction === "down") button.disabled = index === questions.length - 1;
        });
        const options = Array.from(row.querySelectorAll('[data-option-list] > [data-config-row="option"]'));
        options.forEach((option, optionIndex) => {
          option.querySelector("[data-option-position]").textContent = `${optionIndex + 1}`;
          option.querySelectorAll("[data-row-action]").forEach(button => {
            if (button.dataset.rowAction === "up") button.disabled = optionIndex === 0;
            if (button.dataset.rowAction === "down") button.disabled = optionIndex === options.length - 1;
          });
        });
        const addOption = row.querySelector('[data-row-action="add-option"]');
        if (addOption) addOption.disabled = options.length >= MAX_OPTIONS;
      });
    }
    const current = this.element.querySelector(`[data-voting-profile][data-profile-id="${cssEscape(this.selectedProfileId)}"]`);
    const addQuestion = this.element.querySelector('[data-action="add-question"]');
    if (addQuestion && current) addQuestion.disabled = current.querySelectorAll('[data-config-row="question"]').length >= MAX_QUESTIONS;
  }

  #syncQuestionType(row, { initial = false } = {}) {
    if (!row) return;
    const select = row.querySelector('[name="questionType"]');
    const points = row.querySelector('[name="questionPoints"]');
    const optionArea = row.querySelector("[data-option-area]");
    const isOption = select?.value === VOTE_TYPES.OPTION;
    if (isOption) {
      if (!initial && points && !points.disabled) row.dataset.lastActorPoints = String(Math.max(0, Math.trunc(Number(points.value) || 0)));
      if (points) { points.value = "0"; points.disabled = true; }
      if (optionArea) optionArea.hidden = false;
    } else {
      if (points) {
        points.disabled = false;
        if (!initial && Number(points.value) === 0 && row.dataset.lastActorPoints) points.value = row.dataset.lastActorPoints;
      }
      if (optionArea) optionArea.hidden = true;
    }
  }

  #defaultOptions() {
    return [
      { id: randomId("option"), label: "Option 1", description: "" },
      { id: randomId("option"), label: "Option 2", description: "" }
    ];
  }

  #profilePanel(profile) {
    return `<section class="pr-voting-profile-editor" data-voting-profile data-profile-id="${htmlEscape(profile.id)}" hidden>
      <div class="pr-profile-meta-grid">
        <label class="pr-field pr-wide">Profile Name<input name="profileName" value="${htmlEscape(profile.name)}" maxlength="80" required></label>
        <label class="pr-compact-toggle"><input type="checkbox" name="profileSelfVoting" ${profile.allowSelfVoting ? "checked" : ""}><span><strong>Allow Self Voting</strong><small>Actor Vote questions only.</small></span></label>
        <label class="pr-compact-toggle"><input type="checkbox" name="profilePublicBallots" ${profile.ballotVisibility === BALLOT_VISIBILITY.PUBLIC ? "checked" : ""}><span><strong>Public Ballots</strong><small>Reveal who voted for what after finalization.</small></span></label>
      </div>
      <div class="pr-config-list pr-question-config-list" data-question-list>${profile.questions.map(question => this.#questionRow(question)).join("")}</div>
    </section>`;
  }

  #questionRow(row) {
    const options = Array.isArray(row.options) && row.options.length ? row.options : this.#defaultOptions();
    return `<article class="pr-question-row" data-config-row="question" data-id="${htmlEscape(row.id)}" data-last-actor-points="${Math.max(0, Number(row.points) || 0)}">
      <div class="pr-question-head"><span class="pr-position" data-position></span><label>Title<input name="questionTitle" value="${htmlEscape(row.title)}" maxlength="80" required></label><label>Short Label<input name="questionShort" value="${htmlEscape(row.shortLabel)}" maxlength="12" required></label><label>Type<select name="questionType"><option value="actor" ${row.voteType === VOTE_TYPES.ACTOR ? "selected" : ""}>Actor Vote</option><option value="option" ${row.voteType === VOTE_TYPES.OPTION ? "selected" : ""}>Option Vote</option></select></label><label class="pr-points-field">Points<input name="questionPoints" type="number" min="0" step="1" value="${row.voteType === VOTE_TYPES.OPTION ? 0 : Math.max(0, Number(row.points) || 0)}"></label><div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move left"><i class="fa-solid fa-arrow-left"></i></button><button type="button" data-row-action="down" data-tooltip="Move right"><i class="fa-solid fa-arrow-right"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete question"><i class="fa-solid fa-trash"></i></button></div></div>
      <div class="pr-question-body"><label class="pr-field pr-grow">Description<input name="questionDescription" value="${htmlEscape(row.description ?? "")}" maxlength="220"></label><label class="pr-mini-toggle"><input type="checkbox" name="questionResolveTie" ${row.resolveTiesByGM !== false ? "checked" : ""}><span><strong>GM resolves ties</strong><small>Unchecked keeps tied first-place results.</small></span></label></div>
      <div class="pr-option-area" data-option-area ${row.voteType === VOTE_TYPES.OPTION ? "" : "hidden"}><div class="pr-option-area-head"><span><strong>Answer Options</strong><small>Players choose one option for this question.</small></span><button type="button" data-row-action="add-option"><i class="fa-solid fa-plus"></i> Add Option</button></div><div class="pr-option-list" data-option-list>${options.map(option => this.#optionRow(option)).join("")}</div></div>
    </article>`;
  }

  #optionRow(row) {
    return `<div class="pr-option-row" data-config-row="option" data-id="${htmlEscape(row.id)}"><span class="pr-option-position" data-option-position></span><label>Label<input name="optionLabel" value="${htmlEscape(row.label)}" maxlength="80" required></label><label class="pr-grow">Description<input name="optionDescription" value="${htmlEscape(row.description ?? "")}" maxlength="180"></label><div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move up"><i class="fa-solid fa-arrow-up"></i></button><button type="button" data-row-action="down" data-tooltip="Move down"><i class="fa-solid fa-arrow-down"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete option"><i class="fa-solid fa-trash"></i></button></div></div>`;
  }

  #reasonRow(row) {
    return `<article class="pr-config-row" data-config-row="reason" data-id="${htmlEscape(row.id)}" data-virtual="${row.virtual ? "true" : "false"}"><label>Title<input name="reasonTitle" value="${htmlEscape(row.title)}" maxlength="80" required></label><label class="pr-grow">Description<input name="reasonDescription" value="${htmlEscape(row.description)}" maxlength="220"></label><label class="pr-points-field">Points<input name="reasonPoints" type="number" min="1" step="1" value="${Math.max(1, Number(row.points) || 1)}" required></label><div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move up"><i class="fa-solid fa-arrow-up"></i></button><button type="button" data-row-action="down" data-tooltip="Move down"><i class="fa-solid fa-arrow-down"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete reason"><i class="fa-solid fa-trash"></i></button></div></article>`;
  }

  #benefitRow(row) {
    return `<article class="pr-config-row" data-config-row="benefit" data-id="${htmlEscape(row.id)}" data-virtual="${row.virtual ? "true" : "false"}"><label>Name<input name="benefitName" value="${htmlEscape(row.name)}" maxlength="80" required></label><label class="pr-grow">Description<input name="benefitDescription" value="${htmlEscape(row.description)}" maxlength="260" required></label><label class="pr-points-field">Cost<input name="benefitCost" type="number" min="1" step="1" value="${Math.max(1, Number(row.cost) || 1)}" required></label><div class="pr-row-actions"><button type="button" data-row-action="up" data-tooltip="Move up"><i class="fa-solid fa-arrow-up"></i></button><button type="button" data-row-action="down" data-tooltip="Move down"><i class="fa-solid fa-arrow-down"></i></button><button type="button" data-row-action="delete" data-tooltip="Delete benefit"><i class="fa-solid fa-trash"></i></button></div></article>`;
  }

  async #exportConfig(type) {
    try {
      const config = this.#serialize();
      const payload = EcosystemTransferService.build(type, config);
      const names = {
        [ECOSYSTEM_EXPORT_TYPES.ALL]: "polls-points-rewards-ecosystem.json",
        [ECOSYSTEM_EXPORT_TYPES.VOTING]: "polls-points-rewards-voting-profiles.json",
        [ECOSYSTEM_EXPORT_TYPES.REASONS]: "polls-points-rewards-give-point-reasons.json",
        [ECOSYSTEM_EXPORT_TYPES.BENEFITS]: "polls-points-rewards-redeem-benefits.json"
      };
      await downloadJsonFile(payload, names[type] ?? "polls-points-rewards-config.json");
      ui.notifications.info("Polls, Points & Rewards configuration exported.");
    } catch (error) {
      console.error(`${MODULE_ID} | Configuration export failed.`, error);
      ui.notifications.error(error.message || "Configuration export failed.");
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
        [ECOSYSTEM_EXPORT_TYPES.ALL]: "Voting Profiles, Give Point Reasons, and Redeem Benefits",
        [ECOSYSTEM_EXPORT_TYPES.VOTING]: "Voting Profiles",
        [ECOSYSTEM_EXPORT_TYPES.REASONS]: "Give Point Reasons",
        [ECOSYSTEM_EXPORT_TYPES.BENEFITS]: "Redeem Benefits"
      };
      const mode = await importModeDialog(labels[type] ?? "configuration");
      if (!mode) return;
      this._busy = true;
      if (type === ECOSYSTEM_EXPORT_TYPES.ALL) {
        this.#applyImportedSection(ECOSYSTEM_EXPORT_TYPES.VOTING, parsed.data.votingProfiles, mode);
        this.#applyImportedSection(ECOSYSTEM_EXPORT_TYPES.REASONS, parsed.data.givePointReasons, mode);
        this.#applyImportedSection(ECOSYSTEM_EXPORT_TYPES.BENEFITS, parsed.data.redeemBenefits, mode);
      } else {
        const key = type === ECOSYSTEM_EXPORT_TYPES.VOTING ? "votingProfiles" : type === ECOSYSTEM_EXPORT_TYPES.REASONS ? "givePointReasons" : "redeemBenefits";
        this.#applyImportedSection(type, parsed.data[key], mode);
      }
      ui.notifications.info(`Imported ${labels[type] ?? "configuration"}. Review and click Save Settings to commit the changes.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Configuration import failed.`, error);
      ui.notifications.error(error.message || "Configuration import failed.", { permanent: true });
    } finally {
      this._busy = false;
    }
  }

  #applyImportedSection(type, importedRows, mode) {
    if (type === ECOSYSTEM_EXPORT_TYPES.VOTING) {
      const host = this.element.querySelector("[data-profile-panels]");
      const select = this.element.querySelector('[name="votingProfileSelect"]');
      if (!host || !select) throw new Error("Voting Profiles editor is unavailable.");
      const current = this.#serialize().votingProfiles;
      const rows = mode === "merge" ? EcosystemTransferService.merge(type, current, importedRows) : importedRows;
      const withIds = rows.map(profile => ({
        ...profile,
        id: profile.id || randomId("profile"),
        questions: profile.questions.map(question => ({
          ...question,
          id: question.id || randomId("question"),
          options: (question.options ?? []).map(option => ({ ...option, id: option.id || randomId("option") }))
        }))
      }));
      host.innerHTML = withIds.map(profile => this.#profilePanel(profile)).join("");
      select.innerHTML = withIds.map(profile => `<option value="${htmlEscape(profile.id)}">${htmlEscape(profile.name)}</option>`).join("");
      this.#setVotingProfile(withIds[0]?.id ?? "");
      this.element.querySelectorAll('[data-config-row="question"]').forEach(row => this.#syncQuestionType(row, { initial: true }));
      this.#renumberVotingRows();
      return;
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.REASONS) {
      const list = this.element.querySelector("[data-reason-list]");
      if (!list) throw new Error("Give Point Reasons list is unavailable.");
      const current = this.#serialize().giveReasons;
      const rows = mode === "merge" ? EcosystemTransferService.merge(type, current, importedRows) : importedRows;
      list.innerHTML = rows.length ? rows.map(row => this.#reasonRow({ ...row, id: row.id || randomId("reason"), virtual: false })).join("") : "";
      if (!rows.length) this.#addReason({ fallback: true });
      return;
    }
    if (type === ECOSYSTEM_EXPORT_TYPES.BENEFITS) {
      const list = this.element.querySelector("[data-benefit-list]");
      if (!list) throw new Error("Redeem Benefits list is unavailable.");
      const current = this.#serialize().benefits;
      const rows = mode === "merge" ? EcosystemTransferService.merge(type, current, importedRows) : importedRows;
      list.innerHTML = rows.length ? rows.map(row => this.#benefitRow({ ...row, id: row.id || randomId("benefit"), virtual: false })).join("") : "";
      if (!rows.length) this.#addBenefit({ fallback: true });
    }
  }

  #serialize() {
    const root = this.element;
    const pointMethod = root.querySelector('[name="pointMethod"]:checked')?.value === POINT_METHODS.ACCOUNT ? POINT_METHODS.ACCOUNT : POINT_METHODS.CHARACTER;
    const votingProfiles = Array.from(root.querySelectorAll("[data-voting-profile]")).map(profile => ({
      id: profile.dataset.profileId || randomId("profile"),
      name: String(profile.querySelector('[name="profileName"]')?.value ?? "").trim(),
      allowSelfVoting: Boolean(profile.querySelector('[name="profileSelfVoting"]')?.checked),
      ballotVisibility: profile.querySelector('[name="profilePublicBallots"]')?.checked ? BALLOT_VISIBILITY.PUBLIC : BALLOT_VISIBILITY.SECRET,
      questions: Array.from(profile.querySelectorAll(':scope [data-question-list] > [data-config-row="question"]')).map(row => {
        const voteType = row.querySelector('[name="questionType"]')?.value === VOTE_TYPES.OPTION ? VOTE_TYPES.OPTION : VOTE_TYPES.ACTOR;
        return {
          id: row.dataset.id || randomId("question"),
          title: String(row.querySelector('[name="questionTitle"]')?.value ?? "").trim(),
          shortLabel: String(row.querySelector('[name="questionShort"]')?.value ?? "").trim(),
          description: String(row.querySelector('[name="questionDescription"]')?.value ?? "").trim(),
          voteType,
          points: voteType === VOTE_TYPES.ACTOR ? Math.max(0, Math.trunc(Number(row.querySelector('[name="questionPoints"]')?.value) || 0)) : 0,
          resolveTiesByGM: Boolean(row.querySelector('[name="questionResolveTie"]')?.checked),
          options: voteType === VOTE_TYPES.OPTION ? Array.from(row.querySelectorAll('[data-option-list] > [data-config-row="option"]')).map(option => ({
            id: option.dataset.id || randomId("option"),
            label: String(option.querySelector('[name="optionLabel"]')?.value ?? "").trim(),
            description: String(option.querySelector('[name="optionDescription"]')?.value ?? "").trim()
          })) : []
        };
      })
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
      allowNegativeBalance: Boolean(root.querySelector('[name="allowNegativeBalance"]')?.checked),
      postVotingResultsToChat: Boolean(root.querySelector('[name="postVotingResultsToChat"]')?.checked),
      showSheetPoints: Boolean(root.querySelector('[name="showSheetPoints"]')?.checked),
      showRedemptionBalanceInChat: Boolean(root.querySelector('[name="showRedemptionBalanceInChat"]')?.checked),
      notifyPointAdjustments: Boolean(root.querySelector('[name="notifyPointAdjustments"]')?.checked),
      votingProfiles,
      giveReasons,
      benefits,
      importedPresetGroups: BuiltInPresetsService.prune({ votingProfiles, giveReasons, benefits, importedPresetGroups: this._presetGroups ?? [] })
    };
  }

  #serializePrimaryAssignments() {
    return Object.fromEntries(Array.from(this.element.querySelectorAll("[data-normalization-row]")).map(row => [
      String(row.dataset.actorId || ""), String(row.querySelector('[name="primaryUser"]')?.value ?? "")
    ]).filter(([actorId]) => actorId));
  }

  #validate(config) {
    if (!config.votingProfiles.length) return "At least one Voting Profile is required.";
    for (const profile of config.votingProfiles) {
      if (!profile.name) return "Every Voting Profile needs a name.";
      if (profile.questions.length < MIN_QUESTIONS || profile.questions.length > MAX_QUESTIONS) return `Every Voting Profile requires ${MIN_QUESTIONS}–${MAX_QUESTIONS} questions.`;
      for (const question of profile.questions) {
        if (!question.title || !question.shortLabel) return `Every question in ${profile.name} needs a Title and Short Label.`;
        if (question.voteType === VOTE_TYPES.OPTION) {
          if (question.options.length < MIN_OPTIONS || question.options.length > MAX_OPTIONS) return `Option Vote questions require ${MIN_OPTIONS}–${MAX_OPTIONS} options.`;
          if (question.options.some(option => !option.label)) return "Every custom voting option needs a label.";
        }
      }
    }
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
      const pending = [...this._pendingJournalJobs.values()];
      const journalFailures = [];
      for (const job of pending) {
        try { await PresetJournalService.import(job.entry, job.groupId, { updateExisting: job.updateExisting }); }
        catch (error) { console.error(`${MODULE_ID} | Could not create Player Journals`, error); journalFailures.push(`${job.entry.name}: ${error.message}`); }
      }
      this._pendingJournalJobs.clear();
      if (journalFailures.length) ui.notifications.warn(`Settings saved, but some Player Journals failed: ${journalFailures.join("; ")}`, { permanent: true });
      else ui.notifications.info("Polls, Points & Rewards settings saved.");
      await this.close();
    } catch (saveError) {
      console.error(`${MODULE_ID} | Settings could not be saved.`, saveError);
      ui.notifications.error(saveError.message, { permanent: true });
    } finally {
      this._busy = false;
    }
  }
}

function stripVotingIds(profile) {
  return {
    name: profile.name,
    allowSelfVoting: profile.allowSelfVoting,
    ballotVisibility: profile.ballotVisibility,
    questions: profile.questions.map(question => ({
      title: question.title,
      shortLabel: question.shortLabel,
      description: question.description,
      voteType: question.voteType,
      points: question.points,
      resolveTiesByGM: question.resolveTiesByGM,
      options: (question.options ?? []).map(option => ({ label: option.label, description: option.description }))
    }))
  };
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
