# Builder ticket — V5 M5: Fees + reward/sponsor funding (KICKOFF)

**Date:** 2026-06-17
**Status:** Active. M4 (ClaimManager) merged to `staging` (PR #109, PM-verified). M5 is the last build milestone before integration/audit (M6).
**Cites:** ADR-0036 §5 (prize/fees/sponsors), ADR-0027 (fee router recipients/splits/cap). Gate: `tasks/v5-build-plan.md` M5.
**Branch:** cut `feat/v5-m5-fees-funding` from `staging`.

## Scope
1. **Fee = value-delta, never share count** (6b) — correct under rebasing/emissions by construction. Per-vault `feeBase` flag: `TOTAL_PRIZE` vs `PARTICIPANT_YIELD_ONLY`. Sponsor-attributable yield is **time-weighted** via TWAB (`grossYield × sponsorDelegateTWAB / totalPrincipalTWAB`), not snapshotted.
2. **In-kind multi-token fees** (6c) — fee on each leg taken in that leg's token; **no cross-token conversion in core, ever**.
3. **Recipients/splits/caps** — carry ADR-0027 unchanged: ≤8 recipients, ≤20% total, per-draw snapshot. Fee payouts are **leaves in the draw tree** (reuse M4 ClaimManager defer resilience).
4. **`fundPrize` scheduling** — reward funding with token allowlist + cancel-unstarted; reward legs held raw since funding.
5. **Sponsors (5a–5d)** — all four modes mapped to delegate-to-zero TWAB accounting.

## Gate (all required)
- [ ] Fee correctness under **rebasing-venue simulation** (the 6b case V4 gets wrong).
- [ ] Fee-leaf resilience (a reverting fee recipient defers its own leaf, blocks nothing — reuse M4).
- [ ] Sponsor **5a–5d each end-to-end**.
- [ ] Recipient/split/cap enforced (≤8, ≤20%, per-draw snapshot).
- [ ] Fee-base flag both modes covered; sponsor-yield attribution time-weighted (not snapshot).

## Standing rules
- No agent-held keys. Working-rule-#5 dependency enumeration (reward tokens: fee-on-transfer/rebasing/blacklisting) in the PR.

## Out of scope
M6 (integration + internal audit) is next, separate. Campaign/V5.1 sources excluded.

## PM follow-up
Verify M5 gate on PR (re-run rebasing-sim + sponsor 5a–5d). Then M6 kickoff.
