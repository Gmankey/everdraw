# ADR-0027 — Multi-Recipient Fee Router (V4)

**Status:** Accepted as V4 spec.
**Date:** 2026-05-31
**Parent:** ADR-0024 (V4 contract spec)

## Context

V3 has a single `feeBps` + single `feeRecipient`. V4 needs multi-recipient support because:

- Phase 3 partner vaults will share fees between EverDraw treasury and the partner protocol
- Sponsored vaults may want a "sponsor recovery" cut (sponsor donates X, gets Y% back from each round)
- Future ecosystem deals (Monad Foundation grant, integrator referral) need a slot

Doing this as a router pattern keeps the contract clean and audit-friendly without adding many state slots.

## Decision

### Storage

Replace V3's `(uint16 feeBps, address feeRecipient)` with:

```solidity
struct FeeAllocation {
    address recipient;
    uint16 bps;          // basis points of grossPrize this recipient receives
}

FeeAllocation[] public feeAllocations;  // live config
uint16 public constant MAX_TOTAL_FEE_BPS = 2000; // unchanged from V3, applies to sum
```

Setter:
```solidity
function setFeeAllocations(FeeAllocation[] calldata newAllocations) external onlyOwner {
    uint256 sum = 0;
    for (uint i = 0; i < newAllocations.length; i++) {
        require(newAllocations[i].recipient != address(0), "zero recipient");
        require(newAllocations[i].bps > 0, "zero bps");
        sum += newAllocations[i].bps;
    }
    require(sum <= MAX_TOTAL_FEE_BPS, "fee too high");
    require(newAllocations.length <= 8, "too many recipients"); // gas + audit cap

    delete feeAllocations;
    for (uint i = 0; i < newAllocations.length; i++) {
        feeAllocations.push(newAllocations[i]);
    }
    emit FeeAllocationsUpdated(newAllocations);
}
```

Cap of 8 recipients is a defensive bound — keeps `_finalizeDraw` gas bounded and audit surface narrow. Operators almost certainly need < 4.

### Per-round snapshot

Same pattern as V3's single-fee snapshot:

```solidity
struct RoundData {
    // ...
    FeeAllocation[] roundFeeSnapshot;  // copied from feeAllocations at round open
}
```

Snapshotted in `_startNextRound` and read in `_finalizeDraw`. Changes to `feeAllocations` mid-round do NOT affect the current round.

### Settlement math

At `_finalizeDraw`:
```solidity
uint256 totalPrizeShares = grossPrizeShares + sponsoredPrize;  // from ADR-0026
uint256 totalFeeShares = 0;

for (uint i = 0; i < r.roundFeeSnapshot.length; i++) {
    FeeAllocation memory alloc = r.roundFeeSnapshot[i];
    uint256 recipientShares = (totalPrizeShares * alloc.bps) / 10000;
    totalFeeShares += recipientShares;
    _transferOrDefer(alloc.recipient, recipientShares, rid, uint8(0xf0 + i)); // ADR-0028
    emit ProtocolFeeAccrued(rid, recipientShares, alloc.recipient);
}

uint256 netPrize = totalPrizeShares - totalFeeShares;
// proceed with multi-winner allocation per ADR-0025 on netPrize
```

Each recipient gets transferred their cut at settlement. Failed transfers fall through to the deferred-claim path from ADR-0028.

### Events

`ProtocolFeeAccrued(rid, feeShares, feeRecipient)` event from V3 is preserved. Fires once per recipient per round. The indexer can sum per-rid to get the total fee or per-recipient to get per-recipient totals.

`FeeAllocationsUpdated(FeeAllocation[])` event fires whenever the owner changes the config. This is one of the governance events that must trigger a Telegram alert (per the existing keeper-alert-watcher).

## Consequences

- Storage cost per round: ~`numRecipients × 48 bytes` extra. For 4 recipients = ~192 bytes. Trivial.
- Settlement gas: `numRecipients × 25k gas` for transfer + storage write per recipient. For 4: ~100k. Acceptable.
- The audit must verify that `MAX_TOTAL_FEE_BPS` cap is enforced on the **sum**, not per-recipient (a 5-recipient × 20% each = 100% fee would be the bug)
- The audit must verify that snapshot is faithful (no path where live `feeAllocations` is read at settle time)

## Rejected alternatives

- **External Router contract.** Considered: ship a separate `FeeRouter` that holds the fee allocation and the V4 vault transfers single fee to it. Rejected because (a) adds an external contract dependency, (b) doesn't compose well with per-round snapshot semantics, (c) more audit surface for less feature.
- **Linked list of recipients.** Considered for unlimited recipients. Rejected because the realistic cap is 4-8 recipients and a fixed array is simpler.
- **Allow zero-recipient list (means fee disabled).** Accepted. An empty `feeAllocations` array means no fee transfers happen. Equivalent to V3's `feeBps = 0`.

## Migration from V3

V3's `(feeBps, feeRecipient)` translates to V4's `feeAllocations = [{feeRecipient, feeBps}]`. The V3 vaults are not migrating in-place; they stay until natural retirement. V4 vaults are deployed fresh with explicit `setFeeAllocations` call as part of post-deploy ops (or in constructor as an init param — see ADR-0024 §10).
