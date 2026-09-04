# Points & Rewards System

**Points & Rewards System** is a configurable, system-agnostic player reward framework for Foundry VTT. It combines session voting, GM point awards, redeemable rewards, persistent point accounts, transaction history, and recovery tools without depending on D&D-specific character data for its core logic.

## Core concept

The module uses a GM-selected **Actor Folder** as the current participant filter. Actors directly inside that folder appear in voting, point awards, reward redemption, and User/Actor normalization. Changing the selected folder never moves, resets, or deletes stored points.

Foundry **Ownership** and Points & Rewards **Primary User** are intentionally separate concepts:

- **Foundry Ownership** determines who can control an Actor in Foundry.
- **Primary User** is the persistent identity used by Points & Rewards for account grouping and self-voting.
- An Actor with exactly one non-GM Owner is automatically assigned to that User when first normalized.
- Actors with multiple Owners or no Owner remain reviewable in **User / Actor Normalization**.
- Once assigned, Primary User does not change automatically when Foundry ownership permissions change.
- The GM can change Primary User explicitly without moving any point balance.

This allows temporary Owner access for an absent player's character without changing the character's Points & Rewards identity.

## Point methods

### Account-Wide Points

One shared balance belongs to each Primary User. All Actors assigned to that User display and spend from the same account.

Changing an Actor's Primary User makes that Actor use the new User's existing shared account. No points are transferred automatically.

### Character-Based Points

Each Actor subaccount maintains its own independent balance and ledger. Changing Primary User reorganizes the Actor under the new User identity while preserving the Actor's points unchanged.

### Point-method conversion

The GM can switch between point methods:

- **Account-Wide → Character-Based:** the User balance is divided equally across linked characters and rounded down.
- **Character-Based → Account-Wide:** character balances are summed into the associated User account.

A conversion preview is shown before applying the change.

## Session voting

- GM-configurable voting categories: minimum **2**, maximum **8**.
- Each category has a full title, compact short label, optional description, and winner point value.
- Category order in Settings is the left-to-right order in the voting grid.
- Players cast exactly one vote in every category.
- Short labels keep the grid compact; mouseover exposes the full category title and description.
- Actor rows scroll vertically when the participant list is large.
- **Allow Self Voting** is configurable.
- When self voting is disabled, every Actor assigned to the voting User as Primary User is blocked for that User.
- Primary User, not temporary Foundry Ownership, determines voter identity and self-vote restrictions.
- The GM sees voting progress, can remind pending players, and finalizes the session.
- Ties are resolved directly by the GM.
- Winners receive their configured points automatically when voting is finalized.
- Voting results can be published to Chat.

Voting cannot begin while an Actor in the active participant folder has no valid Primary User.

## Give Points

The GM Manager supports both single-recipient and batch awards.

- Select one or many recipients with a checkbox multi-select.
- **Select All** and **Clear** shortcuts are available.
- Reusable Give Point Reasons can be configured with a title, optional description, and fixed positive point value.
- A **Custom** option is always available for an ad-hoc reason and amount.
- In Character-Based mode, each selected Actor receives its own commit.
- In Account-Wide mode, Actors sharing the same Primary User resolve to one shared User account and are not awarded twice by the same batch selection.
- Every award is recorded in the ledger.

## Redeem Benefits

Reward redemption is intentionally one Actor at a time.

- Benefits must be preconfigured by the GM.
- Benefit Name, Description, and Cost are mandatory.
- There is no Custom redemption.
- By default, only affordable benefits are available.
- The GM can enable negative balances; debt is shown clearly before confirmation and in the player ledger.
- Redemption immediately deducts the configured cost.
- Every redemption is posted to Chat with the Actor, benefit, description, cost, and remaining balance.

## Player point view

Players can see their current balance and the latest **10 point movements**.

- D&D5e character sheets receive an icon-only Points tab using the module's `fa-award` icon when the sheet integration is compatible.
- Other systems receive a sheet access fallback that opens the same ledger view.
- The ledger shows positive and negative movements, reasons, dates, and debt state when applicable.

## World storage and data safety

Point data is authoritative in hidden **World-scoped Points & Rewards data** rather than in editable Actor/User point flags.

