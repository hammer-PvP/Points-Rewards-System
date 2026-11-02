# Polls, Points & Rewards

**Polls, Points & Rewards** is a configurable, system-agnostic Foundry VTT module for reusable polls, player point tracking, GM point awards, redeemable rewards, transaction history, and account recovery. Its core logic relies on Foundry Users, Actors, ownership, folders, World settings, sockets, and Chat rather than D&D-specific character data.

The module ID remains **`points-and-rewards`**.

## Core model

A GM-selected **Actor Folder** is the module's live participant filter. Actors directly inside that folder are the current candidates/participants shown by Polls, Give Points, Redeem, and User/Actor normalization. Changing the selected folder never moves, resets, or deletes stored point data.

Foundry **Ownership** and the module's **Primary User** are intentionally separate:

- Foundry Ownership determines who can operate an Actor.
- Primary User is the persistent identity used for point-account grouping, poll eligibility, and self-vote rules.
- An Actor with exactly one non-GM Owner can be assigned automatically on first normalization.
- Multiple Owners or no Owner are surfaced for GM review.
- Once assigned, Primary User does not change automatically when Foundry permissions change.
- Changing Primary User never transfers a point balance.

This allows temporary Owner access to an absent player's character without changing the character's identity inside the module.

## Polls

The module supports multiple reusable **Voting Profiles**. The GM selects which profile to start from the GM Manager.

Each profile contains **1–8 questions** and can mix two question types:

### Actor Vote

Actor Vote choices are the eligible Actors from the configured folder.

- One choice per question.
- Compact short labels keep the player grid readable.
- Mouseover exposes the full question title and description.
- **Allow Self Voting** is configured per profile.
- When self voting is disabled, every Actor assigned to the current User as Primary User is blocked for that User.
- Actor Vote questions may award a non-negative number of points to the winner.
- `0` points makes the question informational without producing a point commit.

### Option Vote

Option Vote questions use GM-defined answers instead of Actors, for decisions such as:

- Advance / Retreat
- Help / Do Not Help
- Explore / Rest / Return

Each Option Vote has **2–8 custom answers**. Option Votes are informational and use `0` points.

### Tie handling

Each question has its own **GM resolves ties** policy.

- Enabled: a tied first place is presented to the GM for a deciding vote before finalization.
- Disabled: the tie is accepted as the result.
- For an Actor Vote that awards points, every accepted first-place tie winner receives the full configured point award.

### Secret and public ballots

Ballot visibility is configured per Voting Profile.

- **Secret:** players see aggregate results only.
- **Public:** final results also list the voters behind each choice.
- The GM can review who voted for what from the active poll Manager in either mode.
- Individual votes are not broadcast live while players are still voting.

The GM can monitor completion, remind pending voters, finish early after confirmation, resolve configured ties, and finalize the poll. Point awards are committed only during finalization.

Existing pre-v0.2.0 Voting Categories are automatically normalized into a **Session Awards** Voting Profile.

## Point methods

### Account-Wide Points

One shared point balance belongs to each Primary User. All Actors assigned to that User display and spend from the same account.

Changing an Actor's Primary User makes that Actor use the new User's existing shared account. No balance is moved automatically.

### Character-Based Points

Each Actor subaccount has its own independent balance and ledger. Changing Primary User reorganizes the Actor under a different User identity while preserving that Actor's points.

### Point-method conversion

The GM may switch methods with a conversion preview:

- **Account-Wide → Character-Based:** divide the User balance equally among linked characters and round down.
- **Character-Based → Account-Wide:** sum the linked character balances into the User account.

## Give Points

The GM Manager supports both single and batch awards.

- Select one or many recipients with a checkbox multi-select.
- Reusable **Give Point Reasons** have title, optional description, and a positive point value.
- A **Custom** reason is always available for signed GM adjustments: a positive integer awards points, while a negative integer removes points from each selected account. A zero value is not allowed.
- Saved Give Point Reasons remain positive-only. Custom deductions include a signed preview and confirmation, are recorded as their own ledger movements, and respect the World setting for negative balances.
- Character-Based mode creates an individual commit per selected Actor.
- Account-Wide mode deduplicates Actors that share the same Primary User so one batch award cannot accidentally credit the same shared account twice.
- Every award is recorded in the ledger.

If no saved reason exists, an editable symbolic **Default +1** row is shown until the GM saves a real reason.

## Redeem Benefits

Benefits are always preconfigured and are redeemed one Actor at a time. The GM can redeem directly, or an eligible player can initiate a self-service redemption through the sidebar.

- Name, description, and positive cost are required.
- There is no Custom redemption.
- Selecting a benefit now previews its configured **effect/description before confirmation**.
- The projected **After redemption** balance is shown below the effect preview.
- By default, unaffordable benefits are unavailable.
- Optional negative balances allow a GM to intentionally create point debt with a clear warning.
- Redemption writes a negative ledger entry and posts a Chat announcement with Actor, benefit, description, cost, and who initiated the redemption. Remaining balance is private by default; the GM can explicitly enable balance disclosure in General settings.

