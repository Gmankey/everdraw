# Builder Ticket: V3 Pre-Deploy Hardening

**Implements:** ADR-0021  
**Target contract:** `src/TicketPrizePoolShmonV3.sol`  
**Indexer coordination:** `scripts/indexer/src/runner/abi.ts`  
**Deadline:** Wed 2026-05-28 12:00 UTC (Vault A V3 deploys 13:00 UTC same day)

---

## Goal

Six related changes that must land before V3 deploys to mainnet. Read ADR-0021 first — `decisions/0021-v3-pre-deploy-hardening.md`. It contains the rationale; this ticket is the implementation spec.

The two design decisions (entropy timelock, per-round metadata) are in the ADR. The other four (event indexing, ownership trail, version constant) are hardening and don't need their own ADR but are bundled here because they're all "fix it before deploy or live with it forever."

---

## Change 1 — Entropy mutability with 24h timelock

### Storage changes

Remove `immutable` from `entropy` and `entropyProvider`:

```solidity
// Before
IEntropy public immutable entropy;
address public immutable entropyProvider;

// After
IEntropy public entropy;
address public entropyProvider;
```

Add new storage near the existing config:

```solidity
/// @notice Minimum delay between queuing and committing an entropy/provider change.
uint64 public constant ENTROPY_CHANGE_DELAY = 24 hours;

/// @notice Pending entropy contract address; 0 means no change queued.
address public pendingEntropy;

/// @notice Pending entropy provider address.
address public pendingEntropyProvider;

/// @notice Unix timestamp after which a queued entropy change can be committed.
uint64 public pendingEntropyEffectiveAt;
```

### Constructor

No structural change. Initial values for `entropy`/`entropyProvider` still come from constructor args. `pendingEntropy`/`pendingEntropyProvider`/`pendingEntropyEffectiveAt` default to zero.

### New functions

```solidity
function queueEntropyChange(address newEntropy, address newProvider) external onlyOwner {
    if (newEntropy == address(0) || newProvider == address(0)) revert ZeroAddress();
    pendingEntropy = newEntropy;
    pendingEntropyProvider = newProvider;
    pendingEntropyEffectiveAt = uint64(block.timestamp) + ENTROPY_CHANGE_DELAY;
    emit EntropyChangeQueued(newEntropy, newProvider, pendingEntropyEffectiveAt);
}

function commitEntropyChange() external onlyOwner {
    if (pendingEntropyEffectiveAt == 0) revert NoPendingEntropyChange();
    if (block.timestamp < pendingEntropyEffectiveAt) revert TimelockNotElapsed();

    entropy = IEntropy(pendingEntropy);
    entropyProvider = pendingEntropyProvider;

    pendingEntropy = address(0);
    pendingEntropyProvider = address(0);
    pendingEntropyEffectiveAt = 0;

    emit EntropyChanged(address(entropy), entropyProvider);
}

function cancelEntropyChange() external onlyOwner {
    if (pendingEntropyEffectiveAt == 0) revert NoPendingEntropyChange();
    pendingEntropy = address(0);
    pendingEntropyProvider = address(0);
    pendingEntropyEffectiveAt = 0;
    emit EntropyChangeCancelled();
}
```

### New errors

```solidity
error NoPendingEntropyChange();
error TimelockNotElapsed();
```

(`ZeroAddress()` already exists from the fee work — reuse it.)

### New events

```solidity
event EntropyChangeQueued(address newEntropy, address newProvider, uint64 effectiveAt);
event EntropyChanged(address entropy, address entropyProvider);
event EntropyChangeCancelled();
```

### Notes

- No mid-round restriction is required (the timelock + public signal is the safeguard per ADR-0021). Do not add a `RoundState.AwaitingVRF` check — it would only block a window the timelock already covers and adds attack surface for stuck rounds.
- Queueing a new change while one is pending overwrites the previous queue. That's intentional — owner may want to revise the proposed addresses during the 24h window. The effective timer resets.

---

## Change 2 — Index VRF reserve event participants

### Event signature changes

```solidity
// Before
event VRFReserveDeposited(uint256 amount);
event VRFReserveWithdrawn(uint256 amount);

// After
event VRFReserveDeposited(address indexed by, uint256 amount);
event VRFReserveWithdrawn(address indexed to, uint256 amount);
```

### Emit site updates

`depositVRFReserve` (around line 362):
```solidity
emit VRFReserveDeposited(msg.sender, msg.value);
```

`withdrawVRFReserve` (around line 367):
```solidity
emit VRFReserveWithdrawn(msg.sender, amount);
```

Both functions are already `onlyOwner`, so the indexed address is always the current owner — but if ownership transfers, this gives you a per-owner audit trail.

---

## Change 3 — Standardize `OwnershipTransferred` event

### Event signature change

```solidity
// Before
event OwnershipTransferred(address indexed newOwner);

// After
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
```

### Emit site update

In `acceptOwnership` (around line 119):

