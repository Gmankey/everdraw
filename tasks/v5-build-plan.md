# V5 Build Plan

**Implements:** ADR-0036 (V5 architecture — read it first; this plan does not restate the design).
**Date:** 2026-06-10
**Audience:** the builder who executes and the PM who tracks. Written to be picked up cold.

## How to pick this up cold

1. Read `CLAUDE.md`, then ADR-0036 end-to-end, then ADR-0034 (requirements R0–R6) and `tasks/v5-design-handoff-to-builder.md` **Part 4** (the prior PM's failure record — it tells you which claims to re-verify rather than trust).
2. Check §"Operator decisions" below — if any Q is still open, get it answered before starting the milestone it blocks. Do not guess; do not let the PM guess.
3. Builder tickets cite ADR-0036 §-numbers. Any deviation from the design = ADR-0036 update in the same change (working rule #3).
4. Safety rules in force (post-incident, durable): the PM does not execute transactions, deploys, or infra changes — builder/operator only. Never delete a key before its sweep tx is confirmed and balance read back on-chain. Never combine sweep + key deletion in one script or `&&` chain. ~0.1 MON gas buffer on sweeps. Ledger-only steps belong to the operator.

## Status of inputs

| Input | State |
|---|---|
| D1–D4 scope decisions | **Locked** by operator 2026-06-10 (ADR-0036 §1) |
| Q1–Q7 launch parameters | **Resolved** 2026-06-10 — see below |
| External audit | **Deferred by operator (Q6)** — deposit cap is the mandatory mitigation; M7 repurposed |
| V4.1-B deploy (+3.5d) | Separate track, proceeds regardless (stagger guard, `STAGGER_REFERENCE_VAULT=0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA`) |
| V4.1 frontend cutover | Separate track (in flight with builder); V5 does not wait on it |

## Operator decisions (ADR-0036 §10 — all resolved 2026-06-10)

| # | Decision | Resolution |
|---|---|---|
| Q1 | Launch draw cadence | **Weekly**, shorten later via the tunable |
| Q2 | Winner count + tier split | **1 winner, 100%** at launch; per-draw-config parameter |
| Q3 | Min deposit | **0** at launch, owner-tunable for later |
| Q4 | Challenge window length | **8 hours** |
| Q5 | Proposer bond in V5.0? | **No** — veto + cooldown only; bond only if griefed |
| Q6 | External audit | **Deferred (no budget).** Mandatory mitigation: configurable **total-deposit cap** at launch (ADR-0036 §3.2); pursue Monad Foundation audit support / competitive platforms in parallel |
| Q7 | Multisig before V5.0 mainnet | **No — single Ledger at launch**; multisig stays on roadmap (ADR-0031) |

## Milestones

Each milestone has an exit gate. A milestone is not done until its gate passes — and per working rule #6, "done" for anything user-visible means verified on the live surface, not merged.

**M0 — Design review (builder).** Builder reads ADR-0036 adversarially, especially against Part 4 of the handoff (areas where prior PM judgment failed). Disputes resolved as ADR-0036 amendments. *Gate:* builder signs off or the ADR is amended; Q1–Q5 answered.

**M1 — TwabController.** Adapt PoolTogether V5 TwabController per ADR-0036 §3.1 (greenfield only with an ADR amendment + rationale). Strip delegation except delegate-to-zero. *Gate:* property/fuzz suite green (ring-buffer wraparound, same-block updates, period-boundary queries, overflow bounds); differential test vs upstream behavior on shared paths; license attribution in-tree.

**M2 — PrizeVaultV5 + ShmonStrategy.** Deposits (native + direct shMON), withdrawals, principal ledger, **deposit cap (launch-gating, Q6)**, min-deposit tunable (launch 0), sponsor deposits (delegate-to-zero), emergency share exit, strategy timelock-swap. *Gate:* invariant suite green — no-loss (Σ withdrawable vs assets under fuzzed sequences incl. donations and venue-loss simulation), withdrawals/emergency-exit live under paused AND stopped states (the §7.3 pause×function matrix as executable tests), 4626 inflation-attack tests; fork tests against real shMON on Monad.

**M3 — DrawManager + winner pipeline (contracts + off-chain together — B2).** Permissionless startDraw, VRF integration (reuse PythRandomnessOracle), prize snapshot, root proposal/grace/challenge/veto/finalize. Off-chain: canonical algorithm spec doc (versioned), reference implementation, **second independent implementation**, watcher recompute + alarm. *Gate:* differential agreement between the two implementations across fuzzed histories; 100k-account load test of winner computation; veto-path and permissionless-fallback scenario tests; zero-TWAB / zero-prize skip tests.

**M4 — ClaimManager.** Merkle claims, keeper batch-claim, per-leaf `(token, amount)` defer + retry, claimed-bitmaps, never-pausable. *Gate:* invariants — no double-claim, Σ claims ≤ funded legs, a blacklisting/reverting token defers its own leaves and blocks nothing else, claims live under paused/stopped; 10k-leaf gas profile.

**M5 — Fees + reward funding.** Fee base flag, value-delta fee, in-kind multi-token fees, ADR-0027 recipient/split carryover; `fundPrize` scheduling + allowlist + cancel-unstarted. *Gate:* fee correctness under rebasing-venue simulation (the 6b case V4 gets wrong); fee-leaf resilience tests; sponsor 5a–5d each covered end-to-end.

**M6 — Integration + internal audit.** Full lifecycle E2E (deposit → draws → seed → root → challenge → finalize → keeper-claims → withdraw) on fork, including keeper-death, oracle-death, venue-pause, and bad-root-vetoed scenarios. Internal audit per the V4 process, explicitly enumerating external-dependency assumptions (working rule #5; ADR-0036 §7.2 is the checklist seed). *Gate:* audit doc lands in-repo; all findings fixed or accepted-with-rationale.

**M7 — Extended internal review (audit deferred per Q6).** In place of the external audit: a second adversarial internal audit pass by the builder against the §7.3 checklist, run AFTER M6's audit with fresh eyes; pursue Monad Foundation audit support / competitive-platform options in parallel. *Gate:* second-pass findings fixed or accepted-with-rationale; deposit-cap launch value proposed to operator (the "affordable loss" number is an operator call).

**M8 — Testnet soak.** Full stack (contracts, keeper, watcher, indexer, frontend) on testnet for ≥3 full draw cycles at an accelerated cadence, including one deliberately-injected bad root (veto drill) and one keeper outage (permissionless-fallback drill). *Gate:* all drills pass; runbook written (deploy, draw ops, veto procedure, strategy/oracle swap).

**M9 — Mainnet + cutover.** Operator/builder execute deploy per runbook (PM writes instructions only). Owner stays single Ledger per Q7; deposit cap set to the operator-approved launch value before deposits open. Frontend "Move to V5" flow. Merkl notified pre-cutover. *Gate (rule #6):* live frontend bundle serves V5 addresses; a real deposit → draw → prize → claim observed on-chain; Merkl points confirmed flowing; deployments/ADR records updated in the same change.

**Post-V5.0:** ≥4 clean cycles → V4.1 retirement per ADR-0036 §8. Then **V5.1 CampaignManager** (separate design ADR; must require zero V5.0 core changes — that's the §6 seam test). Later: bonded challenges, permissionless reward tokens, factory, MegaDraw.

## Test plan summary (gates referenced above)

- **Property/fuzz:** TwabController math; prize/fee arithmetic; leaf-sum bounds.
- **Invariant (Foundry invariant testing):** no-loss ledger; claims/withdrawals live in every pause/stop state; no double-claim; defer-isolation.
- **Differential:** two independent winner-algorithm implementations; TwabController vs upstream.
- **Fork:** real shMON on Monad mainnet fork for every strategy path.
- **Scenario/chaos:** keeper death, oracle death, venue pause, bad root + veto, blacklisting reward token, negative-yield period, reorg-window proposal.
- **Load:** 100k-account winner computation; 10k-leaf claim gas.

## Risk register (tracked per milestone; full text in ADR-0036 §10)

| Risk | Owner | Watch at |
|---|---|---|
| TwabController correctness | Builder | M1 gate |
| Off-chain pipeline under-built vs contracts (B2) | Builder | M3 scoped WITH contracts, not after |
| Guardian-veto trust model disclosure | PM (docs) | M8/M9 docs review |
| Prize-latency expectations vs "daily draws" | PM (docs/UI) | M9 |
| V5.1 scope leaking into V5.0 | PM | every ticket review vs ADR-0036 §2/§6 |
| Unaudited principal-holding code (Q6 deferral) — #1 protocol risk | Operator + PM | deposit cap set at M7; revisit deferral if Monad Foundation / cheap audit appears |
| Migration comms (users + Merkl) | PM + operator | start drafting at M6 |
