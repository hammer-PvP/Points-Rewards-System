import { MODULE_ID } from "./constants.mjs";

export function randomId(prefix = "pr") {
  const random = foundry.utils.randomID?.() ?? crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function htmlEscape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

export function asRoot(element, app = null) {
  return element instanceof HTMLElement ? element : element?.[0] ?? app?.element ?? null;
}

export function appV2Api() {
  return foundry?.applications?.api ?? {};
}

export async function confirmDialog({ title, content, yes = "Confirm", no = "Cancel", danger = false } = {}) {
  const DialogV2 = appV2Api().DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title: title ?? "Confirm" },
      content: content ?? "",
      yes: { label: yes, icon: danger ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-check" },
      no: { label: no, icon: "fa-solid fa-xmark" },
      rejectClose: false
    });
  }
  if (globalThis.Dialog) {
    return new Promise(resolve => {
      new Dialog({
        title: title ?? "Confirm",
        content: content ?? "",
        buttons: {
          yes: { label: yes, callback: () => resolve(true) },
          no: { label: no, callback: () => resolve(false) }
        },
        default: "no",
        close: () => resolve(false)
      }).render(true);
    });
  }
  return globalThis.confirm?.(String(content ?? title ?? "Confirm?")) ?? false;
}

export function formatSigned(value) {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
}

export function formatDateTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch (_error) {
    return date.toLocaleString();
  }
}

export function actorFolderActors(folderId) {
  if (!folderId) return [];
  return game.actors.filter(actor => actor.folder?.id === folderId).sort((a, b) => a.name.localeCompare(b.name));
}

export function isActorDirectoryApp(app) {
  const name = String(app?.constructor?.name ?? "");
  const classes = app?.options?.classes ?? [];
  return name.includes("ActorDirectory")
    || name.includes("ActorsDirectory")
    || app?.collection === game.actors
    || (classes.includes("directory") && classes.includes("actors"));
}

export function primaryActiveGM() {
  return game.users
    .filter(user => user.isGM && user.active)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

export function isPrimaryGM() {
  return game.user?.isGM && primaryActiveGM()?.id === game.user.id;
}

export function hasModuleData(actor) {
  if (!actor) return false;
  return Boolean(
    actor.getFlag(MODULE_ID, "account")
    || actor.getFlag(MODULE_ID, "accountUserId")
    || actor.getFlag(MODULE_ID, "participating")
  );
}
