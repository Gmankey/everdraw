# Protocol Overview

EverDraw takes deposits, generates yield during the round, and gives that yield to one winner while allowing everyone to withdraw principal after the round is finalized.

## The core loop

```text
Users deposit MON
→ the round runs and generates yield
→ a winner is selected
→ the prize goes to the winner
→ principal becomes withdrawable
```

## Principal protection

The prize is separate from user principal.

That means the round is designed so one winner gets the yield while deposits remain withdrawable after finalization.

## Tickets and probability

Tickets cost 1 MON each.

Your odds are proportional to your tickets as a share of total tickets in the round.

## Round progression

Each round moves through deposit, yield accumulation, winner reveal, and finalization.

For a step-by-step view, read [Round Lifecycle](round-lifecycle.md).
