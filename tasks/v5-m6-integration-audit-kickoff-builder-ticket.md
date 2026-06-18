# Builder ticket — V5 M6: Integration + internal audit (KICKOFF)

**Date:** 2026-06-17
**Status:** Active. M1–M5 merged to `staging` (PRs #104/#107/#109/#112, all PM-verified). M6 is the first of two audit passes (M6 internal, M7 second adversarial); external audit is deferred (Q6, deposit cap in lieu).
**Cites:** ADR-0036 §7 (security), working rule #5 (external deps). Gate: `tasks/v5-build-plan.md` M6.
**Branch:** cut `feat/v5-m6-integration-audit` from `staging`.

## Scope
1. **Full lifecycle E2E on fork:** deposit (native MON + direct shMON) → multiple draws → seed → root proposal → challenge → finalize → keeper `claimMany` → withdraw. Both MON and shMON depositors in the same draw (symmetry).
2. **Failure-injection scenarios (each its own test):**
   - keeper death → permissionless `startDraw`/`proposeRoot` fallback after grace.
   - oracle death → draw stalls in AwaitingSeed, re-request after timeout, deposits/withdrawals unaffected.
   - venue pause / shMON misbehavior → shortfall mode (§7.1) + emergency exit.
   - **bad root → challenge → guardian veto → repropose → finalize** (the trust-model path, §4.4).
3. **Internal audit doc (in-repo):** per the V4 process, **explicitly enumerating every external-dependency assumption and its failure answer** (§7.2 is the seed, not a substitute — rule #5). Cover the §7.3 checklist (reentrancy, TWAB wraparound/overflow, 4626 inflation/donation, draw-boundary gaming, root/claim arithmetic, pause×function matrix).

## Gate (all required)
- [ ] E2E fork test green across the full lifecycle (both deposit assets).
- [ ] Each failure-injection scenario has a passing test.
- [ ] **Audit doc lands in-repo**; every finding **fixed or accepted-with-rationale** (no silent open findings).
- [ ] §7.3 checklist each addressed with a test or a documented rationale.

## Standing rules
- No agent-held keys (keeper/watcher = operator custody; self-claim works keeperless).
- Rule #5: the audit doc IS the dependency-enumeration deliverable — a clean audit that doesn't name its dependency assumptions is incomplete.

## Out of scope
- **M7** (second adversarial pass with fresh eyes, AFTER M6; proposes the deposit-cap launch value to operator).
- **M8** testnet soak / **M9** mainnet cutover — later.

## PM follow-up
Verify M6 gate on PR: re-run the E2E + failure scenarios; read the audit doc for dependency-assumption completeness. Then M7 kickoff.