Players use the **award icon directly below Chat in the right sidebar** to open a lightweight redemption window. A player with several owned Actors linked to them as **Primary User** selects the character that will be named in the Chat announcement. The same window opens preselected from the Points tab on a D&D5e character sheet or from the generic Points ledger on other systems.

Player self-service redemption always rechecks current Actor ownership, Primary User binding, the configured benefit, current balance, and negative-balance policy on the GM client before committing. It debits the authoritative World ledger, then publishes a Chat Card displaying character, benefit, effect, cost, and the requesting player. The card uses the redeeming Actor as its speaker while preserving the real GM commit author. Remaining balance is hidden unless the GM enables its public display. On that card, a **GM-only Refund** action creates an idempotent ledger reversal without removing the original debit. A GM needs to be online to process self-service redemption requests. Actor control granted only temporarily to someone who is not the Actor's Primary User does not grant access to that character's point account.

If no saved benefit exists, an editable symbolic **Default / 1 point** benefit is shown until the GM saves a real benefit. Virtual defaults are never redeemable.

## Player point view

Players can see their current balance and the latest **10 point movements**.

- D&D5e character sheets receive icon-only Points access using the module's `fa-award` icon.
- The D&D5e integration keeps the module's Points surface separate from the system's native tab controller so opening Points does not replace or invalidate native sheet tabs.
- Other systems use a safe fallback on genuine Actor sheets that opens the same ledger view; unrelated applications and child dialogs are never decorated.
- The ledger shows positive/negative movements, reasons, dates, and debt state.

## World storage and data safety

Point data is authoritative in hidden **World-scoped module data**, not in player-editable Actor/User point flags.

- User accounts receive persistent module account IDs.
- Actor subaccounts receive persistent module subaccount IDs.
- Foundry User/Actor IDs are links rather than the permanent identity of point accounts.
- Last-known names are retained for recovery/audit context.
- Primary User changes have their own identity-change audit trail.
- Legacy v0.0.1 point flags are imported once and retained as legacy data rather than silently deleted.
- World state is revisioned, stale-write protected, post-write verified, and backed up before writes/upgrades.
- Integrity uses a deterministic client-independent `FNV-1A-32` fingerprint.
- Legacy SHA-256 and `fnv1a-*` fingerprints from earlier releases are validated in their original format and normalized without discarding valid World data.

If an Actor/User disappears, the point account can remain recoverable as an orphan rather than disappearing with the document.

## Transfer and recovery

The GM Manager includes a deliberately discreet icon-only **Transfer Points** tab (`⇄`). Daily-use tabs retain the 30% / 30% / 30% / 10% layout.

- Source and destination may be compatible active or orphaned accounts.
- The source's entire balance is transferred.
- Existing destination points are added to, never overwritten.
- Both sides receive linked ledger entries using one Transfer ID.
- A zeroed orphan source is removed from active data after a successful full transfer.
- A minimal audit tombstone is retained so the origin remains traceable.

Changing Primary User never performs a balance transfer; explicit balance movement belongs to this Transfer tool.

## User / Actor Normalization

Settings include a dedicated normalization view showing:

- Actor
- current Foundry Owners
- Primary User
- normalization status

Primary User is the stable identity used by Account-Wide grouping and poll self-vote rules, even when Foundry Ownership is temporarily changed.

## Portable ecosystem configuration

Reusable ecosystem configuration can be exported/imported as versioned JSON.

Exportable sections:

- **Voting Profiles** — including questions, types, options, order, points, tie policy, self-vote policy, and ballot visibility
- **Give Point Reasons**
- **Redeem Benefits**

Controls are available individually and through **Export All / Import All**. Imports support **Replace** or **Merge** and remain in the Settings window for review until **Save Settings** is clicked.

Current imports remain backward compatible with v0.1.0 Voting Categories exports by converting them into a Session Awards profile during import.

Portable exports deliberately exclude:

- Actors and Users
- Primary User assignments
- Actor Folder selection
- point balances and ledgers
- World State/backups
- orphaned accounts and recovery data

The export routine prefers Foundry's own local-file saver when available and keeps a browser Blob fallback for compatibility. Import behavior remains intentionally conservative because the existing importer is already stable.

## Configuration

The Settings application currently covers:

- Player Actor Folder
- Point Method
- User / Actor Normalization and Primary User assignment
- Negative Balance policy
- Chat-result and sheet-display options
- Voting Profiles
- Give Point Reasons
- Redeem Benefits
- Portable Export / Import

## GM access and interface conventions

- The GM opens the main Manager from the **Polls, Points & Rewards** button in the Actor Directory.
- The UI follows the visual/behavioral conventions of the Hammer-PvP Foundry suite.
- Built-in Foundry / Font Awesome icons are preferred over external icon assets.
- Working state is preserved instead of aggressively rerendering/resetting forms and menus.
- **Support the Creator → Buy Me a Coffee** remains separate from the functional Manager.

## Compatibility

- Foundry VTT: targeted for **v13 and v14**.
- Poll, point, account, reward, transfer, and recovery core logic is system-agnostic.
- D&D5e receives the initial dedicated character-sheet Points integration.

## Support

**Buy Me a Coffee:** https://buymeacoffee.com/hammer.pvp

## Issues

https://github.com/hammer-PvP/Points-Rewards-System/issues
