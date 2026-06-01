# ADR-0026 — Sponsor Drop-In Cash (V4)

**Status:** Accepted as V4 spec.
**Date:** 2026-05-31
**Parent:** ADR-0024 (V4 contract spec)

## Context

Phase 3 vision: protocols and partners sponsor prizes on EverDraw vaults to drive engagement. Two sponsor models were considered. This ADR covers the simpler "drop-in cash" variant. The "stake-shMON-yield" variant (ADR-0027 reserved) is **deferred to V4.1** because its accounting model is materially more complex and would blow the V4 timeline.

V4 ships drop-in. Stake-yield ships V4.1.

## Decision

### Surface

```solidity
// Native-mode vault
function sponsor(uint256 rid, string calldata memo) external payable;

// ERC-20 mode vault
function sponsor(uint256 rid, uint256 amount, string calldata memo) external;

event Sponsored(
    uint256 indexed rid,
    address indexed sponsor,
    uint256 amount,
    string memo
);
```

`msg.value` (native) or `amount` (ERC-20) is added directly to the round's prize pool. Non-refundable. The contract holds the funds in the deposit asset (or yield-vault shares — see below) until winners claim.

### Accounting

Each round gains one new storage field:

```solidity
struct RoundData {
    // ...
    uint256 sponsoredPrize; // in deposit-asset units; or yield-vault shares if converted
}
```

When sponsor calls `sponsor(rid, ...)`:
1. Contract receives the funds (`msg.value` or `transferFrom`)
2. Funds are immediately deposited into the yield vault (`yieldVault.deposit(amount, address(this))`) so they accrue yield alongside depositor principal
3. The shares returned are added to `sponsoredPrize` (now denominated in yield-vault shares)
4. Event emitted with original `amount` in deposit-asset units (for human-readable display)

This means sponsor contributions **earn yield too** during the lock period — the prize pool gets both the original sponsorship and the yield on it.

### Settlement integration

At `finalizeDraw`:
```
grossPrizeShares = depositor yield shares     // existing V3 math
totalPrizeShares = grossPrizeShares + sponsoredPrize
feeShares        = totalPrizeShares × feeBps / 10000   // fee applies to whole prize
netPrize         = totalPrizeShares − feeShares
```

The fee applies uniformly to depositor yield + sponsored portion. Alternative considered (fee on yield only, sponsor 100% pass-through) was rejected as ambiguous to communicate to sponsors and adds an opt-in/opt-out decision the contract has no good way to expose.

If a sponsor wants their full contribution to reach winners untaxed, they sponsor a vault with `feeBps == 0` (e.g. the operator's promotional vault). The protocol fee is the protocol fee.

### Restrictions

- `sponsor()` allowed only while `r.state == RoundState.Open` and `block.timestamp < r.salesEndTime`. Cannot sponsor a closed round (would extend yield period unfairly), cannot sponsor a settled round.
- If the round is later skipped (`_skipRound`), the sponsored amount is **refundable**. Sponsors call `claimSponsorRefund(rid)` to recover shares of their original contribution. Without this, sponsoring an empty round would burn the sponsor's funds.

```solidity
mapping(uint256 => mapping(address => uint256)) public sponsorContribution; // rid → sponsor → shares
event SponsorRefunded(uint256 indexed rid, address indexed sponsor, uint256 amount);

function claimSponsorRefund(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Settled) revert BadState();
    if (!r.wasSkipped) revert NothingToRefund();  // refunds only on skipped rounds
    uint256 shares = sponsorContribution[rid][msg.sender];
    if (shares == 0) revert NothingToRefund();
    sponsorContribution[rid][msg.sender] = 0;
    _transferOrDefer(msg.sender, shares, rid, 0xfe); // ADR-0028 deferred-claim path
    emit SponsorRefunded(rid, msg.sender, shares);
}
```

### Why drop-in (not stake-yield) for V4

Drop-in is simple: sponsor's funds are donated, period. Same accounting category as depositor yield. No separate principal-tracking. ~50 lines added to the contract.

Stake-yield (V4.1) keeps sponsor's principal recoverable while donating only the yield. Needs separate `sponsorPrincipalShares` mapping, separate refund flow, fee math that distinguishes yield-on-depositor-principal from yield-on-sponsor-principal. ~200 lines + materially more audit surface.

For V4, drop-in covers the operator's immediate need (run a sponsored promotional round) and the partner sponsorship narrative.

## Consequences

- Sponsor can fire-and-forget into a round
- Skipped rounds refund sponsors automatically (no burned funds for sponsoring empty rounds)
- Settled rounds: sponsored amount + yield-on-sponsored amount goes to winners per allocation
- Frontend gets a Sponsor button on round detail pages
- Indexer adds `Sponsored` and `SponsorRefunded` events to its handler set
- Audit surface increase: one new mapping, two new external functions, one new storage field on RoundData

## Rejected alternatives

- **Sponsor 100% pass-through (no fee on sponsored amount).** Considered. Rejected because (a) ambiguous to sponsors ("does my $1000 fully reach winners?" — answer depends on round timing), (b) requires a per-sponsor-per-round opt-in flag, (c) complicates downstream fee router logic.
- **Sponsor doesn't earn yield (raw drop-in, held as native/ERC-20).** Considered. Rejected because (a) sponsored funds sitting idle during the lock period are economically wasted, (b) yield-on-sponsor is a nice extra-value feature for the marketing story.
- **Per-round sponsor cap.** Considered. Rejected as unneeded — large sponsorships are good for the product. Owner can `pause()` the vault if a single-sponsor sweeps the prize and it's not the desired UX.

## Open questions

- **Should sponsor be permitted to specify allocation (e.g. "give 100% to the 2nd-place winner")?** Probably overkill for V4. The allocation is per-vault (ADR-0025). If a sponsor wants a different shape, they sponsor a different vault.
- **Should sponsor memos be on-chain or off-chain (event-only)?** On-chain string costs ~20k gas per byte. Capping memo length to 256 chars and emitting it in the event only (not storing) is the cheap path. Decision: event-only.
