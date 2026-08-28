# Protocol Overview

EverDraw is a no-loss prize protocol. You deposit MON or shMON, the vault stakes it as shMON, and the staking yield funds weekly prizes. Your principal stays withdrawable; the prize comes from yield, not from other depositors.

## The core loop

```
Deposit MON or shMON into the vault
  ->
Your balance is staked as shMON and starts earning yield
  ->
During each weekly draw period, your time-weighted balance earns entries
  ->
At the draw, verifiable randomness selects winner(s) from those entries
  ->
Yield is paid as the prize; your principal remains yours
  ->
The next weekly draw period continues from the live balances
```

Deposits and withdrawals are continuous. There is no user-facing sales window where deposits lock. If you deposit halfway through a weekly draw period, only the time after your deposit counts for that draw. If you withdraw before the draw, you keep the entries already earned for that draw and stop earning future entries on the withdrawn amount.

## The no-loss guarantee

Put 1 MON of principal in, get 1 MON of principal value back when you withdraw. Your deposit is tracked separately from prize yield. Winning or not winning does not reduce your principal.

Withdrawals return the principal value through EverDraw's shMON path. If you want raw MON, the app can send you to shMonad to convert; that conversion follows shMonad's own unstaking process.

## Entries and odds

EverDraw V5 uses time-weighted entries, not fixed tickets bought at a deadline. Entries accrue from your balance over time:

```
entries = 0.005 x balance in MON x minutes held in the draw period
```

A steady 1,000 MON balance over a full weekly draw earns about 50,400 entries for that draw. Joining late earns fewer entries for that draw, then a full-period balance earns full entries from the next draw onward.

Odds are proportional to entries in that draw. Points tiers, streaks, and Patron boosts do not increase win odds.

## Patron pool

The Patron pool is separate from the main vault position. Patron deposits add yield to the prize and earn boosted EverDraw points, but they receive zero entries and cannot win the weekly draw.

Patron pool points ramp with consecutive weekly participation: 2x in the first week, then 3x, 4x, and 5x from week four onward. Patron deposits are withdrawable, but they are not tradeable DeFi receipts while inside EverDraw.

## Prize funding

The prize is the yield available in the vault at draw time. Main-vault deposits and Patron deposits both increase the total yield source, so both can make the weekly prize larger. The app shows the currently accrued prize and an estimated projection for the draw.

## Keepers and liveness

A keeper advances draws on schedule: starts the draw, requests randomness, proposes the result, and finalizes it. The protocol is designed so depositor principal is not at risk if the keeper is delayed. If a draw has no yield to pay, it can be skipped rather than forcing an empty prize.

[How winners are selected ->](winner-selection.md)