```solidity
function acceptOwnership() external {
    require(msg.sender == pendingOwner, "not pending owner");
    address previousOwner = owner;
    owner = pendingOwner;
    pendingOwner = address(0);
    emit OwnershipTransferred(previousOwner, owner);
}
```

---

## Change 4 — Add `VERSION` constant

Add near other constants (after `MAX_FEE_BPS`):

```solidity
/// @notice Contract version. Bumped on any future migration.
string public constant VERSION = "3.0.0";
```

This is a string, not a numeric, because semver is what off-chain tooling expects (`major.minor.patch`).

---

## Change 5 — Per-round metadata (campaign + opaque payload)

### Storage on `RoundData` struct

Append after the protocol fee snapshot fields:

```solidity
// Round metadata snapshot (ADR-0021). Defaults to (address(0), 0x0) for plain rounds.
address roundCampaign;
bytes32 roundMetadata;
```

### Live storage (settable by owner, snapshotted at round open)

Add near `feeBps` / `feeRecipient`:

```solidity
/// @notice Campaign/sponsor address applied to the next opened round. 0 = no campaign.
address public nextRoundCampaign;

/// @notice Opaque metadata payload applied to the next opened round.
bytes32 public nextRoundMetadata;
```

### Constructor snapshot

In the first-round block (around line 329):

```solidity
RoundData storage r = rounds[1];
r.state = RoundState.Open;
r.salesEndTime = uint64(block.timestamp + _roundDurationSec);
r.roundFeeBps = feeBps;
r.roundFeeRecipient = feeRecipient;
r.roundCampaign = nextRoundCampaign;       // NEW
r.roundMetadata = nextRoundMetadata;       // NEW
emit RoundStarted(1, r.salesEndTime);
```

### `_startNextRound` snapshot

Mirror the constructor change (around line 686):

```solidity
function _startNextRound() internal {
    currentRoundId += 1;
    RoundData storage r = rounds[currentRoundId];
    r.state = RoundState.Open;
    r.salesEndTime = uint64(block.timestamp + roundDurationSec);
    r.roundFeeBps = feeBps;
    r.roundFeeRecipient = feeRecipient;
    r.roundCampaign = nextRoundCampaign;     // NEW
    r.roundMetadata = nextRoundMetadata;     // NEW
    emit RoundStarted(currentRoundId, r.salesEndTime);
}
```

### Setter

```solidity
function setNextRoundMetadata(address campaign, bytes32 metadata) external onlyOwner {
    nextRoundCampaign = campaign;            // address(0) explicitly allowed (clears campaign)
    nextRoundMetadata = metadata;
    emit NextRoundMetadataSet(campaign, metadata);
}
```

Note: `campaign == address(0)` is intentionally allowed — clearing a campaign for the next round is a valid use case.

### New event

```solidity
event NextRoundMetadataSet(address campaign, bytes32 metadata);
```

### View

```solidity
function getRoundMetadata(uint256 rid) external view returns (address campaign, bytes32 metadata) {
    RoundData storage r = rounds[rid];
    return (r.roundCampaign, r.roundMetadata);
}
```

---

## Change 6 — Index VRF sequence in `VRFRequested` / `VRFFulfilled`

### Event signature changes

```solidity
// Before
event VRFRequested(uint256 indexed roundId, uint64 sequence, uint128 fee);
event VRFFulfilled(uint256 indexed roundId, uint64 sequence, bytes32 randomNumber);

// After
event VRFRequested(uint256 indexed roundId, uint64 indexed sequence, uint128 fee);
event VRFFulfilled(uint256 indexed roundId, uint64 indexed sequence, bytes32 randomNumber);
```

Emit call sites do not change — only the declaration. This changes the topic hash, which is why the indexer ABI must be updated in the same PR (see "Indexer coordination" below).

---

## Indexer coordination — also in this PR

The four event signature changes above (`VRFReserveDeposited`, `VRFReserveWithdrawn`, `OwnershipTransferred`, `VRFRequested`, `VRFFulfilled`) all change their topic hash. The indexer parses by topic hash via ethers `Interface.parseLog`. If we deploy V3 with new signatures but the indexer ABI still has the old ones, the events will be silently ignored.

The V3 contract has not been deployed to mainnet yet, so no live data is at risk. We just need the indexer ABI to match the new V3 contract before Wednesday's deploy.

### File: `scripts/indexer/src/runner/abi.ts`

Update the V3 event signatures section to match the new declarations. Specifically:

```ts
// V3 events — updated for ADR-0021
'event VRFRequested(uint256 indexed roundId, uint64 indexed sequence, uint128 fee)',
'event VRFFulfilled(uint256 indexed roundId, uint64 indexed sequence, bytes32 randomNumber)',
```

`VRFReserveDeposited`, `VRFReserveWithdrawn`, and `OwnershipTransferred` are not currently in the indexer's SUPPORTED_EVENTS list — no indexer change needed for those. (Don't add them unless you also want to handle them in `deriveRounds.ts` etc. Out of scope for this ticket.)

### Verification

