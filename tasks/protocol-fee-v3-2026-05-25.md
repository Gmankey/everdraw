# Builder Ticket: Protocol Fee on Prize Yield (V3)

**Implements:** ADR-0020  
**Target contract:** `src/TicketPrizePoolShmonV3.sol`  
**Deadline:** Before Wed 2026-05-28 12:00 UTC (Vault A V3 deploy is 13:00 UTC same day)

---

## Goal

Add a configurable protocol fee on prize yield to V3. Fee is in basis points, applied only to yield (never principal), snapshotted at round open, capped at 20%, default 0%.

ADR-0020 is the authoritative spec — read it first: `decisions/0020-protocol-fee.md`

---

## Implementation

### 1. New storage (top of contract, near other config)

```solidity
uint16 public constant MAX_FEE_BPS = 2000; // 20% hardcoded ceiling

uint16 public feeBps;          // live setting, applies to next round opened
address public feeRecipient;   // live setting, applies to next round opened
```

Initialize in constructor:
```solidity
feeBps = 0;
feeRecipient = msg.sender; // owner is default recipient until changed
```

### 2. New fields on `RoundData` struct

Append two fields (snapshot at round open — never mutated after):

```solidity
uint16 roundFeeBps;
address roundFeeRecipient;
```

### 3. Snapshot fee at every round open

Two places to update:

**`_startNextRound()`** (around line 644):
```solidity
function _startNextRound() internal {
    currentRoundId += 1;
    RoundData storage r = rounds[currentRoundId];
    r.state = RoundState.Open;
    r.salesEndTime = uint64(block.timestamp + roundDurationSec);
    r.roundFeeBps = feeBps;                  // NEW: snapshot
    r.roundFeeRecipient = feeRecipient;      // NEW: snapshot
    emit RoundStarted(currentRoundId, r.salesEndTime);
}
```

**Constructor first round** (around line 312):
```solidity
r.state = RoundState.Open;
r.salesEndTime = uint64(block.timestamp + _roundDurationSec);
r.roundFeeBps = 0;                        // NEW: default 0 at deploy
r.roundFeeRecipient = msg.sender;         // NEW: owner is default
emit RoundStarted(1, r.salesEndTime);
```

### 4. Apply fee at settlement

In `_settle()` (around line 601, after computing `prizeShares`):

```solidity
uint256 principalSharesAtSettle = shmon.previewDeposit(r.totalPrincipalMON);
uint256 grossPrizeShares = r.totalPrincipalShmonShares > principalSharesAtSettle
    ? r.totalPrincipalShmonShares - principalSharesAtSettle
    : 0;

// NEW: compute and transfer fee
uint256 feeShares = (grossPrizeShares * uint256(r.roundFeeBps)) / 10_000;
uint256 netPrizeShares = grossPrizeShares - feeShares;

if (feeShares > 0) {
    totalUnclaimedShares -= feeShares;  // fee leaves the unclaimed pool
    bool ok = shmon.transfer(r.roundFeeRecipient, feeShares);
    require(ok, "fee transfer failed");
    emit ProtocolFeeAccrued(rid, feeShares, r.roundFeeRecipient);
}

r.principalSharesAtSettle = principalSharesAtSettle;
r.prizeShares = netPrizeShares;  // store NET — what the winner can claim

r.state = RoundState.Settled;

emit RoundSettled(rid, principalSharesAtSettle, netPrizeShares);
_bumpCursor();
```

**Critical:** Do NOT change the `RoundSettled` event signature. The indexer is live and depends on the current topic hash. Use a new `ProtocolFeeAccrued` event for the fee.

### 5. New event

```solidity
/// @notice Emitted at settlement when a protocol fee is taken from the yield.
event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);
```

### 6. New setter

```solidity
event FeeUpdated(uint16 feeBps, address feeRecipient);

error FeeTooHigh();
error ZeroAddress();

function setFee(uint16 newFeeBps, address newFeeRecipient) external onlyOwner {
    if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
    if (newFeeRecipient == address(0)) revert ZeroAddress();
    feeBps = newFeeBps;
    feeRecipient = newFeeRecipient;
    emit FeeUpdated(newFeeBps, newFeeRecipient);
}
```

### 7. View helpers (optional but recommended)

```solidity
/// @notice Fee snapshot for a specific round (what was/will be applied).
function getRoundFee(uint256 rid) external view returns (uint16 bps, address recipient) {
    RoundData storage r = rounds[rid];
    return (r.roundFeeBps, r.roundFeeRecipient);
}
```

