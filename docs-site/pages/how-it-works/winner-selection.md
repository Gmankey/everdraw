# Winner Selection

EverDraw uses a commit reveal scheme based on Monad block hashes. The full draw is on chain and verifiable.

---

## How it works

**1. Commit.** When the deposit window closes, the keeper calls `commit`. The contract records `targetBlockNumber = block.number + 3`. This is the commitment. It is locked on chain and cannot be changed.

**2. Reveal and draw.** Three blocks later (a couple of seconds on Monad), the keeper calls `settle`. The contract reads `blockhash(targetBlockNumber)` and uses it as the source of randomness. The winning ticket is:

```
winningTicket = uint256(blockhash(targetBlockNumber)) % totalTickets
```

Tickets map to buyers in the order purchases were made. If you bought tickets 50 to 99 of 200 total and ticket 73 is drawn, you win.

**3. Settled.** The winning ticket, winner address, and target block hash are recorded on chain. Anyone can independently reproduce the result by reading contract state.

---

## Why this design

**Manipulation resistant.** No one knows the future block hash at the moment of commit. A block producer would have to sacrifice the corresponding block reward to bias the outcome, which is irrational for any realistic prize size.

**Transparent.** The randomness source, the calculation, and the result are all public. No black box.

**Cheap.** No oracle fee, no VRF subscription. Block hashes are native to Monad.

---

## Probability is linear

Tickets divided by total tickets. 1 in 100 is 1%. 50 in 100 is 50%. No bonuses, no tiers, no house edge.
