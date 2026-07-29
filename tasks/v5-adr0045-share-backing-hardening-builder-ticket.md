# V5 ADR-0045 - share-backing hardening

**Priority:** P1, pre-mainnet blocker

**Source:** `tasks/v5-adr0045-focused-security-review-2026-07-29.md`, findings M-1 and L-1.

**Decision:** ADR-0045 makes shMON shares the sole V5 payout and backing asset. This ticket enforces
that decision; it does not introduce native-MON payouts or change user-facing economics.

## Problem

`ShmonStrategy.totalAssets()` counts raw native MON even though all ADR-0045 exits and prize
escrows can transfer only shMON shares. `withdrawShares()` then silently caps an insufficient
share transfer to the strategy's entire balance. A native transfer can therefore make the vault
report solvent while a full principal debit returns fewer shares.

Separately, `PrizeVaultV5` can commit a strategy whose `shareToken()` differs from the immutable
`DrawManagerV5.payoutToken()`, which makes later distribution registration fail.

## Required changes

1. Change `ShmonStrategy.totalAssets()` to report only the MON-equivalent value of shMON shares.
   Raw native MON must not affect `availableYield`, shortfall mode, deposit credit, or payout
   calculations.
2. In `withdrawShares`, revert with a named error when the calculated share amount exceeds
   `sharesHeld`; do not silently clamp. The calling vault operation must remain atomic.
3. In `PrizeVaultV5.commitStrategyChange`, require the replacement strategy's `shareToken()` to
   equal the current strategy's share token. Emit/revert with a named mismatch error.
4. Preserve `migrateTo` share transfer behavior. If native-balance recovery is added, keep it
   separate from normal `totalAssets` accounting and document the owner/trust surface.
5. Update the ADR-0045 dependency/failure-mode record if the chosen native recovery mechanism
   adds a new decision.

## Tests

- Native MON sent directly to the strategy does not increase `strategy.totalAssets()` or
  `vault.availableYield()`.
- A participant full withdrawal cannot debit full principal while returning less than the
  calculated shMON amount.
- The same atomicity check covers sponsor and Patron withdrawals.
- Prize escrow ignores raw native MON and cannot shift principal shares into the prize.
- Insufficient shares revert without changing principal/TWAB/account totals.
- A same-token strategy migration succeeds after the timelock.
- A different-token strategy migration reverts after the timelock and leaves the old strategy
  active.
- ADR-0045 delayed-redeem lifecycle test and the full Forge suite remain green.

## Delivery

Committed PR against `staging`, citing ADR-0045 and the focused review. No live-network execution
and no keys. This contract change requires a fresh UAT stack and a repeat of the ADR-0045 live
share escrow/claim/withdraw verification before mainnet.
