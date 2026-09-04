# Points & Rewards System

**Points & Rewards System** is a configurable player-reward framework for Foundry VTT. Its core uses Foundry Actors, Users, ownership, folders, World-scoped module data, sockets, and Chat Messages rather than D&D-specific character data.

## v0.0.2 features

- GM entry point directly in the **Actor Directory**, styled to match the Hammer-PvP module suite.
- A selected Actor folder acts only as the current participant filter. Changing the folder never deletes or changes stored points.
- Two point methods:
  - **Account-Wide Points** — one shared balance per User.
  - **Character-Based Points** — independent balance per Actor.
- Point-method conversion:
  - Account → Character: equal split across tracked characters, rounded down.
  - Character → Account: character balances are summed into the User account.
- Session voting:
  - 2–8 GM-configured categories.
  - Full title, compact short label, optional description, and winner point value.
  - Exactly one vote per category.
  - Optional self voting (OFF by default).
  - GM resolves ties when finishing the vote.
  - Winning point commits are applied automatically.
- **Give Points**:
  - single or batch recipients through a checkbox multi-select.
  - reusable GM-configured reasons and point values.
  - always-available Custom reason + amount.
- **Redeem Benefit**:
  - one Actor at a time.
  - only preconfigured benefits.
  - required benefit name, description, and point cost.
  - optional negative balances, with explicit debt warnings.
  - redemption is always posted to Chat and immediately deducted.
- Point ledger with current balance and the last 10 movements for players.
- D&D5e character sheets receive a Points tab when compatible with the active sheet DOM.
- Other systems receive a sheet access fallback that opens the same Points ledger.
- Built-in **Support the Creator → Buy Me a Coffee** settings entry.


### World storage and recovery

- Balances and ledgers are authoritative in hidden **World-scoped Points & Rewards data**; Actor/User documents are identity links rather than the point database.
- Every User account and Actor subaccount receives a persistent module account ID. Last-known names and Foundry IDs remain available when a linked document disappears.
- v0.0.1 Actor/User point flags are imported once into World storage and retained as legacy data rather than deleted during migration.
- Each World-state write is revisioned, protected against stale writes, fingerprinted, re-read for verification, and preceded by a rotating previous-state backup.
- Missing Actors/Users become recoverable orphan accounts rather than losing their balances.
- The GM Manager includes a discreet **Transfer Points** tab (`⇄`) for emergency full-balance transfers between compatible active/orphaned accounts. A zeroed orphan is removed from active storage after transfer while a minimal audit tombstone remains.

## Default/fallback configuration

To prevent null/empty operating states:

- With no saved Give Point Reasons, an editable symbolic **Default +1** reason is shown.
- With no saved Redeem Benefits, an editable symbolic **Default / 1 point** benefit is shown.
- Once the GM saves a real entry, the symbolic fallback is no longer displayed.
- Voting starts with two editable placeholder categories because the voting grid requires at least two categories.

## Compatibility

- Foundry VTT: targeted for **v13 and v14**.
- Core logic is system-agnostic.
- D&D5e receives the initial dedicated sheet-tab integration.

The v0.0.2 package has been statically validated, but the new World-storage migration and recovery workflow should still be live-tested in the target Foundry worlds before being promoted as a stable public release.

## Support

If these tools help your table and you want to support continued development:

**Buy Me a Coffee:** https://buymeacoffee.com/hammer.pvp

## Issues

https://github.com/hammer-PvP/Points-Rewards-System/issues
