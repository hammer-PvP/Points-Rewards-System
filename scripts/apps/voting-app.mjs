import { MODULE_ID, VOTE_TYPES } from "../constants.mjs";
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
    position: { width: 800, height: 620 },
    window: { title: "Poll", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/voting.hbs` }
  };

  async _prepareContext() {
    const session = VotingService.active();
    if (!session || session.id !== this.sessionId) return { missing: true };
    const blockedActorIds = new Set(
      session.candidates
        .filter(candidate => VotingService.candidatePrimaryUserId(candidate) === game.user.id)
        .map(candidate => candidate.actorId)
    );
    const allActorQuestions = session.questions.every(question => question.voteType === VOTE_TYPES.ACTOR);
    const questions = session.questions.map(question => ({
      ...question,
      isActor: question.voteType === VOTE_TYPES.ACTOR,
      isOption: question.voteType === VOTE_TYPES.OPTION,
      hasPoints: question.voteType === VOTE_TYPES.ACTOR && question.points > 0,
      choices: VotingService.choicesForQuestion(session, question).map(choice => ({
        ...choice,
        blocked: question.voteType === VOTE_TYPES.ACTOR && !session.allowSelfVoting && blockedActorIds.has(choice.valueId)
      }))
    }));
    return {
      missing: false,
      session,
      questions,
      allActorQuestions,
      candidates: session.candidates.map(candidate => ({
        ...candidate,
        blocked: !session.allowSelfVoting && blockedActorIds.has(candidate.actorId)
      })),
      allowSelfVoting: session.allowSelfVoting,
      hasActorQuestions: questions.some(question => question.isActor),
      publicBallots: session.ballotVisibility === "public"
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
    const complete = session.questions.every(question => selected.has(`question-${question.id}`));
    button.disabled = !complete || this._submitting;
    const count = this.element.querySelector("[data-vote-progress]");
    if (count) count.textContent = `${selected.size} / ${session.questions.length} selected`;
  }

  async #submit(event) {
    event.preventDefault();
    if (this._submitting) return;
    const session = VotingService.active();
    if (!session || session.id !== this.sessionId) return ui.notifications.warn("This poll is no longer open.");
    const selections = {};
    for (const question of session.questions) {
      const input = this.element.querySelector(`input[name="question-${CSS.escape(question.id)}"]:checked`);
      if (!input) return ui.notifications.warn("Select one answer for every question before submitting.");
      selections[question.id] = input.value;
    }
    try {
      this._submitting = true;
      this.#refreshSubmitState();
      await VotingService.submit(session.id, selections);
      ui.notifications.info("Your ballot was submitted.");
      await this.close();
    } catch (error) {
      console.error(`${MODULE_ID} | Ballot submission failed.`, error);
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
