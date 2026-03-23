# Protocol Overview

EverDraw operates on a simple loop: collect deposits, stake them to generate yield, pool the yield, draw one winner, return principal to everyone.

## The core loop

```
Users deposit MON
 ↓
MON staked via ShMON → generates yield
 ↓
Yield accumulates as the prize pool
 ↓
Sales window closes → draw is executed
 ↓
One winner takes the entire yield pool
Everyone else gets their full principal back
 ↓
New round opens immediately
```

## The no-loss guarantee

Your principal is never at risk. When you deposit MON, it is staked via ShMON and held in the protocol. When the round ends — whether you win or not — your exact deposit is returned to you. The prize pool is funded entirely by staking yield, not by other players' deposits.

This isn't a marketing claim. It's enforced at the contract level. The smart contract tracks each user's principal separately from the yield pool and returns it on demand once the round settles.

## Round progression

Each round has a defined sales window during which tickets can be purchased. Once the window closes, no new tickets are accepted for that round, and the draw process begins. A new round opens simultaneously, so there is always an active vault accepting deposits.

The entire round lifecycle advances through a single public function: `executeNext()`. This function checks the current state of the contract and executes whatever action is due — commit, draw, settle, or skip. Anyone can call it. The keeper bot automates this for convenience and reliability, but it is not a privileged operator. If the keeper goes offline, any wallet can call `executeNext()` and the round progresses normally. There is no dependency on a single operator.

[Full round lifecycle →](round-lifecycle.md)

## Ticket pricing and probability

Tickets are priced at 1 MON each. Your probability of winning is proportional to your ticket count relative to the total tickets in the round. Buying 100 tickets out of 1,000 total gives you a 10% chance of winning the entire prize pool.

This is a linear, fair probability system. There are no premium tiers, no boosted odds, and no house edge on ticket sales. 100% of yield goes to the winner.
