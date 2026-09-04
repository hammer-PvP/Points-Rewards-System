import { MODULE_ID } from "../constants.mjs";
import { VotingService } from "../services/voting-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VotingApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static current = null;

  constructor(options = {}) {
    super(options);
    this.sessionId = String(options.sessionId ?? "");
    this._submitting = false;
  }

  static DEFAULT_OPTIONS = {
    id: "points-rewards-voting",
    classes: ["points-rewards-system", "pr-voting-app"],
    tag: "form",
    position: { width: 760, height: 560 },
    window: { title: "Session Voting", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/voting.hbs` }
  };

  async _prepareContext() {
    const session = VotingService.active();
    if (!session || session.id !== this.sessionId) return { missing: true };
    const owned = new Set(session.candidates.filter(row => VotingService.candidatePrimaryUserId(row) === game.user.id).map(row => row.actorId));
    return {
      missing: false,
      session,
      categories: session.categories,
      candidates: session.candidates.map(candidate => ({
        ...candidate,
        blocked: !session.allowSelfVoting && owned.has(candidate.actorId)
      })),
      allowSelfVoting: session.allowSelfVoting
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector('[data-action="submit-vote"]')?.addEventListener("click", event => void this.#submit(event));
    root.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener("change", () => this.#refreshSubmitState()));
    this.#refreshSubmitState();
  }

  #refreshSubmitState() {
    const session = VotingService.active();
    const button = this.element.querySelector('[data-action="submit-vote"]');
    if (!session || !button) return;
    const selected = new Set(Array.from(this.element.querySelectorAll('input[type="radio"]:checked')).map(input => input.name));
    const complete = session.categories.every(category => selected.has(`category-${category.id}`));
    button.disabled = !complete || this._submitting;
    const count = this.element.querySelector("[data-vote-progress]");
    if (count) count.textContent = `${selected.size} / ${session.categories.length} selected`;
  }

  async #submit(event) {
    event.preventDefault();
    if (this._submitting) return;
    const session = VotingService.active();
    if (!session || session.id !== this.sessionId) return ui.notifications.warn("This voting session is no longer open.");
    const selections = {};
    for (const category of session.categories) {
      const input = this.element.querySelector(`input[name="category-${CSS.escape(category.id)}"]:checked`);
      if (!input) return ui.notifications.warn("Select one Actor in every category before submitting.");
      selections[category.id] = input.value;
    }
    try {
      this._submitting = true;
      this.#refreshSubmitState();
      await VotingService.submit(session.id, selections);
      ui.notifications.info("Your votes were submitted.");
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Vote submission failed.`, error);
      ui.notifications.error(error.message);
      this._submitting = false;
      this.#refreshSubmitState();
    }
  }

  async close(options = {}) {
    if (VotingApp.current === this) VotingApp.current = null;
    return super.close(options);
  }
}
