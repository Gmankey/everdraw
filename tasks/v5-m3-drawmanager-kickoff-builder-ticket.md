# Builder ticket — V5 M3: DrawManager + winner pipeline (KICKOFF)

**Date:** 2026-06-17
**Status:** M3 is **unblocked and active.** M0 signed off; M1 (TwabController) + M2 (PrizeVaultV5/ShmonStrategy) merged to `staging` (PR #104). Package done.
**Implements / cites:** ADR-0036 §3.4 (DrawManager), §4 (winner selection — canonical algorithm), §5.1 (prize snapshot), §5.2 (R2 V5.0 scope), §7 (security). Gate text: `tasks/v5-build-plan.md` M3.
**Worktree base:** continue on the V5 line (`feat/v5-twab-*` lineage at `/home/c/.openclaw/workspace/everdraw-v5-twab-m1` or a fresh `feat/v5-drawmanager-m3` cut from `staging`).

## Why this milestone is the long pole
M3 is contracts **and** off-chain together (handoff B2): the winner pipeline carries the same correctness weight as the contracts, and the gate requires **two independent implementations that differentially agree**. Budget accordingly — this is the biggest milestone in the plan.

## Scope (build all of it; gate checks all of it)

### Contracts
1. **`startDraw()` — permissionless** after `periodEnd` (keeper calls in practice; keeper death must not stall — §3.4, §4.3). Snapshots prize legs (§5.1) and **escrows the yield leg out of the strategy into ClaimManager as raw asset before any root can be proposed** (§3.5, as amended — escrow-before-proposal, not at-proposal). A draw with zero TWAB or zero prize **skips cleanly**, no VRF spend where avoidable, prize rolls forward (§3.4).
2. **Randomness:** reuse `PythRandomnessOracle` (ADR-0029) unchanged — per-consumer adapter, 24h oracle-swap timelock. Seed lands via `onRandomnessReceived` (V4 pattern).
3. **Root lifecycle:** `proposeRoot(drawId, root, winnerCount, totalPayout)` — `totalPayout` must equal snapshotted legs exactly or revert. Single active proposal per draw + cooldown; **no proposer bond** (Q5). Liveness fallback: anyone may propose after `proposerGracePeriod` (~12h). Challenge window **8h** (Q4) → guardian veto (§4.4) → finalize.
4. **Cadence:** fixed-length consecutive periods `[periodStart, periodEnd)` of `drawPeriod` (launch **weekly**, Q1), owner-tunable behind timelock. **Calendar-anchored, no drift — a skipped/zero-TWAB period MUST still consume exactly one `drawPeriod` slot and never roll the schedule forward** (ADR-0037 gate — this is the V4 defect we are explicitly not repeating; include the drift-simulation test below).

### Off-chain (same milestone, same gate)
5. **Canonical algorithm spec** — a *versioned* doc in-repo (`docs/` or `tasks/`) defining winner selection deterministically (§4.1): exact hashing, sampling (with-replacement), tie-handling, leaf ordering. This doc is the contract between the two implementations.
6. **Reference implementation** (O(n log n), §7.4) + **second independent implementation** — different language/author/dependency tree so a bug or supply-chain compromise can't hit both (§7.2 reference-impl row).
7. **Watcher recompute + alarm** — recomputes the root from chain state in the challenge window, alarms on divergence (§4.4 liveness/safety).

## Gate (M3 not done until ALL pass — `tasks/v5-build-plan.md`)
- [ ] **Differential agreement** between the two winner implementations across fuzzed deposit/withdraw/draw histories.
- [ ] **100k-account load test** of winner computation (griefing/dust resistance, §7.4).
- [ ] **Veto-path** and **permissionless-fallback** scenario tests (proposer-grace expiry; keeper-dead startDraw/propose).
- [ ] **Zero-TWAB / zero-prize skip** tests.
- [ ] **Drift-simulation test (ADR-0037):** simulate N consecutive zero-TWAB periods; assert `periodStart`/`periodEnd` advance by exactly `N × drawPeriod` with zero compounding drift.
- [ ] Bad-root → challenge → veto end-to-end; finalized root immutable; veto cannot touch funds.

## Standing rules that apply here
- **No agent-held keys (`memory/feedback_never_create_throwaway_wallets.md` / ADR-equivalent).** The M3 keeper and watcher both sign txs — any signing key is **operator-created/nominated and operator-custodied.** Do not design a process where the builder generates or holds a keeper/watcher key.
- **Working rule #5:** the ticket/PR must enumerate M3's external dependencies (Pyth, archive RPC ×2, the two impls' supply chains) and each failure answer — §7.2 is the seed, not a substitute.
- **Watcher independence (pulled forward from M8):** design the watcher off-Fly and on an independent alert channel from the start, so M8's drill isn't a retrofit.

## Out of scope for M3
M4 (ClaimManager payouts) is the next milestone — M3 escrows into ClaimManager but the claim/merkle/defer machinery is M4. Do not bundle.

## PM follow-ups (not builder)
- Land the M3 PR's gate evidence review when it arrives; update ADR-0032-equivalent V5 deploy record only at M9.
- Deposit-cap launch value (Q6) is an operator decision surfaced at M7 — not now.
