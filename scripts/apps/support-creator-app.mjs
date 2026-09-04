import { SUPPORT_URL } from "../constants.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class SupportCreatorApp extends ApplicationV2 {
  render(_options = {}) {
    const opened = globalThis.open?.(SUPPORT_URL, "_blank");
    if (opened) {
      try { opened.opener = null; } catch (_error) { /* Browser policy. */ }
    } else {
      ui.notifications.info(`Support the Creator: ${SUPPORT_URL}`);
    }
    return this;
  }
}
