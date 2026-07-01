# Builder ticket — main-page prize display (V5 continuous)

**Date:** 2026-07-01. **From:** PM. **Context:** V5 is continuous/unlocked (ADR-0036); prize accrues like PoolTogether, no locked round.

## What to show
The prize is **not** a fixed number — it's the yield accrued in the vault, growing every block. The contract exposes it: `PrizeVaultV5.availableYield() = strategy.totalAssets − totalPrincipal` = the live accrued prize.

- **"Prize accrued now: X MON"** = `availableYield()`, live (ticks up).
- **"On track for ~Y MON at the draw"** = projection = `availableYield() + totalPrincipal × shMON_APY × (timeToDraw / year)`. Label it an **estimate** ("moves with deposits, withdrawals, and the shMON rate; locks at the draw").
- **Next-draw countdown.**
- **Do NOT break out the source** (players vs Degen). One total. (Operator decision — keep it opaque.)
- Degen deposits raise `totalPrincipal` (fee-exempt, 100%-to-pot), so they automatically lift both the accrued and projected numbers — no special UI, it just moves.

## Notes
- `shMON_APY` for the projection: read from the strategy/shMON if exposed, else a configured constant (~15%), clearly an estimate.
- Reuse the production hero/prize styling; no new components (UAT rule).

## Acceptance
- Main page shows accrued-now (live) + projected-at-draw + countdown, single opaque total; a Degen deposit visibly lifts it. Production styling. Own committed PR + UAT URL; prod untouched.
