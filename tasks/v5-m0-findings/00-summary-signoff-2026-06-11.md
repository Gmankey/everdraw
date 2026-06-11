# V5 M0 Builder Re-Review — Summary + Signoff

**Reviewer:** builder / Mendel
**Date:** 2026-06-11
**Base reviewed:** `origin/staging` at `5340411` plus the amendments in this PR
**Inputs reviewed:** ADR-0036, V5 build plan, ADR-0034, V5 handoff Part 4, phase-2 vision, off-chain pipeline spec, UX redesign spec

## Verdict

I sign off on building V5 from ADR-0036 as amended in this PR.

M0 is clear once this PR merges. The previous blocker was real: the canonical tree lacked required inputs and ADR-0036 had under-specified seams. PR #96/#89 fixed the major gaps; this re-review adds four final clarifications found during the M0 passes:

1. Yield-leg prizes must be escrowed before any root can be proposed, not merely calculated and left exposed to strategy drift.
2. The TwabController read surface must explicitly distinguish participant TWAB from sponsor-delegated TWAB, because winner odds and sponsor-fee attribution use different denominators.
3. Winner/fee leaves must not be pre-aggregated in the pipeline before `leafIndex` assignment; `leafIndex` is the identity boundary for duplicate wins, fee overlap, and deferral.
4. Direct shMON deposits remain Merkl-visible through the same `Deposit(account, assetValue)` event shape, not a separate `DepositShmon` event.

## TwabController Conditions

I approve the ADR-0036 direction to adapt PoolTogether V5's TwabController, under these conditions:

- Use PoolTogether V5 as the default implementation lineage; greenfielding requires an ADR amendment before M1 proceeds.
- Preserve the audited observation/ring-buffer behavior on shared paths and prove deviations with differential tests.
- Strip unsupported user-facing delegation, but keep the explicit sponsor-delegate-to-zero/sponsor-sink accounting needed for zero-odds sponsor balances.
- Expose enough read surface to compute both participant odds and sponsor-yield attribution: account TWAB, total principal TWAB, and sponsor-delegate TWAB over the same period.
- M1 gate must include property/fuzz coverage for wraparound, same-block updates, period-boundary reads, overflow bounds, zero/short periods, and delegate/sponsor accounting.
- License attribution and upstream-version pinning must land with the implementation.

## Sequencing

This signoff does not reorder work. V4.1-B deploy, the shMON frontend cutover, and Merkl resubmission stay ahead of V5 implementation.
