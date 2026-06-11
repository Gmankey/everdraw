# M0 Pass 6 — No-Loss Invariant

**Scope:** Principal paths: deposit, withdraw, emergency exit, strategy swap, venue loss, shortfall, cap, pause, and stop.

## Trace

- Deposits update principal and TWAB; deposit cap gates new exposure only.
- Withdrawals are continuous, non-pausable, and non-stoppable.
- Emergency share exit handles strategy withdraw failure.
- Strategy swap is timelocked with a public exit window and value-shortfall revert.
- Venue insolvency is not insured, but Shortfall mode applies uniform pro-rata withdrawals on the normal path once `totalAssets < totalPrincipal * (1 - tolerance)`.
- Deposits and draws halt in Shortfall; withdrawals and claims remain live.
- `stop()` halts new deposits/draws, not exits.
- Reward/prize payouts do not touch principal; ClaimManager is deliberately outside the principal path.

## Result

The no-loss invariant is stated honestly and testable: users should not be worse off from EverDraw accounting than from holding the strategy exposure directly. The design no longer relies on a manual emergency path to discover insolvency after early withdrawals drain at face value.

## Findings

No remaining no-loss blocker.
