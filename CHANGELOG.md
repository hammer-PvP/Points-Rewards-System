# Changelog

## 0.4.1 — Redemption Chat & Sidebar UX Polish

### Fixed

- Removed inherited Font Awesome Chat icon classes from the player redemption sidebar button; only the module's native-sized `fa-award` icon is displayed.
- Standardized GM and player redemption announcements using a single readable Chat Card layout with separate Character, Benefit, Effect, Cost and Redeemed by fields.
- Player redemption Chat announcements use the redeeming Actor as the speaker, while the GM remains the actual document creator and authorized World-ledger committer. Each card identifies whether the action came from a Player or GM.

### Added

- World setting **Show Remaining Balance in Redemption Chat Cards** (default OFF), applying consistently to both player-initiated and GM-initiated redemptions. When OFF, neither the remaining balance nor negative-balance/debt detail is emitted in the public Chat Card content. Benefit cost remains public.

### Unchanged

- No changes to point accounting, World storage, Voting Profiles, benefits, identity bindings, request authorization, or GM-only Refund/reversal behavior.


## 0.4.0 — Player Self-Service Reward Redemption

### Added

- Player-facing Redeem Benefit window, reached through the right sidebar immediately after Chat or from the existing Points sheet/ledger view.
- Actor selector resolved from current Owner permissions **and** persistent Primary User identity, using the configured World accounts and existing Point Method.
- Benefit description/cost/current balance/after-balance preview, insufficient-points guard, negative-balance warning, and final confirmation.
- GM-processed player redemption requests conveyed by server-authorized User document updates; a player cannot directly commit a point-balance change.
- Chat announcement identifying the redeeming character, benefit and effect, with a GM-only Refund button linked to the original transaction and guarded against double refunds.
- The existing configured catalog, World ledger, account resolution, and reversal rules are reused without migration.


## 0.3.0 — Release Candidate

Final release-candidate stabilization pass before the planned 1.0 release.

### Fixed

- Restricted Points sheet/header integration to actual **Actor Sheet** applications instead of any ApplicationV2 that happened to expose an Actor reference.
- Prevented the generic Points fallback control from appearing in D&D5e spell/activity dialogs, child applications, configuration windows, and other non-Actor windows.
- Prevented the Points ledger window from receiving a second Points button that opened another copy of itself.
- Prevented stray Points controls from shifting native window-header controls such as the close button.
- Added explicit ActorSheetV2 and legacy ActorSheet guards so the system-agnostic fallback remains available on genuine Actor sheets without leaking into unrelated applications.
- Avoided duplicate fallback controls on ApplicationV2 Actor sheets by using Foundry's native header-control path there and reserving direct DOM fallback injection for legacy Actor sheets.

### Changed

- No point rules, voting behavior, rewards, account storage, transfer logic, migration rules, or portable configuration formats changed in this release candidate.
- README remains the current capability overview; version history remains in this CHANGELOG.

## 0.2.0

Poll-engine expansion and stability/polish release.

### Added

- Multiple reusable **Voting Profiles** selectable by the GM before a poll starts.
- Profiles support **1–8 questions** and may mix Actor Vote and custom Option Vote questions.
- Actor Vote questions can use `0` points for informational polls or award points to winners.
- Option Vote questions support **2–8 GM-defined answers** and remain informational at `0` points.
- Per-question **GM resolves ties** policy. When disabled, first-place ties are accepted; point-awarding Actor Votes grant the configured award to every accepted tied winner.
- Per-profile **Secret / Public ballots**. Public polls reveal voter names only in the finalized results, while Secret polls publish aggregate totals only.
- GM-only active-poll ballot detail view showing who voted for what before finalization.
- Benefit effect/description preview in **Redeem Benefit** before the GM confirms the purchase.
- Export/import schema v2 for Voting Profiles, including question types, answer options, order, point values, tie policy, self-vote policy, and ballot visibility.

### Fixed

- Reworked the D&D5e Points sheet integration so the module no longer takes over the system's native tab state. This addresses first-open blank Points content, native tabs becoming blank after visiting Points, semi-rendered returns, and stale Points tab UI state.
- The Points sheet icon tooltip no longer embeds a cached balance value; the visible Points panel always reads the current account state.
- Improved JSON export behavior by preferring Foundry's local-file save helper before using the legacy Blob/download fallback.

### Changed

- Display name changed from **Points & Rewards System** to **Polls, Points & Rewards**. The module ID remains `points-and-rewards`.
- The former single Voting Categories configuration is normalized into a default **Session Awards** Voting Profile on upgrade.
- v0.1.0 Voting Categories JSON exports remain importable and are converted into a Session Awards profile.
- Voting results, tie resolution, and automatic point commits now operate per question inside the selected Voting Profile.
- README updated as the current v0.2.0 capability overview; version history remains in this CHANGELOG.

