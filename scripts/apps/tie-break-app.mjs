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
    position: { width: 600, height: 580 },
    window: { title: "Resolve Poll Ties", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/tie-break.hbs` }
  };

  async _prepareContext() {
    return {
      ties: this.results.filter(row => row.needsTieBreak).map(row => ({
        ...row,
        tied: row.tied.map(choice => ({ ...choice, hasImage: Boolean(choice.img) })),
        hasPoints: row.question.points > 0
      }))
    };
  }

  _onRender() {
    this.element.querySelector('[data-action="finalize"]')?.addEventListener("click", event => void this.#finalize(event));
  }

  async #finalize(event) {
    event.preventDefault();
    if (this._busy) return;
    const ties = this.results.filter(row => row.needsTieBreak);
    const choices = {};
    for (const row of ties) {
      const selected = this.element.querySelector(`input[name="tie-${CSS.escape(row.question.id)}"]:checked`);
      if (!selected) return ui.notifications.warn(`Choose the GM tie-break result for ${row.question.title}.`);
      choices[row.question.id] = selected.value;
    }
    try {
      this._busy = true;
      await VotingService.finalize(choices);
      ui.notifications.info("Poll finalized.");
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Poll finalization failed.`, error);
      ui.notifications.error(error.message, { permanent: true });
      this._busy = false;
    }
  }
}
