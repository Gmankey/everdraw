# Protocol Overview

EverDraw runs a simple loop. Collect deposits. Stake them. Pool the yield. Draw one winner. Return everyone's principal.

## The core loop

```
Users deposit MON (or shMON)
  ↓
Funds held as shMON, accruing Monad staking yield
  ↓
After 24 hours of deposits, the round locks for 6 days
  ↓
At the end of the lock, the keeper draws a winner
  ↓
Winner takes the accumulated yield
Everyone else gets their full principal back
  ↓
A new round opens at the same moment
```

## The no loss guarantee

Your principal is never at risk. When you deposit, the contract holds shMON shares against your principal until the round settles. Win or lose, you get those shares back. The prize is funded entirely by staking yield, not by other depositors.

This is enforced at the contract level. Per user principal accounting and prize accounting are separate state. There is no admin function that can move user funds.

## Round progression

Each round has a 24 hour deposit window followed by a 6 day lock. At the end of the lock, the keeper calls `commit` to finalize the previous round and open the next one in the same transaction. A few blocks later the keeper calls `settle` to compute the winner from the committed block hash.

Both functions are public. The keeper is a convenience operator that runs them on schedule. Anyone with gas can call them. Funds are not at risk if the keeper goes offline.

[Full round lifecycle](round-lifecycle.md)

## Tickets and probability

Each ticket costs 1 MON. Probability of winning is your tickets divided by total tickets in the round. 100 tickets out of 1,000 is 10%. There is no house edge, no bonus tier, no boosted odds. 100% of yield goes to the winner.
