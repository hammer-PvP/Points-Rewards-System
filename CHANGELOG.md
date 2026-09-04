# Changelog

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