## 0.1.0

Portable configuration and cross-client World-integrity stabilization release.

### Added

- JSON **Export All / Import All** for Voting Categories, Give Point Reasons, and Redeem Benefits.
- Individual JSON Export / Import controls in each of those three Settings sections.
- Schema-versioned portable ecosystem export format that deliberately excludes Users, Actors, Primary User assignments, point accounts, ledgers, folders, World State, and recovery data.
- Import validation before any configuration is applied.
- Import modes for **Replace** and **Merge**; merge deduplicates reusable entries and enforces the 8-category voting limit.
- Imported configuration remains unsaved in the current Settings window until the GM reviews it and clicks **Save Settings**.

### Fixed

- Fixed false `world-data integrity mismatch` warnings when the same World was opened through different client environments such as Foundry Desktop and external browsers.
- Integrity verification no longer chooses a different fingerprint algorithm based on WebCrypto availability or secure-context behavior.
- Legacy v0.0.2/v0.0.3 SHA-256 fingerprints and `fnv1a-*` fallback fingerprints are verified deterministically and upgraded to the portable v0.1.0 integrity format without discarding World data.

### Changed

- New World writes use a deterministic `FNV-1A-32` integrity fingerprint implemented entirely by the module, producing the same result in Foundry Desktop, Chrome-family browsers, Firefox-family browsers, HTTP, HTTPS, and localhost contexts.
- World schema advanced to version 3 to normalize portable integrity metadata while preserving the previous persisted state as the rotating backup during upgrade.
- README remains a current capability overview; release-by-release history remains in this CHANGELOG.

## 0.0.3

Primary User identity and User/Actor normalization patch.

### Added

- New **User / Actor Normalization** section in module Settings.
- Persistent **Primary User** assignment for every tracked Actor.
- Automatic initial assignment when an Actor has exactly one non-GM Owner.
- Review states for `Normalized`, `Multiple Owners`, `Unassigned`, and missing-User links.
- GM-editable Primary User dropdowns using the non-GM Users in the World.
- World-stored Primary User identity snapshots and an identity-change audit trail.
- Safe World schema upgrade from v0.0.2 that verifies the previous persisted fingerprint before normalizing the new schema and preserves the prior stored state as backup.

### Changed

- Foundry Ownership now controls only Foundry Actor access; Points & Rewards identity is controlled by Primary User.
- Temporary Owner changes no longer reassign point accounts or change self-voting identity.
- Account-Wide accounts are grouped strictly by Primary User.
- Character-Based Actor balances remain attached to the Actor when Primary User changes.
- Changing Primary User never transfers point balances.
- Session voting eligibility and self-vote blocking now use Primary User instead of current Actor Owners.
- Voting requires every Actor in the active voting folder to have a valid Primary User.
- Account-Wide batch awards deduplicate recipients by Primary User account.
- README is now maintained as the current module capability overview; version-by-version history remains in this CHANGELOG.

## 0.0.2

World-storage and account-recovery architecture patch.

### Changed

- Point balances and ledgers are now authoritative in hidden World-scoped module data instead of Actor/User point flags.
- User accounts and Actor subaccounts now have persistent Points & Rewards IDs; Foundry User/Actor IDs are treated as recoverable links.
- Account-Wide and Character-Based method conversion now operates on World-stored accounts and preserves a migration snapshot archive.
- D&D5e sheet Points access remains icon-only, using the module's `fa-award` icon.

### Added

- One-time migration of v0.0.1 Actor/User point flags into World storage without deleting the legacy flags.
- World-data revisioning, write-time stale-revision protection, SHA-256 integrity fingerprints, post-write verification, and a rotating previous-state backup.
- Runtime orphan detection for missing Actors or Users while retaining last-known names and linked IDs.
- Discreet GM Transfer tab using the `fa-right-left` icon with a 30% / 30% / 30% / 10% manager-tab layout.
- Full-balance transfers between active or orphaned accounts in the currently selected point method.
- Linked transfer ledger entries on source and destination using one Transfer ID.
- Automatic cleanup of zeroed orphan sources after a successful full-balance transfer, retaining a minimal audit tombstone.

## 0.0.1

Initial development baseline.

### Added

- System-agnostic Actor/User point accounts and ledgers.
- Account-Wide and Character-Based point methods with migration.
- Actor-folder participant filtering.
- Configurable 2–8 category session voting grid.
- Self-vote policy and GM tie-breaking.
- Automatic voting point awards.
- GM batch Give Points workflow with presets and Custom awards.
- Preconfigured one-at-a-time benefit redemption with Chat announcements.
- Optional negative balances and debt warnings.
- Player balance / last-10 ledger UI.
- D&D5e Points sheet tab plus generic sheet fallback.
- Actor Directory GM Manager button.
- Hammer-PvP suite visual conventions.
- Buy Me a Coffee support menu.