- Every User account receives a persistent Points & Rewards account ID.
- Every Actor receives a persistent Points & Rewards subaccount ID.
- Foundry User/Actor IDs are links, not the permanent identity of the point account.
- Last-known User and Actor names are retained for recovery and audit context.
- Primary User changes are stored separately from point transactions and retain an identity-change audit trail.
- Existing v0.0.1 Actor/User point flags are imported once into World storage and retained as legacy data rather than silently deleted.
- World data is revisioned and protected against stale writes.
- Stored state uses deterministic client-independent integrity fingerprints and post-write verification.
- Legacy v0.0.2/v0.0.3 SHA-256 or fallback FNV fingerprints are verified using their original format and then normalized to the portable v0.1.0 format.
- Integrity verification no longer changes behavior based on browser WebCrypto availability, secure context, or Foundry Desktop versus an external browser.
- The previous persisted World state is retained as a rotating backup before writes, including schema upgrades.

If an Actor or User disappears, its World-stored account can remain recoverable instead of losing the balance immediately.

## Transfer and recovery

The GM Manager includes a deliberately discreet icon-only **Transfer Points** tab (`⇄`). The daily-use tabs keep the layout proportion **30% / 30% / 30% / 10%**.

The Transfer tool is intended for exceptional administrative recovery:

- Source and destination may be active or orphaned compatible accounts.
- The source's entire balance is transferred.
- Existing destination points are added to, never overwritten.
- Source and destination receive linked ledger entries using one Transfer ID.
- If an orphaned source reaches zero after a successful full transfer, it is removed from active World data.
- A minimal audit tombstone remains so the transfer origin can still be traced.

Changing Primary User never performs a balance transfer. When a balance itself must move, the GM uses this Transfer tool explicitly.

## Configuration

The module Settings include:

- Player Actor Folder
- Point Method
- User / Actor Normalization and Primary User assignment
- Allow Self Voting
- Allow Negative Balance
- Voting Categories
- Give Point Reasons
- Redeem Benefits
- Chat-result and sheet-display options

To prevent unusable null configuration states:

- With no saved Give Point Reasons, an editable symbolic **Default +1** reason is shown.
- With no saved Redeem Benefits, an editable symbolic **Default / 1 point** benefit is shown.
- Once a real entry is saved, the symbolic fallback disappears.
- Voting starts with two editable placeholder categories because at least two categories are required.

## Portable ecosystem configuration

Voting Categories, Give Point Reasons, and Redeem Benefits can be exported to and imported from JSON without moving any campaign identity or point data.

- **Export All / Import All** handles all three reusable ecosystem sections in one file.
- Each of the three Settings sections also has its own **Export / Import** controls.
- An individual importer can read either its matching section export or an Export All file.
- Imports support **Replace** or **Merge**.
- Merge keeps current entries and adds non-duplicates; Voting Categories still enforce the module maximum of 8.
- Imported changes remain in the Settings window until the GM clicks **Save Settings**, allowing review before they are committed.
- Export files are schema-versioned and validated before being applied.

Portable exports intentionally exclude:

- Actors and Users
- Primary User assignments
- Actor Folder selection
- Account-Wide / Character-Based balances
- Ledgers and point transactions
- World State, backups, orphaned accounts, and recovery data

This makes it safe to build a reward ecosystem in a test World and reuse it in another World without carrying player or campaign data with it.

## GM access and interface conventions

- The GM opens the main Manager from a **Points & Rewards** button in the Actor Directory.
- The UI follows the visual and behavioral conventions of the Hammer-PvP Foundry module suite.
- Built-in Foundry / Font Awesome icons are used instead of external icon libraries.
- Tabs and controls preserve their working state instead of aggressively resetting the whole window.
- Search/filter behavior, when present, should not trigger disruptive full rerenders on every typed character.
- **Support the Creator → Buy Me a Coffee** remains separate from the functional Manager.

## Compatibility

- Foundry VTT: targeted for **v13 and v14**.
- Core point, voting, account, and recovery logic is system-agnostic.
- D&D5e receives the initial dedicated character-sheet integration.

## Support

**Buy Me a Coffee:** https://buymeacoffee.com/hammer.pvp

## Issues

https://github.com/hammer-PvP/Points-Rewards-System/issues
