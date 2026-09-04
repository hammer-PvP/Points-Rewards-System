# Changelog

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
