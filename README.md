# Points & Rewards System

**Points & Rewards System** is a configurable player-reward framework for Foundry VTT. Its core uses Foundry Actors, Users, ownership, folders, flags, sockets, and Chat Messages rather than D&D-specific character data.

## v0.0.1 features

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

The v0.0.1 package has been statically validated, but should still be live-tested in the target Foundry worlds before being promoted as a stable public release.

## Support

If these tools help your table and you want to support continued development:

**Buy Me a Coffee:** https://buymeacoffee.com/hammer.pvp

## Issues

https://github.com/hammer-PvP/Points-Rewards-System/issues
