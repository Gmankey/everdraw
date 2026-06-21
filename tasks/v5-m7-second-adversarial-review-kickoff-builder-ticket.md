# Builder ticket — V5 M7: Second adversarial review + deposit-cap proposal (KICKOFF)

**Date:** 2026-06-17
**Status:** Active. M6 (integration + internal audit) merged to `staging` (PR #119, PM-verified incl. live fork gate). M7 is the **second, independent** audit pass — the substitute for the deferred external audit (Q6).
**Cites:** ADR-0036 §7 / §10 Q6 (audit deferred → deposit cap in lieu). Gate: `tasks/v5-build-plan.md` M7.
**Branch:** cut `feat/v5-m7-second-review` from `staging`.

## Why this milestone exists
Q6 deferred the external audit. M7 is the compensating control: a **second adversarial pass with fresh eyes**, run AFTER M6, NOT a re-read of the M6 doc. Treat M6's findings as possibly incomplete.

## Scope
1. **Independent re-review against §7.3**, adversarial mindset — assume the M6 pass missed things. Re-examine: reentrancy on every asset-moving path, TWAB wraparound/overflow/timestamp-tie, 4626 inflation/donation, draw-boundary same-block sandwich, root/claim arithmetic (Σ legs ≤ funded, dust), pause×function matrix as executable assertions, the shortfall-trigger valuation basis (gross `convertToAssets` — confirm still correct vs realizable).
2. **Independently re-run the reference-implementation review** (§7.2) — the two winner impls (`scripts/draw/`) cross-checked again, adversarial inputs.
3. **Pursue cheaper external options in parallel** (record outcome, non-blocking): Monad Foundation ecosystem audit support; competitive platforms (Code4rena/Sherlock).
4. **Propose the deposit-cap launch value** — the "amount we can afford to lose to an undiscovered bug." Builder proposes a number + rationale; **the final value is the operator's call** (surfaced to operator at gate).

## Gate (all required)
- [ ] Second-pass findings documented; each **fixed or accepted-with-rationale** (no silent opens).
- [ ] Reference-impl re-review complete (adversarial differential).
- [ ] External-audit-options outcome recorded (even if "none pursued, cap stands").
- [ ] **Deposit-cap launch value proposed to operator** with rationale.

## Standing rules
- No agent-held keys. The deposit cap is **launch-gating** (B1): V5.0 must NOT take uncapped deposits while unaudited.

## Out of scope
M8 (testnet soak + operator veto drill) / M9 (mainnet cutover) — later.

## PM follow-up
Verify M7 gate; **surface the proposed deposit-cap number to the operator for the final call** (operator decision, not builder/PM). Then M8 kickoff.
