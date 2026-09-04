import { MODULE_ID } from "../constants.mjs";
import { VotingService } from "../services/voting-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TieBreakApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(results, options = {}) {
    super(options);
    this.results = results ?? [];
    this._busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "points-rewards-tie-break",
    classes: ["points-rewards-system", "pr-tie-break-app"],
    tag: "form",
    position: { width: 580, height: 560 },
    window: { title: "Resolve Voting Ties", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/tie-break.hbs` }
  };

  async _prepareContext() {
    return { ties: this.results.filter(row => row.tied?.length > 1) };
  }

  _onRender() {
    this.element.querySelector('[data-action="finalize"]')?.addEventListener("click", event => void this.#finalize(event));
  }

  async #finalize(event) {
    event.preventDefault();
    if (this._busy) return;
    const ties = this.results.filter(row => row.tied?.length > 1);
    const choices = {};
    for (const row of ties) {
      const selected = this.element.querySelector(`input[name="tie-${CSS.escape(row.category.id)}"]:checked`);
      if (!selected) return ui.notifications.warn(`Choose a winner for ${row.category.title}.`);
      choices[row.category.id] = selected.value;
    }
    try {
      this._busy = true;
      await VotingService.finalize(choices);
      ui.notifications.info("Voting finalized and points awarded.");
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Voting finalization failed.`, error);
      ui.notifications.error(error.message, { permanent: true });
      this._busy = false;
    }
  }
}
