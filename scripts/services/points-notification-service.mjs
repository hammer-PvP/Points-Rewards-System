import { MODULE_ID, MODULE_TITLE, POINT_METHODS } from "../constants.mjs";
import { htmlEscape } from "../utils.mjs";
import { AccountService } from "./account-service.mjs";
import { SettingsService } from "./settings-service.mjs";

/** Non-authoritative, privacy-preserving feedback for committed GM point changes.
 * Failures here never undo or change a ledger commit. Poll awards use their own
 * public result summary and must not call this service.
 */
export class PointsNotificationService {
  static #pending = new Set();

  static recipientsFor(actor) {
    const recipients = new Set(game.users.filter(user => user.isGM).map(user => user.id));
    const primary = AccountService.primaryUser(actor);
    if (primary && !primary.isGM) recipients.add(primary.id);
    return Array.from(recipients);
  }

  static contentFor(actor, entry, { kind = "adjustment", title = "", description = "" } = {}) {
    const delta = Number(entry.delta);
    const isRefund = kind === "refund";
    const heading = isRefund ? "Points Refunded" : delta < 0 ? "Points Deducted" : "Points Received";
    const icon = isRefund ? "fa-rotate-left" : delta < 0 ? "fa-circle-minus" : "fa-award";
    const amount = `${delta > 0 ? "+" : ""}${delta}`;
    const reason = htmlEscape(title || entry.title || (isRefund ? "Redemption Refund" : "Point adjustment"));
    const detail = htmlEscape(description || entry.description || "");
    const actorName = htmlEscape(actor?.name || entry.actorName || "Character");
    const account = entry.accountType === POINT_METHODS.ACCOUNT
      ? `<div class="pr-private-points-scope">Account-Wide Points</div>` : "";
    return `<section class="pr-chat-card pr-chat-point-notification">`
      + `<header><i class="fa-solid ${icon}" aria-hidden="true"></i><strong>${heading}</strong></header>`
      + `<div class="pr-private-points-body"><div class="pr-private-points-label">Character</div>`
      + `<strong class="pr-private-points-character">${actorName}</strong>`
      + `<div class="pr-private-points-amount ${delta < 0 ? "negative" : "positive"}">${amount} Points</div>`
      + `<div class="pr-private-points-label">${isRefund ? "Refund for" : "Reason"}</div>`
      + `<strong class="pr-private-points-reason">${reason}</strong>`
      + (detail ? `<p class="pr-private-points-description">${detail}</p>` : "")
      + account + `</div><footer><i class="fa-solid fa-lock" aria-hidden="true"></i> Private · Recipient and GMs</footer></section>`;
  }

  static async notifyCommit(actor, result, options = {}) {
    let pendingId = "";
    try {
      if (!game.user?.isGM || !SettingsService.get().notifyPointAdjustments) return false;
      const entry = result?.entry;
      if (result?.skipped || !entry?.id || !Number(entry.delta)) return false;
      const id = String(entry.id);
      if (this.#pending.has(id)) return false;
      const existing = game.messages?.contents ?? [];
      if (existing.some(message => message.getFlag?.(MODULE_ID, "pointNotification")?.transactionId === id)) return false;
      const whisper = this.recipientsFor(actor);
      if (!whisper.length) return false;
      this.#pending.add(id);
      pendingId = id;
      await ChatMessage.create({
        content: this.contentFor(actor, entry, options),
        whisper,
        speaker: { alias: MODULE_TITLE },
        flags: { [MODULE_ID]: { pointNotification: { transactionId: id, kind: String(options.kind || "adjustment") } } }
      });
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | A point commit succeeded but its private Chat notification could not be published.`, error);
      return false;
    } finally {
      if (pendingId) this.#pending.delete(pendingId);
    }

  }
}
