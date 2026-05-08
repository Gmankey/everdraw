# ADR-0004 — V2 contract behavior: verified facts and scheduling implications

**Status:** Accepted (facts verified against `src/TicketPrizePoolShmonV2.sol` on 2026-05-03)
**Date:** 2026-05-03
**Deciders:** Claude (PM, by reading the code)

## Why this exists

ADR-0001 and ADR-0002 made claims about contract behavior. This ADR pins down what the contract actually does so future decisions don't drift.

## Facts verified by reading the contract

### Round state machine
`Open → Committed → Settled` (success), or `Skipped` (zero tickets), or `Failed` (blockhash expired >255 blocks past target).

### When the new round opens — important
The new round opens **inside `commit()`**, not inside `settle()`. Specifically:
- `commit(rid)` checks `block.timestamp >= salesEndTime + yieldPeriodSec`. If condition met, it sets the previous round to `Committed` (or `Skipped` if zero tickets) **and atomically calls `_startNextRound()` opening the new round**.
- `settle(rid)` runs ~3 blocks later (`TARGET_BLOCK_DELAY = 3`) and only computes the prize. It does **not** open another round.

This means the user-visible "round flips over" moment is the `commit` tx, not the `settle` tx. ADR-0002's "settle + reopen are atomic in one keeper tx" was imprecise — the correct statement is **"commit and reopen are atomic in one keeper tx; settle happens 3 blocks later as a separate tx that finalizes the prize."**

### Cycle length is `roundDurationSec + yieldPeriodSec`
- `roundDurationSec` = duration of the Open window. New round's `salesEndTime = block.timestamp_at_open + roundDurationSec`.
- `yieldPeriodSec` = lock duration after Open closes, before commit becomes eligible.
- Total cycle = `roundDurationSec + yieldPeriodSec`.

Both are `immutable` — set in constructor, cannot be changed after deploy.

**Currently deployed Vault A:** `roundDurationSec = 86400 (24h)`, `yieldPeriodSec = 604800 (7d)` → **8-day cycle**. Does not fit a fixed weekly schedule.

**For ADR-0001's 7-day weekly cycle:** new contract needs `roundDurationSec = 86400 (24h)`, `yieldPeriodSec = 518400 (6d)`. Confirms ADR-0003's "fresh deploy" requirement.

### Drift on each cycle
`_startNextRound()` sets the new salesEndTime based on `block.timestamp` at the moment of the commit tx. If the keeper fires commit 5 minutes late, the new round's salesEndTime is 5 minutes later than ideal. **Drift compounds across cycles** unless the keeper actively re-anchors.

### Zero-ticket rounds: handled cleanly
`commit()` checks `r.totalTickets == 0`, marks round `Skipped`, opens next round. No revert. No special handling needed elsewhere. Confirms ADR-0001's "fixed schedule self-heals skips."

### Negative yield: handled cleanly
`prizeShares = totalShmonShares > principalShares ? totalShmonShares - principalShares : 0;` (line 279). Saturating subtraction. If shMON share rate drops during lock, `prizeShares = 0` — no winner gets a prize, but every depositor still gets back their original shares via `withdrawPrincipal`. No underflow risk.

### Settle gas cost
`_resolveTicketOwner` iterates over `r.ranges`. Range count = number of buyer-switches in the purchase order (consecutive same-buyer purchases merge into one range). Worst case = one range per ticket purchase. Practical case at 100 distinct buyers = ~100 ranges = trivially under block gas limit. Not a concern at Phase 1 scale; revisit if a single round exceeds ~5000 distinct buyers.

### `nextExecutable()` view
Returns `(rid, action)` where action is one of `None`, `Commit`, `Settle`, `MarkFailed`. The keeper polls this and calls the corresponding function. Iterates from rid=1 up to currentRoundId — O(rounds) view cost, will grow over time but is offchain so acceptable.

### Keeper script (`keeper-execute-next-v2.js`)
Reads `POOL_ADDRESSES_V2` (comma-separated). For each pool: reads `nextExecutable()`, executes the action. **No scheduling gate** — fires as soon as the contract says it's time. To enforce ADR-0001's fixed-weekday opens, the keeper must add a "do not fire commit before target weekday/time" check.

## Implications for ADR-0001 and ADR-0002

### Scheduling strategy (concrete)
To get fixed-weekly opens (e.g. Vault A always opens Saturday 00:00 UTC):

1. Deploy contract with `roundDurationSec = 86400`, `yieldPeriodSec` set such that commit becomes eligible **at-or-slightly-before** the target weekday/time.
   - With `yieldPeriodSec = 518400` (exactly 6d), commit becomes eligible exactly 6d after salesEndTime = exactly 7d after round opened. If round opens Sat 00:00, commit eligible next Sat 00:00. Aligned.
   - **Recommended**: use `yieldPeriodSec = 518100` (6d - 5min) so commit becomes eligible 5 min before target. Keeper still waits for exact target weekday/time before firing. This 5-min buffer absorbs Monad block-timestamp variance.
2. **Constructor must be called at the desired anchor time.** The constructor sets round 1's `salesEndTime = block.timestamp + roundDurationSec`. If you want round 1 to close Sun 00:00 UTC (so round 1 opened Sat 00:00 UTC), you must deploy at Sat 00:00 UTC ± a few minutes.
3. **Keeper enforces the target weekday/time** as a gate before calling `commit()`. Even if `nextExecutable()` returns `Commit` early, keeper waits until the next scheduled weekday/time.
4. With the 5-min buffer, every commit is fired at the exact target weekday/time → new round opens at exact target → no drift.

### What ADR-0002 should be amended to say
- "Atomic settle + reopen" → "Atomic **commit** + reopen. Settle is a separate keeper tx 3 blocks later that only finalizes the prize and does not affect the new round."
- The user-visible "round flip" moment = commit time. The "winner announcement" moment = settle time, ~3 blocks later (~3-6 seconds on Monad). Frontend should reflect both moments distinctly: the new round opens immediately at commit, but the winner of the previous round is shown a few seconds later when settle confirms.

## Open questions (none I can answer myself — handed off to user/builder)

See main response for the bundles.
