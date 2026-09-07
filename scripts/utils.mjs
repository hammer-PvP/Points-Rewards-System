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

export async function downloadJsonFile(data, filename) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const mime = "application/json;charset=utf-8";
  const foundrySaver = foundry?.utils?.saveDataToFile;
  if (typeof foundrySaver === "function") {
    foundrySaver(text, mime, filename);
    return;
  }
  if (typeof globalThis.saveDataToFile === "function") {
    globalThis.saveDataToFile(text, mime, filename);
    return;
  }

  // Last-resort compatibility fallback for clients which do not expose Foundry's saver.
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export function chooseJsonFile() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(value);
    };
    const onFocus = () => setTimeout(() => { if (!input.files?.length) finish(null); }, 250);
    input.addEventListener("change", async () => {
      const file = input.files?.[0] ?? null;
      if (!file) return finish(null);
      try {
        const text = await file.text();
        finish({ file, data: JSON.parse(text) });
      } catch (error) {
        finish({ file, error });
      }
    }, { once: true });
    window.addEventListener("focus", onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export async function importModeDialog(label = "configuration") {
  const DialogV2 = appV2Api().DialogV2;
  const content = `<p>How should the imported <strong>${htmlEscape(label)}</strong> be applied?</p><p><strong>Replace</strong> overwrites the current section. <strong>Merge</strong> keeps current entries and adds non-duplicate imported entries.</p>`;
  if (DialogV2?.wait) {
    return DialogV2.wait({
      window: { title: "Import Polls, Points & Rewards Configuration" },
      content,
      modal: true,
      rejectClose: false,
      buttons: [
        { action: "merge", label: "Merge", icon: "fa-solid fa-code-merge" },
        { action: "replace", label: "Replace", icon: "fa-solid fa-file-import", default: true },
        { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
      ]
    }).then(result => result === "merge" || result === "replace" ? result : null);
  }
  if (globalThis.Dialog) {
    return new Promise(resolve => {
      let settled = false;
      const done = value => { if (settled) return; settled = true; resolve(value); };
      new Dialog({
        title: "Import Polls, Points & Rewards Configuration",
        content,
        buttons: {
          merge: { icon: '<i class="fa-solid fa-code-merge"></i>', label: "Merge", callback: () => done("merge") },
          replace: { icon: '<i class="fa-solid fa-file-import"></i>', label: "Replace", callback: () => done("replace") },
          cancel: { icon: '<i class="fa-solid fa-xmark"></i>', label: "Cancel", callback: () => done(null) }
        },
        default: "replace",
        close: () => done(null)
      }).render(true);
    });
  }
  return globalThis.confirm?.(`Replace current ${label} with imported data?\nOK = Replace, Cancel = abort.`) ? "replace" : null;
}
