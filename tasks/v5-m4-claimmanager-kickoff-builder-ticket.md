# Builder ticket — V5 M4: ClaimManager (KICKOFF)

**Date:** 2026-06-17
**Status:** M4 is **unblocked and active.** M3 (DrawManager + winner pipeline) merged to `staging` (PR #107, PM-verified gate). M3 escrows raw asset into ClaimManager and proposes roots; M4 builds the payout machinery those roots feed.
**Implements / cites:** ADR-0036 §3.5 (ClaimManager — the generalized ADR-0028 substrate), ADR-0028 (payout *guarantee* / defer-on-failure lineage), §5.3 (fees as leaves). Gate text: `tasks/v5-build-plan.md` M4.
**Worktree:** continue the V5 line; cut `feat/v5-m4-claimmanager` from `staging` (which now has M1–M3).

## The integration point (don't drift from M3)
M3's `DrawManagerV5` already **escrows the raw asset into ClaimManager before any root is proposed** and computes the root over leaves `(LEAF_DOMAIN, distributionId, leafIndex, account, token, amount)`. M4 must consume exactly that leaf shape and `distributionId = keccak256(sourceContract, sourceKey)` scheme (§3.5). The two winner implementations in `scripts/draw/` are the source of truth for leaf ordering — ClaimManager must verify against the same encoding.

## Scope (build all; gate checks all)
1. **Distribution registry.** An authorized source contract (DrawManager now; CampaignManager in V5.1) registers a finalized payout tree: `distributionId = keccak256(sourceContract, sourceKey)` (DrawManager `sourceKey = drawId`). Store metadata opaquely. One distribution with 1 leaf and one with 10,000 use the same path — **no winner-count cap** (kills the V4 32-winner limit, R4).
2. **`claim(leaf, proof)` — permissionless, pays the leaf's `account`, never `msg.sender`.** Per-distribution claimed-bitmap indexed by `leafIndex` (the explicit index makes duplicate wins / same account as winner+fee / multi-token all unique). Double-claim impossible.
3. **`claimMany`** — keeper batch-executes all leaves after finalization (winners wake up paid — the phase-2 promise). Push and pull are the same code path; any winner can always self-claim if the keeper is dead.
4. **Defer-on-failure, per leaf (carried from ADR-0028):** if a leaf's token transfer reverts/returns false (incl. a failing native send via low-level call), record `pendingClaims[distributionId][leafIndex] → (account, token, amount)` and continue. `claimDeferred(distributionId, leafIndex)` retries later. **Keyed by leaf, not account** — partial failures cannot collide. **Deferred records never expire.**
5. **Fees are ordinary leaves** (§5.3) — fee recipients inherit the same defer resilience; no separate fee transfer path (the V3 fee-freeze bug class is dead by construction).
6. **Non-pausable, non-stoppable.** Pause/stop gate deposits and draw progression only; **claims and withdrawals work forever in both states** (carry the V4 invariant verbatim, ADR-0028 / pauser review). Principal does NOT flow through ClaimManager — it exits directly from PrizeVault; keep the highest-stakes path on the shortest code.

## Gate (M4 not done until ALL pass — `tasks/v5-build-plan.md`)
- [ ] **No double-claim** (invariant: each `leafIndex` claimable at most once).
- [ ] **Σ claims ≤ funded legs** per distribution (no over-payout; rounding dust accrues, never strands).
- [ ] **A blacklisting/reverting token defers only its own leaves and blocks nothing else** (per-leaf isolation, fuzzed with a hostile token).
- [ ] **Claims live under paused AND stopped** states (executable test, not a review note).
- [ ] **10k-leaf gas profile** (`claimMany` batch + single-claim).
- [ ] Leaf/`distributionId` encoding **matches the M3 winner implementations** (cross-check against `scripts/draw/`).

## Standing rules
- **No agent-held keys** (`memory/feedback_never_create_throwaway_wallets.md`): the batch-claim keeper signs txs — operator-created/held key only. Self-claim fallback must work with zero keeper.
- **Working rule #5:** enumerate M4 external deps (reward tokens incl. fee-on-transfer/rebasing/blacklisting — §7.2 row; native-send failure path) and each failure answer in the PR.

## Out of scope for M4
- **M5** (fees computation/flags, reward funding, sponsor modes) — M4 *pays* fee leaves but the fee *base/flag math* and `fundPrize` scheduling are M5. Do not bundle.
- Campaign/V5.1 sources — the registry must namespace for them (§3.5) but no CampaignManager in V5.0.

## PM follow-ups (not builder)
- Verify the M4 gate evidence when the PR lands (same independent re-run discipline used on M3 — reproduce the 10k-leaf profile + run the hostile-token defer test).
- After M4: M5 kickoff ticket.
