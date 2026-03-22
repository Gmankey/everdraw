# Winner Selection

EverDraw uses a commit-reveal mechanism powered by Monad block hashes to select winners. The process is fully on-chain, verifiable, and manipulation-resistant.

---

## How it works

**Step 1 — Commit**

When the sales window closes, the keeper calls the commit function. The contract records a `targetBlockNumber` — a future block a fixed number of blocks ahead (currently 10 blocks, approximately 10–20 seconds on Monad).

The target block number is locked on-chain and cannot be changed. This is the commitment.

**Step 2 — Draw**

Once the target block is mined, anyone can call the draw function. The contract reads `blockhash(targetBlockNumber)` — the hash of the committed block — and uses it as the source of randomness.

The winning ticket is calculated as:

```
winningTicket = uint256(blockhash(targetBlockNumber)) % totalTickets
```

Ticket ranges are mapped to buyer addresses sequentially. If you bought tickets 50–99 out of 200 total and ticket 73 is drawn, you win.

**Step 3 — Verification**

The winning ticket, the winner's address, and the block hash used are all recorded on-chain and permanently verifiable. Any participant can independently verify the draw outcome by reading the contract state.

---

## Why this design

**It's manipulation-resistant.** No one knows what the block hash will be at the time of commitment. A block producer would need to control the exact target block and sacrifice the block reward to manipulate the outcome — economically irrational for any realistic prize pool size.

**It's transparent.** The randomness source, the winning calculation, and the result are all public and verifiable on-chain. There is no black box.

**It's cheap.** No oracle fees. No VRF subscription costs passed on to users. The block hash is native to Monad's infrastructure.

---

## Probability is strictly proportional

Your probability of winning = your tickets / total tickets in the round.

There are no bonus multipliers, no premium tiers, and no house edge. 1 ticket out of 100 total = 1% chance. 50 tickets out of 100 = 50% chance. The system is linear and fair by construction.
