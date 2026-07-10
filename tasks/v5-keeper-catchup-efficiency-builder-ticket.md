# Builder ticket — Fix the V5 keeper's catch-up seed-scan inefficiency

**Priority:** close behind `v5-keeper-managed-service-builder-ticket.md`. Not a correctness bug — a performance/recovery one. Tolerable at weekly mainnet cadence; brutal after any downtime.

## Problem (observed live)
When the keeper reconciles an outstanding (e.g. `Seeded`) draw, it locates that draw's seed by scanning a **huge block range from `V5_KEEPER_FROM_BLOCK` (the vault deploy block) to head** — logged as `seed-wide:dN scanning NNN windows of 1000 blocks`. On the UAT vault this is ~700k+ blocks (~792 windows, ~5–6 minutes) **per stuck draw**. After the keeper is down for a while and a backlog builds, catch-up takes many minutes per draw and dominates the loop, so the vault appears "stuck" long after the keeper is restarted.

## Do
- Bound the seed lookup: a draw's `SeedReceived` event can only occur at/after that draw's `startDraw`, so scan from around the draw's start block (or the last-known-processed block), not from the vault deploy block. Persist a per-draw or last-processed block cursor so reconciliation doesn't re-scan history it already covered.
- Prefer the indexer/event archive over raw RPC `getLogs` sweeps for locating draw-lifecycle events where available (ties into the indexer-as-input-source work; RPC log scans over huge ranges are exactly what the launch checklist flags for load).
- Keep the deposit/TWAB scan (needed to build winner inputs) from the deploy block **only** where it must cover full history for winner computation — do not shorten that in a way that drops early depositors from the input. This ticket is specifically about the **seed** lookup range, not the deposit/winner input range.

## Acceptance
- Reconciling a stuck draw no longer scans from the deploy block; the seed scan window is bounded to that draw's plausible range.
- After a simulated multi-draw downtime, the keeper clears the backlog in a small fraction of the current time.
- Winner computation is unchanged (no early depositor dropped from any draw's input) — re-verify against a known finalized draw.

## External dependencies (rule #5)
- RPC (`getLogs`) and/or the indexer event archive — see launch checklist §3/§5.
- No contract changes.
