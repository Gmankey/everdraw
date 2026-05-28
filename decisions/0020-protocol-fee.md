# ADR-0020: Protocol Fee on Prize Yield

**Status:** Accepted  
**Date:** 2026-05-25  
**Deciders:** Owner

---

## Context

EverDraw needs a sustainable revenue model. A configurable fee on prize yield allows the protocol to capture a portion of interest earned each round without touching depositor principal.

---

## Decision

Introduce an optional protocol fee on prize yield in `TicketPrizePoolShmonV3`. The fee is:

- Expressed in **basis points** (1 bps = 0.01%). Range: 0–10000.
- Applied to the **yield only** (the prize pot). Principal always returned to depositors in full.
- Taken at **settlement time** — fee shares are transferred to `feeRecipient` before the winner's claimable prize is recorded.
- **Snapshotted at round open** (`RoundStarted`). Any fee change made during a round takes effect from the *next* round only. Players entering a round know the exact fee that applies to it.
- **Default: 0 bps** (fee off). Owner must explicitly enable it.

### Parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `feeBps` | `uint16` | `0` | Fee rate in basis points |
| `feeRecipient` | `address` | owner | Address that receives fee shares |

### Hardcoded constraints

- **Max fee: 2000 bps (20%).** Enforced in the setter — `setFee()` reverts if `feeBps > 2000`. Owner cannot drain prizes.
- `feeRecipient` cannot be `address(0)`.

### Round snapshot mechanism

When `startRound()` is called, the contract snapshots the current `feeBps` and `feeRecipient` into the round struct. Settlement uses the snapshotted values, not the live values. This gives players a fee guarantee at the time they buy tickets.

### Settlement flow (with fee)

1. Round settles — yield shares computed as normal.
2. `feeShares = prizeShares * roundFeeBps / 10000`
3. `feeShares` transferred to `roundFeeRecipient`.
4. Winner's claimable prize = `prizeShares - feeShares`.
5. `RoundSettled` keeps its existing signature and reports the net prize shares.
6. `ProtocolFeeAccrued` is emitted separately when `feeShares > 0`.

If yield is zero (no interest earned), fee is also zero — no fee on a zero-prize round.

### New functions

```solidity
// Owner only. Reverts if feeBps > 2000 or recipient is address(0).
function setFee(uint16 feeBps, address feeRecipient) external onlyOwner;

// View
function feeBps() external view returns (uint16);
function feeRecipient() external view returns (address);
```

### Events

```solidity
event FeeUpdated(uint16 feeBps, address feeRecipient);
event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);
```

`RoundSettled` must not be extended. The indexer is already deployed against the
current event topic hash, so changing the event signature would silently break
settlement indexing. Fee data is exposed through `ProtocolFeeAccrued` instead.

---

## Scope

- Applies to **V3 only** (`TicketPrizePoolShmonV3`).
- V2 vaults (`0x2208...`, `0xd4F4...`) are already deployed and audited — no change.
- Both V3 vaults (Vault A Wed 2026-05-27 — deployed, Vault B Sun 2026-05-31) will include this from day one.

---

## Consequences

- Players can inspect `feeBps()` on-chain before buying tickets.
- Owner can turn the fee on/off or change recipient at any time, but it never affects an already-open round.
- Auditors must review: fee cannot exceed 20%, fee cannot be applied retroactively, principal is never touched.
- Keeper requires no changes. Indexer/frontend exposure of fee data is a follow-up
  that should listen for `ProtocolFeeAccrued`; the existing `RoundSettled` handler
  continues to work unchanged.
- Frontend should display the active round's snapshotted fee rate so players see it clearly.

---

## Rejected alternatives

**Fee on principal** — rejected. Principal belongs to depositors and must be returned in full. Touching it would undermine the core trust guarantee.

**Fee applied at claim time** — rejected. Creates uncertainty: winner doesn't know their net payout until they claim, which could be days after settlement.

**Fee change takes effect immediately** — rejected. Mid-round fee changes are unfair to players who bought tickets under a different rate.

**Uncapped fee** — rejected. A 100% fee would allow the owner to take the entire prize, breaking the product promise.
