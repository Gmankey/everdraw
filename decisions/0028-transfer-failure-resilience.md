# ADR-0028 — Transfer-Failure Resilience (V4)

**Status:** Accepted as V4 spec.
**Date:** 2026-05-31
**Parent:** ADR-0024 (V4 contract spec). Implements the V3.1 path from ADR-0023.

## Context

V3 contracts call `yieldVault.transfer(recipient, shares)` directly during `_finalizeDraw` (fee transfer), `claimPrize`, `withdrawPrincipal`. If the transfer reverts or returns false, the calling function reverts and the user is blocked.

For the fee transfer in `_finalizeDraw` this is catastrophic: the round freezes in `Drawn` state because every retry of `finalizeDraw` re-attempts the fee transfer and re-reverts. Depositors cannot claim or withdraw. This is the reason V3's `feeBps` is permanently 0 — turning on the fee would expose this failure mode.

V4 must allow `feeBps > 0` safely.

## Decision

### Wrap every yield-vault transfer in a try/catch with deferred-claim fallback

```solidity
// rid = round id, slot = unique slot identifier for the transfer
//   0x00..0xfe reserved for ADR-0025 winner positions and other future uses
//   0xff = principal withdraw
//   0xfe = sponsor refund
//   0xf0..0xf7 = fee allocation recipients (ADR-0027)
function _transferOrDefer(
    address recipient,
    uint256 shares,
    uint256 rid,
    uint8 slot
) internal returns (bool transferred) {
    if (shares == 0) return true;

    try yieldVault.transfer(recipient, shares) returns (bool ok) {
        if (ok) {
            totalUnclaimedShares -= shares;
            return true;
        }
    } catch {}

    // Transfer failed (reverted or returned false). Record as deferred.
    pendingClaims[rid][recipient][slot] += shares;
    emit TransferDeferred(rid, recipient, slot, shares);
    return false;
}
```

`totalUnclaimedShares` is only decremented on successful transfer — funds that defer to pending state are still tracked as unclaimed.

### Deferred-claim state

```solidity
// rid → recipient → slot → shares pending
mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public pendingClaims;
```

Three-key indexing because the same address might have multiple pending entries on the same round (e.g. a fee recipient who also won a winner position).

### Retry path

```solidity
function claimDeferred(uint256 rid, uint8 slot) external nonReentrant {
    uint256 shares = pendingClaims[rid][msg.sender][slot];
    if (shares == 0) revert NothingPending();

    // Retry transfer. If it still fails, the call reverts (state unchanged via nonReentrant + below).
    pendingClaims[rid][msg.sender][slot] = 0;
    bool ok = false;
    try yieldVault.transfer(msg.sender, shares) returns (bool result) {
        ok = result;
    } catch {}
    if (!ok) {
        // Restore the pending entry so it can be retried later
        pendingClaims[rid][msg.sender][slot] = shares;
        revert TransferStillFailing();
    }

    totalUnclaimedShares -= shares;
    emit DeferredClaimSucceeded(rid, msg.sender, slot, shares);
}

// Convenience: claim all deferred slots for a single round in one call
function claimAllDeferred(uint256 rid, uint8[] calldata slots) external nonReentrant {
    for (uint i = 0; i < slots.length; i++) {
        // ... same pattern, callable from a single tx
    }
}
```

### Events

```solidity
event TransferDeferred(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares);
event DeferredClaimSucceeded(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares);
```

These give the indexer (and the alert watcher) clear visibility into when transfers are failing — if they fire systematically, shMON is paused or there's another deeper issue.

### View helpers

```solidity
function pendingClaimsTotal(uint256 rid, address user) external view returns (uint256 total);
function hasPendingClaims(address user) external view returns (bool);
```

Frontend uses these to render "you have pending claims to retry" UI.

## Consequences

- Settlement no longer can freeze due to a single recipient's transfer reverting. Round always reaches `Settled` state.
- `feeBps > 0` becomes safe to enable. Operator can set the protocol fee per their economic model without risking permanent round lockup.
- Storage cost: `pendingClaims` is a sparse mapping, costs only when populated. In healthy operation (shMON healthy) no storage is used.
- Audit must verify:
  - No path where `totalUnclaimedShares` is decremented without successful transfer
  - No path where `pendingClaims` is left orphaned after successful claim
  - The convenience `claimAllDeferred` reentrancy is safe
  - The `restore on retry-failure` path doesn't grow the pending entry incorrectly

### Frontend impact

- New `Pending claims` section in user profile / MyRounds
- Retry button per pending slot
- Banner alert at top of app if `hasPendingClaims(user)` returns true

### Indexer impact

- New events `TransferDeferred`, `DeferredClaimSucceeded` added to handler set
- Aggregated view per-wallet: "total shares pending across all rounds"
- Alert watcher triggers Telegram if `TransferDeferred` fires (it shouldn't in healthy ops; firing = shMON or other yield vault has gone unhealthy)

## Rejected alternatives

- **Track failure with a single boolean per round.** Considered. Rejected because partial failures (1 of 5 fee recipients reverts, others succeed) need per-slot granularity.
- **Skip fee transfer entirely on failure, donate to depositors.** Considered. Rejected because (a) it changes the round's economics retroactively, (b) the protocol fee is a contractual commitment to the recipient, (c) defer-and-retry is clearer.
- **Force the yield vault to be redeemable as native by the user.** Considered: at withdraw, call `yieldVault.redeem(shares, msg.sender, address(this))` to send underlying. Rejected because (a) we don't want to add an external call to the standard withdrawal path, (b) different yield vaults have different redeem semantics, (c) user agency is preserved by the V3 pattern of returning shares.

## Open questions

- **Slot numbering scheme.** Reserved `0x00..0xfe` for various uses. Detailed inventory pinned in V4 source comments. Builder must not collide.
- **Pending-claims expiry.** Should deferred claims expire after N days? **No.** Funds are still owed; user should be able to retrieve them indefinitely.
