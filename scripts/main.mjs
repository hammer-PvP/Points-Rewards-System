import { MODULE_ID, MODULE_TITLE } from "./constants.mjs";
import { SettingsService } from "./services/settings-service.mjs";
import { AccountService } from "./services/account-service.mjs";
import { VotingService } from "./services/voting-service.mjs";
import { WorldStoreService } from "./services/world-store-service.mjs";
import { GMManagerApp } from "./apps/gm-manager-app.mjs";
import { PointsRewardsSettingsApp } from "./apps/settings-app.mjs";
import { PointsLedgerApp } from "./apps/points-ledger-app.mjs";
import { PlayerRedemptionApp } from "./apps/player-redemption-app.mjs";
import { PlayerRedemptionService } from "./services/player-redemption-service.mjs";
import { SupportCreatorApp } from "./apps/support-creator-app.mjs";
import { asRoot, hasModuleData, htmlEscape, isActorDirectoryApp } from "./utils.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_TITLE} | Initializing`);
  SettingsService.register();

  game.settings.registerMenu(MODULE_ID, "supportCreator", {
    name: "Support the Creator",
    label: "Buy Me a Coffee",
    hint: "Support continued development of Hammer-PvP Foundry VTT tools.",
    icon: "fa-solid fa-mug-hot",
    type: SupportCreatorApp,
    restricted: false
  });

  game.settings.registerMenu(MODULE_ID, "configuration", {
    name: "Polls, Points & Rewards Settings",
    label: "Configure Polls, Points & Rewards",
    hint: "Configure the Actor folder, Primary User normalization, point method, Voting Profiles, GM award reasons, and redeemable benefits.",
    icon: "fa-solid fa-sliders",
    type: PointsRewardsSettingsApp,
    restricted: true
  });
});