After contract + ABI changes, run the indexer locally against a V3 testnet vault and confirm `VRFRequested`/`VRFFulfilled` events still appear in `raw_events`. If they don't, the topic hashes are mismatched.

---

## Edge cases to verify

| Case | Expected |
|------|----------|
| `queueEntropyChange(address(0), validProvider)` | Reverts with `ZeroAddress` |
| `queueEntropyChange(validEntropy, address(0))` | Reverts with `ZeroAddress` |
| `commitEntropyChange` before delay elapsed | Reverts with `TimelockNotElapsed` |
| `commitEntropyChange` with no queue active | Reverts with `NoPendingEntropyChange` |
| `cancelEntropyChange` with no queue active | Reverts with `NoPendingEntropyChange` |
| Queue a change, then queue another before commit | Second queue replaces first, timer resets |
| Non-owner calls any entropy fn | Reverts (onlyOwner) |
| `setNextRoundMetadata(address(0), 0x0)` | Allowed (clears campaign) |
| Set metadata, then open round, then change metadata, then settle that round | First round uses original snapshot |
| Open round → set metadata → next round opens | Next round uses new metadata |
| Ownership transfer | `OwnershipTransferred` event includes both previous and new |
| Deposit to / withdraw from VRF reserve | Events include indexed actor address |

---

## Required tests

Add to `test/TicketPrizePoolShmonV3.t.sol`. Two new test suites:

### `V3_EntropyTimelock_Test` (10 cases)

1. `test_queueEntropyChange_emits_event_with_effectiveAt()`
2. `test_queueEntropyChange_zero_entropy_reverts()`
3. `test_queueEntropyChange_zero_provider_reverts()`
4. `test_queueEntropyChange_only_owner()`
5. `test_commitEntropyChange_before_delay_reverts()`
6. `test_commitEntropyChange_at_exactly_delay_succeeds()`
7. `test_commitEntropyChange_no_pending_reverts()`
8. `test_cancelEntropyChange_clears_pending()`
9. `test_queue_then_requeue_resets_timer()`
10. `test_commitEntropyChange_actually_routes_next_request_to_new_address()` — open round, queue + commit a change to a mock entropy, advance to commit, observe that the new mock receives the request

### `V3_RoundMetadata_Test` (8 cases)

1. `test_default_round_has_zero_metadata()`
2. `test_setNextRoundMetadata_updates_storage_and_emits()`
3. `test_setNextRoundMetadata_only_owner()`
4. `test_metadata_snapshotted_at_round_open()` — set, open round, change live, settle: round still has original
5. `test_metadata_applies_to_next_round()` — set, current round still uses old, open next, new round has new
6. `test_setNextRoundMetadata_zero_clears_campaign()`
7. `test_getRoundMetadata_returns_snapshot()`
8. `test_metadata_change_does_not_affect_in_flight_round()`

### Existing test updates

- Any test that asserts `OwnershipTransferred` topic — update for new 2-arg signature.
- Any test that asserts `VRFRequested` / `VRFFulfilled` topic — update for indexed `sequence`.
- Any test that asserts `VRFReserveDeposited` / `VRFReserveWithdrawn` topic — update for indexed actor.

### Regression

All existing V3 + V2 + legacy tests must still pass unchanged otherwise. `forge test` total should be the existing 115 + the 18 new cases above = 133.

---

## Deliverable

A single PR against `staging` containing:

1. Modified `src/TicketPrizePoolShmonV3.sol` with all six changes.
2. Modified `test/TicketPrizePoolShmonV3.t.sol` with the two new test suites.
3. Updated `scripts/indexer/src/runner/abi.ts` (V3 event signatures).
4. ABI regenerated (`npm run build` + `npm run check:abi` both pass).
5. `forge test` passes (133/133).
6. PR description cites ADR-0021.

---

## Out of scope (separate follow-up tickets after this lands)

- **Frontend**: surface entropy-change banner when `pendingEntropyEffectiveAt > 0`; display `getRoundMetadata(rid)` per round; surface `VERSION` somewhere admin-visible.
- **Indexer**: add `EntropyChangeQueued` / `EntropyChanged` / `EntropyChangeCancelled` / `NextRoundMetadataSet` / new `OwnershipTransferred` handlers if any are wanted in the API.
- **Keeper**: add Telegram alert on `EntropyChangeQueued`.
- **Ops**: document the entropy change workflow in `tasks/mainnet-ops-runbook.md`.

---

## Don't

- Don't modify V2 contracts.
- Don't add a mid-round restriction to `commitEntropyChange` — the timelock is the safeguard. Adding a state check just adds a stuck-round failure mode.
- Don't make `MAX_FEE_BPS` mutable (out of scope, also intentionally hard ceiling).
- Don't add reserved-gap storage. Two metadata fields + the entropy timelock fields is the spec; further reservations were considered and rejected in ADR-0021.
- Don't ship indexer changes for V3 events to Fly until V3 is deployed — the contract address has to exist first or the indexer will just return empty for new ABI. The ABI lands in this PR, but the Fly deploy happens after Wednesday's contract deploy.
