# ADR-0051: V5 Patron capital and shMON share-accounting hardening

**Status:** Proposed - implementation prepared for independent review; no live execution authorized
**Date:** 2026-10-08
**Responds to:** PC-01, PC-02, and PC-03 in `tasks/v5-patron-capital-review-2026-10-08.md`
**Amends:** ADR-0036 sections 3.2, 3.3, and 7.4; ADR-0040 section 3; ADR-0045

## Context

The mainnet shMON contract reports different values for `convertToAssets`,
`previewWithdraw`, and `previewRedeem`. EverDraw does not redeem shMON during a withdrawal:
it transfers shares. Using redeem quotes for a share transfer charged a notional exit fee that was
never incurred. A Patron exit could therefore request too many shares, revert a complete exit, or
consume backing attributable to another depositor.

The live vault also lacks the Patron equivalent of the participant and sponsor emergency share
exit. Separately, the current strategy migration accepts arbitrary replacement bytecode after a
24-hour delay. That delay is useful response time but is not a destination constraint.

## Decision

### One accounting basis for shMON shares

`ShmonStrategy.totalAssets()`, direct-share deposit credit, ordinary share withdrawal, prize
escrow, and emergency share withdrawal all use the fee-free `convertToAssets` backing basis.

For an ordinary payout of `assets`, the adapter transfers:

`sharesHeld * assets / convertToAssets(sharesHeld)`

The calculation rounds down, so at most sub-share dust remains for the pool. If the payout equals
all accounting backing, every held share is transferred. `previewWithdraw` and
`previewRedeem` are not valid inputs to an EverDraw share transfer.

Direct shMON deposits are credited from the strategy's measured `convertToAssets` delta before and
after the transfer. This also prevents a fee-bearing redemption quote from reducing the credited
principal even though no redemption occurred.

### Patron emergency exit

The fresh vault release includes `emergencyRedeemBoosterShares`. It is permissionless for the
Patron's own balance, remains live while paused or stopped, uses the same pro-rata share calculation
as the other emergency exits, updates the booster/TWAB ledgers, and cannot return prize yield.

### Constrained strategy recovery

A fresh vault records the initial strategy's runtime code hash. Future strategy changes must match
that exact runtime both when queued and committed, must report that they are bound to the vault, and must move
the old strategy's actual shMON balance exactly. Asset-value tolerance remains a secondary check.

This deliberately gives up in-place adapter upgrades. A code-changing adapter fix requires a fresh
vault and user migration. That is preferable to allowing an owner to route principal into arbitrary
strategy code.

The independent pauser may cancel queued strategy and DrawManager changes. Production monitoring
must alert on every queue, cancellation, and commit.

### Ownership and cap policy

The 25,000 MON cap is not raised as part of this remediation. Before any materially larger cap or
Patron allocation, final ownership must be a reviewed multisig with independently controlled
hardware-backed signers and a tested signing/recovery procedure. The current single Ledger is not
accepted for a proposed 1,500,000 MON allocation.

### Rollout

1. Independent review and pinned-mainnet-fork retest.
2. Deploy the corrected adapter for the current vault, bind it to that vault, queue it, wait 24
   hours, verify it independently, and commit it under the existing governance.
3. Prove a small and then complete withdrawal from the current vault. Keep the old vault
   withdraw-only.
4. Deploy a fresh full stack containing the new vault emergency entrypoint and constrained
   migration rules. Keep its cap at or below the beta cap.
5. Verify bytecode, ownership, pauser, DrawManager/oracle/ClaimManager wiring, frontend manifest,
   indexer, keeper, watcher, deposit, draw, auto-compound, and all three withdrawal ledgers.
6. Only after independent acceptance and multisig ownership may a separately approved staged cap
   increase be considered.

No mainnet pause, migration, cap change, or deposit is authorized by this ADR alone.

## External dependencies and failure behavior

- **shMON:** share transfers remain subject to token transfer availability and share-price loss.
  Redemption fees and delayed native-MON liquidity are not modeled as EverDraw principal because
  EverDraw returns shares, not MON. If transfers fail, emergency exits also wait for token recovery.
- **Monad RPCs:** all migration reads and receipts require independent RPC confirmation. An
  unavailable or inconsistent RPC halts the operation.
- **Owner multisig:** signer loss or unavailable quorum delays administration but cannot block
  user withdrawals. A compromised quorum cannot install different strategy bytecode.
- **Pauser and monitoring:** the pauser can halt deposits and cancel queued fund-affecting changes.
  Monitoring failure blocks migration and cap increases.
- **Keeper and root watcher:** continue to govern draw liveness and root safety; neither is trusted
  with principal withdrawal authority.

## Rejected alternatives

- Raising the cap while leaving the current adapter live.
- Treating `previewWithdraw` as a conservative share-transfer quote.
- A private Patron allowlist as a substitute for correct shared accounting.
- Arbitrary new strategy bytecode behind only a time delay.
- Claiming that shMON shares guarantee a fixed native-MON redemption value.