Hooks.once("ready", async () => {
  VotingService.registerSocket();
  if (game.user?.isGM) {
    try {
      const integrity = await WorldStoreService.initialize();
      if (integrity?.ok !== false) {
        await AccountService.migrateLegacyFlags();
        await AccountService.ensureConfiguredPrimaryUsers();
        PlayerRedemptionService.scanPending();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | World storage initialization failed.`, error);
      ui.notifications.error(`Polls, Points & Rewards world storage could not initialize: ${error.message}`, { permanent: true });
    }
  }
  setTimeout(() => void VotingService.maybePromptCurrentUser(), 500);
  injectRedemptionSidebarControl(ui.sidebar?.element ?? document);
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (isActorDirectoryApp(app)) injectActorDirectoryTool(app, element);
  if (app === ui.sidebar) injectRedemptionSidebarControl(element);
  if (isActorSheetApplication(app)) decorateActorSheet(app, element);
});

Hooks.on("renderActorDirectory", (app, html) => injectActorDirectoryTool(app, html));
Hooks.on("renderSidebar", (app, html) => injectRedemptionSidebarControl(asRoot(html, app)));
Hooks.on("renderChatMessageHTML", (message, html) => PlayerRedemptionService.decorateChat(message, html));
Hooks.on("renderChatMessage", (message, html) => PlayerRedemptionService.decorateChat(message, html));

Hooks.on("renderActorSheet", (app, html) => {
  const root = asRoot(html, app);
  decorateActorSheet(app, root);
});

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  if (!isActorSheetV2Application(app)) return;
  const actor = actorFromApp(app);
  if (!actor || !shouldShowPoints(actor)) return;
  if (game.system.id === "dnd5e" && actor.type === "character") return;
  if (controls.some(control => control?.action === "pointsRewardsOpenLedger")) return;
  controls.push({
    action: "pointsRewardsOpenLedger",
    label: "Points & Rewards",
    icon: "fa-solid fa-award",
    visible: true,
    onClick: () => new PointsLedgerApp(actor).render({ force: true })
  });
});

Hooks.on("updateActor", (actor, changes) => {
  if (!hasModuleFlagChange(changes)) return;
  refreshVisiblePointSurfaces(actor);
});

Hooks.on("updateUser", (_user, changes) => {
  PlayerRedemptionService.onUpdateUser(_user, changes);
  const moduleFlags = changes?.flags?.[MODULE_ID] ?? {};
  if (Object.keys(moduleFlags).some(key => !["redemptionRequest", "redemptionResult"].includes(key))) refreshVisiblePointSurfaces();
});

Hooks.on("updateSetting", setting => {
  if (setting?.key === `${MODULE_ID}.worldState`) refreshVisiblePointSurfaces();
});

Hooks.on(`${MODULE_ID}.pointsChanged`, ({ actor }) => {
  refreshVisiblePointSurfaces(actor);
  if (PlayerRedemptionApp.current?.rendered && !PlayerRedemptionApp.current._busy) void PlayerRedemptionApp.current.render({ force: true });
});
Hooks.on(`${MODULE_ID}.methodMigrated`, () => refreshVisiblePointSurfaces());
Hooks.on(`${MODULE_ID}.primaryUsersChanged`, () => refreshVisiblePointSurfaces());
Hooks.on(`${MODULE_ID}.voteUpdated`, () => {
  if (GMManagerApp.current?.rendered && !GMManagerApp.current._busy) void GMManagerApp.current.render({ force: true });
});

/** One native-looking shortcut, immediately after the Chat tab; not a new sidebar tab. */
function injectRedemptionSidebarControl(element) {
  if (game.user?.isGM) return;
  const root = element instanceof HTMLElement ? element : element?.[0] ?? document;
  const chatTab = root.querySelector?.('#sidebar-tabs [data-tab="chat"], #sidebar nav [data-tab="chat"], nav#sidebar-tabs [data-tab="chat"]')
    ?? document.querySelector('#sidebar-tabs [data-tab="chat"], #sidebar nav [data-tab="chat"]');
  if (!chatTab?.parentElement) return;
  const nav = chatTab.parentElement;
  if (nav.querySelector('.pr-sidebar-redeem-control')) return;
  const button = document.createElement(chatTab.tagName === "A" ? "a" : "button");
  if (button.tagName === "BUTTON") button.type = "button";
  else button.href = "#";
  // Chat tabs may themselves use Font Awesome icon classes on the element.
  // Reusing those classes adds a second icon (often the speech bubble) via ::before.
  // Preserve only native control/layout classes; our single icon lives in the child <i>.
  const tabClasses = String(chatTab.className || "").split(/\s+/).filter(cls =>
    cls && cls !== "active" && !/^(?:fa(?:-.*)?|fas|far|fab|fal|fat|fad)$/.test(cls)
  );
  button.className = [...tabClasses, "pr-sidebar-redeem-control"].join(" ");
  button.dataset.tooltip = "Redeem Benefit — Polls, Points & Rewards";
  button.setAttribute("aria-label", "Redeem Benefit");
  button.innerHTML = '<i class="fa-solid fa-award" aria-hidden="true"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    PlayerRedemptionApp.open();
  });
  chatTab.after(button);
}

function injectActorDirectoryTool(app, element) {
  if (!game.user.isGM) return;
  const root = asRoot(element, app);
  if (!root || root.querySelector(".pr-actor-directory-tool")) return;
  const header = root.querySelector(".directory-header") ?? root.querySelector("header");
  if (!header) return;
  const actions = header.querySelector(".header-actions, .action-buttons") ?? header;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pr-actor-directory-tool";
  button.innerHTML = '<i class="fa-solid fa-award" inert></i><span>Polls, Points & Rewards</span>';
  button.dataset.tooltip = "Open Polls, Points & Rewards GM Manager";
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const existing = GMManagerApp.current;
    if (existing?.rendered) return existing.bringToTop?.();
    GMManagerApp.current = new GMManagerApp();
    GMManagerApp.current.render({ force: true });
  });
  actions.append(button);
}

function actorFromApp(app) {
  const document = app?.actor ?? app?.document ?? app?.object ?? null;
  const ActorDocument = globalThis.Actor;
  const isActorDocument = document?.documentName === "Actor"
    || (typeof ActorDocument === "function" && document instanceof ActorDocument);
  return isActorDocument ? document : null;
}

function isActorSheetV2Application(app) {
  const ActorSheetV2 = foundry?.applications?.sheets?.ActorSheetV2;
  return typeof ActorSheetV2 === "function" && app instanceof ActorSheetV2;
}

function isLegacyActorSheetApplication(app) {
  const ActorSheetV1 = foundry?.appv1?.sheets?.ActorSheet ?? globalThis.ActorSheet;
  return typeof ActorSheetV1 === "function" && app instanceof ActorSheetV1;
}

function isActorSheetApplication(app) {
  return isActorSheetV2Application(app) || isLegacyActorSheetApplication(app);
}

function shouldShowPoints(actor) {
  if (!actor || !SettingsService.get().showSheetPoints) return false;
  const canView = game.user.isGM || actor.isOwner || actor.testUserPermission?.(game.user, "OBSERVER");
  if (!canView) return false;
  const config = SettingsService.get();
  const inFolder = actor.folder?.id === config.actorFolderId;
  return inFolder || AccountService.hasWorldAccount(actor) || hasModuleData(actor);
}

function decorateActorSheet(app, element) {
  if (!isActorSheetApplication(app)) return;
  const actor = actorFromApp(app);
  const root = asRoot(element, app);
  if (!actor || !root || !shouldShowPoints(actor)) return;
  if (game.system.id === "dnd5e" && actor.type === "character") {
    const inserted = injectDnd5ePointsTab(actor, root);
    if (inserted) return;
  }

  // ApplicationV2 Actor sheets receive the generic fallback through the
  // native header-controls hook. Legacy Actor sheets still need a DOM button.
  if (isActorSheetV2Application(app)) return;
  injectSheetFallback(actor, root);
}

function injectSheetFallback(actor, root) {
  if (root.querySelector(".pr-sheet-fallback")) return;
  const header = root.querySelector(".window-header, .sheet-header, header");
  if (!header) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pr-sheet-fallback";
  button.dataset.tooltip = "View Points & recent point activity";
  button.setAttribute("aria-label", "Points & Rewards");
  button.innerHTML = '<i class="fa-solid fa-award" aria-hidden="true"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    new PointsLedgerApp(actor).render({ force: true });
  });
  header.append(button);
}

function injectDnd5ePointsTab(actor, root) {
  const existingButton = root.querySelector('[data-pr-sheet-tab="true"]');
  const existingPanel = root.querySelector(`.pr-sheet-points-panel[data-actor-id="${cssEscape(actor.id)}"]`);
  if (existingButton && existingPanel) {
    refreshDnd5ePanel(actor, root);
    return true;
  }
  existingButton?.remove();
  root.querySelectorAll(".pr-sheet-points-panel").forEach(panel => panel.remove());

  const navCandidates = [
    ...root.querySelectorAll('[data-application-part="tabs"]'),
    ...root.querySelectorAll("nav.sheet-tabs, nav.tabs, .sheet-tabs")
  ];
  const nav = navCandidates.find(candidate => candidate.querySelector("[data-tab]"));
  if (!nav) return false;
  const sample = nav.querySelector("[data-tab]");
  const group = sample?.dataset?.group ?? "primary";
  const nativePanels = Array.from(root.querySelectorAll(".tab[data-tab]"))
    .filter(panel => !panel.classList.contains("pr-sheet-points-panel") && (!panel.dataset.group || panel.dataset.group === group));
  const samplePanel = nativePanels[0] ?? root.querySelector(".tab[data-tab]");
  if (!samplePanel?.parentElement) return false;

  const tag = ["A", "BUTTON"].includes(sample.tagName) ? sample.tagName.toLowerCase() : "button";
  const button = document.createElement(tag);
  if (tag === "button") button.type = "button";
  button.className = `${sample.className || "item"} pr-sheet-tab-button`;
  button.dataset.prSheetTab = "true";
  button.dataset.tooltip = "Points & Rewards";
  button.setAttribute("aria-label", "Points & Rewards");
  button.innerHTML = '<i class="fa-solid fa-award" inert aria-hidden="true"></i>';
  nav.append(button);

  const panel = document.createElement("section");
  panel.className = "pr-sheet-points-panel";
  panel.dataset.actorId = actor.id;
  panel.hidden = true;
  samplePanel.parentElement.append(panel);
  refreshDnd5ePanel(actor, root);
  panel.addEventListener("click", event => {
    const redeemButton = event.target.closest?.('[data-action="open-player-redeem"]');
    if (!redeemButton) return;
    event.preventDefault();
    PlayerRedemptionApp.open(actor);
  });

  const leavePoints = () => {
    for (const candidate of nativePanels) candidate.classList.remove("pr-native-tab-suppressed");
    panel.hidden = true;
    panel.classList.remove("active");
    button.classList.remove("active");
    root.classList.remove("pr-points-sheet-mode");
  };

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    for (const candidate of nativePanels) candidate.classList.add("pr-native-tab-suppressed");
    nav.querySelectorAll("[data-tab].active").forEach(candidate => candidate.classList.remove("active"));
    refreshDnd5ePanel(actor, root);
    button.classList.add("active");
    panel.hidden = false;
    panel.classList.add("active");
    root.classList.add("pr-points-sheet-mode");
  });

  nav.addEventListener("click", event => {
    const target = event.target.closest?.("[data-tab]");
    if (!target) return;
    leavePoints();
  }, true);
  return true;
}

function refreshDnd5ePanel(actor, root) {
  const panel = root.querySelector(`.pr-sheet-points-panel[data-actor-id="${cssEscape(actor.id)}"]`);
  if (!panel) return;
  const config = SettingsService.get();
  const target = AccountService.targetFor(actor, config.pointMethod);
  const account = AccountService.accountForActor(actor, config.pointMethod);
  const entries = account.ledger.slice(-10).reverse();
  const rows = entries.length ? entries.map(entry => {
    const sign = entry.delta > 0 ? `+${entry.delta}` : String(entry.delta);
    const cls = entry.delta > 0 ? "positive" : entry.delta < 0 ? "negative" : "";
    const when = new Date(entry.timestamp).toLocaleString();
    return `<div class="pr-sheet-ledger-row"><span class="pr-sheet-delta ${cls}">${htmlEscape(sign)}</span><span class="pr-sheet-entry"><strong>${htmlEscape(entry.title)}</strong><small>${htmlEscape(entry.description || entry.type || "Point movement")}</small></span><time>${htmlEscape(when)}</time></div>`;
  }).join("") : '<div class="pr-empty-state"><i class="fa-solid fa-receipt"></i><p>No point movements yet.</p></div>';
  const debt = account.balance < 0 ? `<div class="pr-debt-banner"><i class="fa-solid fa-triangle-exclamation"></i><strong>POINT DEBT:</strong> earn ${Math.abs(account.balance)} point(s) to return to zero.</div>` : "";
  const shared = config.pointMethod === "account" ? `<span class="pr-sheet-shared"><i class="fa-solid fa-users"></i> Shared account: ${htmlEscape(target?.name ?? "Unassigned User")}</span>` : "";
  const redeem = !game.user.isGM && PlayerRedemptionService.canRedeemActor(actor)
    ? '<div class="pr-sheet-redeem-action"><button type="button" data-action="open-player-redeem"><i class="fa-solid fa-gift"></i> Redeem Benefit</button></div>' : "";
  panel.innerHTML = `<div class="pr-sheet-points-content"><header><div><h2>Points</h2>${shared}</div><div class="pr-sheet-balance ${account.balance < 0 ? "debt" : ""}">${account.balance}<small>PTS</small></div></header>${debt}${redeem}<section><h3>Recent Activity <small>Last 10 movements</small></h3>${rows}</section></div>`;
}

function refreshVisiblePointSurfaces(actor = null) {
  PointsLedgerApp.refreshAll();
  for (const panel of document.querySelectorAll(".pr-sheet-points-panel[data-actor-id]")) {
    const panelActor = game.actors.get(panel.dataset.actorId);
    if (!panelActor) continue;
    if (actor && panelActor.id !== actor.id && SettingsService.get().pointMethod !== "account") continue;
    const root = panel.closest(".window-app, .application, .actor.sheet") ?? panel.parentElement?.parentElement ?? document;
    refreshDnd5ePanel(panelActor, root);
  }
  if (GMManagerApp.current?.rendered && !GMManagerApp.current._busy) void GMManagerApp.current.render({ force: true });
}

function hasModuleFlagChange(changes) {
  const flags = changes?.flags;
  if (!flags) return false;
  return Object.prototype.hasOwnProperty.call(flags, MODULE_ID) || Object.prototype.hasOwnProperty.call(flags, `-=${MODULE_ID}`);
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