---

## Edge cases (must be handled correctly)

| Case | Expected behavior |
|------|-------------------|
| `feeBps == 0` | No fee transfer, no `ProtocolFeeAccrued` event, behaves identically to today |
| `grossPrizeShares == 0` (no yield) | `feeShares == 0`, no transfer, no event |
| Round skipped (no tickets) | `_skipRound` path — no `_settle` runs, no fee logic. Already correct. |
| `emergencyForceSettle` | No prize is computed → no fee taken. Already correct (don't touch this path). |
| `setFee` called mid-round | Live `feeBps`/`feeRecipient` changes, but in-flight round still uses its snapshot |
| `setFee(2001, ...)` | Reverts with `FeeTooHigh()` |
| `setFee(_, address(0))` | Reverts with `ZeroAddress()` |
| Non-owner calls `setFee` | Reverts (onlyOwner) |

---

## Required tests (add to `test/TicketPrizePoolShmonV3.t.sol`)

Create a new test suite `V3_ProtocolFee_Test`:

1. **`test_fee_zero_behaves_identically()`** — default deploy, full lifecycle, winner receives full prize, no `ProtocolFeeAccrued` event.
2. **`test_fee_500bps_split_correct()`** — setFee(500, treasury), run a round with yield, assert treasury receives 5% of yield in shares, winner receives 95%.
3. **`test_fee_2000bps_max()`** — setFee(2000, treasury), assert split is exactly 20/80.
4. **`test_setFee_above_max_reverts()`** — `setFee(2001, treasury)` reverts with `FeeTooHigh`.
5. **`test_setFee_zero_recipient_reverts()`** — `setFee(100, address(0))` reverts with `ZeroAddress`.
6. **`test_setFee_only_owner()`** — non-owner caller reverts.
7. **`test_fee_snapshotted_at_round_open()`** — open round with fee=100, then setFee(2000, _) mid-round, settle: assert only 1% taken from that round (snapshot wins).
8. **`test_fee_applies_to_next_round()`** — continuation of #7: open the next round, settle it, assert 20% fee taken (new snapshot).
9. **`test_fee_zero_yield_no_fee()`** — set fee=1000, run round where shMON rate doesn't change (no yield), assert no `ProtocolFeeAccrued` event, no transfer.
10. **`test_fee_skipped_round_no_fee()`** — empty round → skip path → no fee logic touched.
11. **`test_fee_emergency_force_settle_no_fee()`** — AwaitingVRF timeout → emergencyForceSettle → no fee taken.
12. **`test_fee_recipient_change_takes_effect_next_round()`** — change recipient mid-round, settle: old recipient gets fee; next round, new recipient gets fee.
13. **`test_fee_event_emitted_with_correct_args()`** — assert `ProtocolFeeAccrued(rid, expectedShares, expectedRecipient)` matches.
14. **`test_totalUnclaimedShares_decrements_correctly_with_fee()`** — verify the share accounting invariant holds: at end of round, `totalUnclaimedShares` for this round = principalShares + netPrizeShares (the fee shares were already removed at settle).
15. **`test_winner_claim_uses_net_prize()`** — assert `claimPrize` transfers `netPrizeShares` (not gross) to winner.
16. **`test_principal_unaffected_by_fee()`** — depositors `withdrawPrincipal` get the same amount regardless of fee.

All existing V3 tests must continue to pass unchanged (they default to feeBps=0).

---

## Indexer / frontend follow-ups (out of scope for this ticket)

Spawn separate tickets after this lands:

- **Indexer**: add `ProtocolFeeAccrued` event handler so fee data is exposed via API.
- **Frontend**: show the snapshotted fee rate on each round in the UI (e.g., "5% protocol fee on yield"). Read via `getRoundFee(rid)`.

---

## Deliverable

A PR against `staging` containing:
1. Modified `TicketPrizePoolShmonV3.sol`.
2. New test suite covering all 16 cases above.
3. All existing tests pass (`forge test`).
4. ABI regenerated (`npm run build` + `npm run check:abi`).

PR must cite ADR-0020 in the description.

---

## Out of scope

- V2 contracts (already deployed and audited — do not modify).
- Indexer changes (separate ticket).
- Frontend changes (separate ticket).
- Fee on principal (explicitly rejected in ADR-0020).
