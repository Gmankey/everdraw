# Protocol Overview

EverDraw is a no-loss prize protocol. You deposit, your deposit earns staking yield while a round runs, and at the end of the round that pooled yield is paid out as a prize to one or more winning tickets. Everyone else gets their full deposit back. Nobody loses principal — the prize is funded entirely by yield, never by other depositors.

## The core loop

```
Deposit MON to buy tickets in an open round
  ↓
Your deposit is held as shMON, earning Monad staking yield
  ↓
The deposit window closes; the round locks while yield accrues
  ↓
At the end of the lock, a verifiable random draw selects the winner(s)
  ↓
Winners receive the yield prize; everyone else withdraws full principal
  ↓
The vault's next round opens, and the cycle repeats
```

## The no-loss guarantee

Put 1 MON in, get at least 1 MON back — win or lose. While a round runs, your deposit earns staking yield. At settlement, that yield is pooled into the prize and paid to the winning ticket(s). Every non-winning ticket redeems for its full face value. The prize comes from yield, never from anyone's principal.

This is enforced in the contract. Principal and prize are tracked as separate state, and there is no privileged function that can move depositor principal. The worst outcome of any round is simply: you got your money back and didn't win this time.

## How a round is structured

Every vault runs in repeating rounds. Each round has:

1. **A deposit window** — the period during which you can buy tickets.
2. **A lock (yield period)** — deposits are closed and the pooled stake earns yield. This accruing yield *is* the prize.
3. **A draw** — a verifiable random selection picks the winner(s).
4. **Claim & withdrawal** — winners claim their prize, everyone else withdraws their principal, and the vault's next round opens.

The exact window and lock durations are set per vault. The protocol runs more than one vault on staggered schedules, so there is regularly a draw approaching across the protocol rather than a single recurring event.

[Full round lifecycle →](round-lifecycle.md)

## Tickets, winners, and odds

Each vault sets a ticket price (for example, 1 MON per ticket). Your chance of winning a given prize position is simply your tickets divided by the total tickets in that round — 100 of 1,000 tickets is a 10% chance. There is no house edge and no boosted tier.

A vault can pay a single winner or split its prize across several winning positions by a fixed allocation set when the vault is created (for example, a larger first prize plus smaller runner-up prizes). The draw selects distinct winning tickets; the allocation determines how the pooled yield is divided among them.

## Sponsored prizes

Beyond depositor yield, anyone can add to a round's prize pool by sponsoring it. Sponsored funds are deposited into the same yield source, so they earn yield alongside the round and increase what winners receive. If a round ends up with no participants, sponsors can reclaim their contribution.

## Keepers and liveness

Rounds advance through public functions — committing a draw, settling it, and opening the next round. A keeper runs these on schedule as a convenience, but the functions are permissionless: anyone can call them. Depositor funds are never at risk if a keeper goes offline, and the randomness has a built-in timeout so no round can be permanently stuck.

[How winners are selected →](winner-selection.md)
