import { MODULE_ID } from "../constants.mjs";
import { AccountService } from "./account-service.mjs";
import { SettingsService } from "./settings-service.mjs";
import { PointsNotificationService } from "./points-notification-service.mjs";
import { confirmDialog, htmlEscape, isPrimaryGM, randomId } from "../utils.mjs";

/** Player requests are carried by their own User document, not an unauthenticated socket userId.
 * The Foundry server checks document update permissions before forwarding updateUser to the GM.
 * Only the elected GM commits point changes to the World ledger.
 */
export class PlayerRedemptionService {
  static REQUEST_FLAG = "redemptionRequest";
  static RESULT_FLAG = "redemptionResult";
  static #inflight = new Map();
  static #gmQueue = Promise.resolve();

  static eligibleActors(user = game.user) {
    if (!user) return [];
    const configured = new Set(AccountService.configuredActors().map(actor => actor.id));
    return AccountService.trackedActors()
      .filter(actor => {
        if (AccountService.primaryUser(actor)?.id !== user.id) return false;
        if (!actor.testUserPermission?.(user, "OWNER")) return false;
        return configured.has(actor.id) || AccountService.hasWorldAccount(actor);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static canRedeemActor(actor, user = game.user) {
    return Boolean(actor && this.eligibleActors(user).some(candidate => candidate.id === actor.id));
  }

  static benefits() {
    // Do not treat the virtual Settings placeholder as a redeemable benefit.
    return SettingsService.get().benefits.filter(benefit => benefit && !benefit.virtual);
  }

  static availableGM() {
    return Array.from(game.users).some(user => user.isGM && user.active);
  }

  static async request(actorId, benefitId) {
    if (game.user?.isGM) throw new Error("Use the GM Manager for GM-controlled redemptions.");
    if (!this.availableGM()) throw new Error("A GM must be online to authorize a point redemption.");
    const actor = game.actors.get(actorId);
    if (!this.canRedeemActor(actor)) throw new Error("You cannot redeem points for this character.");
    const benefit = this.benefits().find(row => row.id === benefitId);
    if (!benefit) throw new Error("That reward is no longer available.");
    const current = AccountService.balance(actor);
    if (!SettingsService.get().allowNegativeBalance && current < benefit.cost) throw new Error("Insufficient points.");
    const pending = game.user.getFlag(MODULE_ID, this.REQUEST_FLAG);
    const lastResult = game.user.getFlag(MODULE_ID, this.RESULT_FLAG);
    const hasUnansweredRequest = Boolean(pending?.id && pending.id !== lastResult?.id);
    if (hasUnansweredRequest && (pending.actorId !== actor.id || pending.benefitId !== benefit.id)) {
      throw new Error("Your previous redemption is still being processed. Ask the GM to check it before requesting a different benefit.");
    }
    // A retry of an unanswered request MUST keep its original ID. A new
    // attempt marker triggers an updateUser event without creating a second
    // ledger debit if the GM already processed the original request.
    // No wall-clock timestamp is used to authorize or expire redemptions.
    const request = hasUnansweredRequest
      ? { ...pending, attempt: randomId("retry") }
      : { id: randomId("player-redeem"), actorId: actor.id, benefitId: benefit.id, attempt: randomId("submit") };
    if (this.#inflight.has(request.id)) throw new Error("Your redemption is already being processed.");
    let timer;
    const outcome = new Promise(resolve => {
      timer = setTimeout(() => {
        this.#inflight.delete(request.id);
        resolve({ pending: true, message: "The request was submitted; ask the GM to check it if no result appears." });
      }, 25000);
      this.#inflight.set(request.id, result => { clearTimeout(timer); resolve(result); });
    });
    try {
      await game.user.setFlag(MODULE_ID, this.REQUEST_FLAG, request);
    } catch (error) {
      clearTimeout(timer);
      this.#inflight.delete(request.id);
      throw error;
    }
    return outcome;
  }

  static onUpdateUser(user, changes) {
    const flags = changes?.flags?.[MODULE_ID];
    if (!flags) return;
    const changedResult = flags[this.RESULT_FLAG];
    if (user.id === game.user.id && changedResult?.id && this.#inflight.has(changedResult.id)) {
      // updateUser provides a differential update. Unchanged result fields (notably
      // ok and message) may be absent when the same benefit is redeemed again.
      // Read the completed result from the updated User document, and correlate
      // it with the exact pending request before resolving its promise.
      const result = user.getFlag(MODULE_ID, this.RESULT_FLAG);
      if (result?.id === changedResult.id) {
        const resolve = this.#inflight.get(result.id);
        this.#inflight.delete(result.id);
        resolve({
          id: result.id,
          ok: result.ok === true,
          pending: result.pending === true,
          message: typeof result.message === "string" && result.message.trim()
            ? result.message
            : (result.ok === true ? "Benefit redeemed successfully." : "The redemption could not be confirmed."),
          balance: result.balance
        });
      }
    }
    if (flags[this.REQUEST_FLAG] && isPrimaryGM()) this.#scheduleProcessing(user);
  }

  static scanPending() {
    if (!isPrimaryGM()) return;
    for (const user of game.users) {
      if (user.isGM) continue;
      const request = user.getFlag(MODULE_ID, this.REQUEST_FLAG);
      const result = user.getFlag(MODULE_ID, this.RESULT_FLAG);
      if (request?.id && request.id !== result?.id) this.#scheduleProcessing(user);
    }
  }

  static #scheduleProcessing(user) {
    this.#gmQueue = this.#gmQueue.catch(() => {}).then(() => this.#process(user));
  }

  static async #process(user) {
    if (!isPrimaryGM() || !user || user.isGM) return;
    const request = user.getFlag(MODULE_ID, this.REQUEST_FLAG);
    const previous = user.getFlag(MODULE_ID, this.RESULT_FLAG);
    if (!request?.id || previous?.id === request.id) return;
    const result = { id: request.id, ok: false, message: "Redemption was not approved." };
    try {
      // The GM and player can have different system clocks. Requests are
      // authorized by ownership, Primary User, benefit validity and balance,
      // never by a timestamp supplied by the player's computer.
      const actor = game.actors.get(String(request.actorId || ""));
      if (!this.canRedeemActor(actor, user)) throw new Error("Actor ownership or Primary User no longer permits this redemption.");
      const config = SettingsService.get();
      const benefit = config.benefits.find(row => row.id === request.benefitId && !row.virtual);
      if (!benefit) throw new Error("The selected benefit is no longer configured.");
      const cost = Number(benefit.cost);
      if (!Number.isSafeInteger(cost) || cost < 1) throw new Error("The selected benefit has an invalid cost.");
      const sourceId = `player-redemption:${request.id}`;
      const existing = AccountService.ledger(actor).find(entry => entry.sourceId === sourceId);
      let entry = existing;
      let remaining = AccountService.balance(actor);
      if (!existing) {
        if (remaining - cost < 0 && !config.allowNegativeBalance) throw new Error("Insufficient points at the time of redemption.");
        const committed = await AccountService.commit(actor, {
          delta: -cost, type: "redemption", title: benefit.name, description: `${benefit.description} (Requested by ${user.name}).`,
          sourceId, method: config.pointMethod
        });
        entry = committed.entry;
        remaining = committed.account.balance;
      }
      if (!entry) throw new Error("The redemption transaction could not be verified.");
      const alreadyPosted = Array.from(game.messages).some(message => message.getFlag(MODULE_ID, "playerRedemption")?.transactionId === entry.id);
      if (!alreadyPosted) {
        try {
          await ChatMessage.create({
            content: this.chatCardContent({ actor, benefit, cost, remaining, redeemedBy: "Player", requestedByName: user.name }),
            // The GM is still the author/committer. Speaker identifies the character
            // who actually redeemed, rather than the GM relaying the request.
            speaker: ChatMessage.getSpeaker({ actor, alias: actor.name }),
            style: CONST.CHAT_MESSAGE_STYLES.IC,
            flags: { [MODULE_ID]: { playerRedemption: {
              transactionId: entry.id, actorId: actor.id, accountType: entry.accountType,
              accountId: entry.accountId, cost, requestId: request.id, requestedByUserId: user.id, refunded: false
            } } }
          });
        } catch (chatError) {
          console.error(`${MODULE_ID} | Points debited but the redemption Chat Card could not be published.`, chatError);
          ui.notifications.error(`Points were debited for ${actor.name}, but the Chat Card failed. Check the ledger.`, { permanent: true });
        }
      }
      result.ok = true;
      result.message = `${actor.name} redeemed ${benefit.name} for ${cost} points.`;
      result.balance = remaining;
    } catch (error) {
      result.message = error?.message || "The GM could not process this redemption.";
      console.warn(`${MODULE_ID} | Player redemption rejected: ${result.message}`);
    }
    await user.setFlag(MODULE_ID, this.RESULT_FLAG, result);
  }

  /** Identical public card for player and GM redemption. Never include private
   * account data unless the GM explicitly enables balance disclosure. */
  static chatCardContent({ actor, benefit, cost, remaining, redeemedBy, requestedByName }) {
    const config = SettingsService.get();
    const showBalance = config.showRedemptionBalanceInChat === true;
    const source = redeemedBy === "GM" ? "GM" : "Player";
    const requester = String(requestedByName ?? "").trim();
    const actorName = htmlEscape(actor?.name ?? "Unknown Character");
    const benefitName = htmlEscape(benefit?.name ?? "Unknown Benefit");
    const description = htmlEscape(benefit?.description ?? "");
    const points = Number(cost);
    const balance = Number(remaining);
    const origin = `${source}${requester ? ` · ${htmlEscape(requester)}` : ""}`;
    const balanceHTML = showBalance && Number.isFinite(balance)
      ? `<div class="pr-redeem-summary-row"><span>Remaining balance</span><strong>${balance} Points</strong></div>`
        + (balance < 0 ? `<div class="pr-redeem-debt-note">Negative balance</div>` : "")
      : "";
    return `<section class="pr-chat-card pr-chat-redeem pr-redeem-chat-card">`
      + `<header><i class="fa-solid fa-gift" aria-hidden="true"></i><strong>Reward Redeemed</strong></header>`
      + `<div class="pr-redeem-chat-body">`
      + `<div class="pr-redeem-chat-field"><span class="pr-redeem-chat-label">Character</span><strong class="pr-redeem-chat-value">${actorName}</strong></div>`
      + `<div class="pr-redeem-chat-field"><span class="pr-redeem-chat-label">Benefit</span><strong class="pr-redeem-chat-benefit">${benefitName}</strong></div>`
      + `<p class="pr-redeem-chat-description">${description}</p>`
      + `</div><footer class="pr-redeem-chat-footer">`
      + `<div class="pr-redeem-summary-row"><span>Cost</span><strong>-${points} Points</strong></div>`
      + balanceHTML
      + `<div class="pr-redeem-summary-row pr-redeem-origin"><span>Redeemed by</span><strong>${origin}</strong></div>`
      + `</footer><div class="pr-chat-refund-slot"></div></section>`;
  }

  static decorateChat(message, html) {
    const flag = message.getFlag(MODULE_ID, "playerRedemption");
    if (!flag) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const slot = root?.querySelector(".pr-chat-refund-slot");
    if (!slot) return;
    slot.replaceChildren();
    if (!game.user?.isGM) return;
    const actor = game.actors.get(flag.actorId);
    const ledger = actor ? AccountService.ledger(actor, flag.accountType) : [];
    const refunded = Boolean(flag.refunded || ledger.some(entry => entry.sourceId === `reversal:${flag.transactionId}`));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pr-refund-action";
    button.disabled = refunded;
    button.innerHTML = refunded ? '<i class="fa-solid fa-check"></i> Refunded' : `<i class="fa-solid fa-rotate-left"></i> Refund ${Number(flag.cost)} Points`;
    if (!refunded) button.addEventListener("click", () => void this.refund(message, button));
    slot.append(button);
  }

  static async refund(message, button = null) {
    if (!game.user?.isGM) throw new Error("Only a GM can refund a redemption.");
    const flag = message?.getFlag(MODULE_ID, "playerRedemption");
    if (!flag?.transactionId || !flag?.actorId) throw new Error("This Chat Card has no valid redemption transaction.");
    if (button) button.disabled = true;
    try {
      const actor = game.actors.get(flag.actorId);
      if (!actor) throw new Error("The Actor was deleted. Recover/relink the account before refunding.");
      const method = SettingsService.get().pointMethod;
      if (method !== flag.accountType) throw new Error("Point Method changed since redemption. Review the archived ledger before refunding.");
      const account = AccountService.accountForActor(actor, method);
      const entry = account.ledger.find(row => row.id === flag.transactionId && row.type === "redemption" && row.actorId === actor.id);
      if (!entry || entry.accountId !== flag.accountId || entry.delta !== -flag.cost) {
        throw new Error("The original debit no longer matches this account. No points were changed.");
      }
      if (account.ledger.some(row => row.sourceId === `reversal:${entry.id}`)) {
        if (!flag.refunded) await message.setFlag(MODULE_ID, "playerRedemption", { ...flag, refunded: true });
        return;
      }
      const accepted = await confirmDialog({
        title: "Refund Reward Redemption",
        content: `<p>Refund <strong>${flag.cost} Points</strong> to <strong>${htmlEscape(actor.name)}</strong> for <strong>${htmlEscape(entry.title)}</strong>?</p><p>The original redemption remains in the ledger, linked to a reversal.</p>`,
        yes: "Refund Points"
      });
      if (!accepted) return;
      // Revalidate immediately before commit; sourceId makes repeat refunds idempotent.
      const latest = AccountService.accountForActor(actor, method);
      if (latest.ledger.some(row => row.sourceId === `reversal:${entry.id}`)) return;
      const reversal = await AccountService.reverse(actor, entry, method);
      // Reversal is already committed at this point; private Chat feedback is
      // best-effort and does not affect the refund or its idempotent source ID.
      await PointsNotificationService.notifyCommit(actor, reversal, {
        kind: "refund", title: entry.title, description: entry.description
      });
      await message.setFlag(MODULE_ID, "playerRedemption", { ...flag, refunded: true });
      ui.notifications.info(`${flag.cost} points refunded to ${actor.name}.`);
    } catch (error) {
      ui.notifications.error(error.message, { permanent: true });
      console.error(`${MODULE_ID} | Player redemption refund failed`, error);
    } finally {
      if (button) {
        const updated = message.getFlag(MODULE_ID, "playerRedemption");
        const refunded = updated?.refunded === true;
        button.disabled = refunded;
        if (refunded) button.innerHTML = '<i class="fa-solid fa-check"></i> Refunded';
      }
    }
  }
}
