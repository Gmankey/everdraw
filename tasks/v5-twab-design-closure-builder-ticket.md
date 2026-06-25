# Builder ticket — V5 TWAB design closure

**Date:** 2026-06-26. **From:** PM. **For:** Builder (Mendel/Sagan).
**ADRs this ticket implements:** ADR-0036 (V5 TWAB architecture — §3.1 observations, §3.4 draw skip, §4 winner determination), ADR-0039 (transferable ERC-4626 share → re-enable TWAB-on-transfer), ADR-0037 (calendar-anchored cadence — period-boundary interaction).
**No ADR is being changed by this ticket.** The design is already recorded in those three ADRs; this is implementation + a correctness investigation + the missing tests. If any item below forces a design choice not covered by an ADR, **stop and write the ADR first** (CLAUDE.md working rule 1).

The V5 soak is **paused** pending TWAB-1. This ticket is the gate to un-pause it.

---

## TWAB-1 — Phantom-TWAB on an empty period (LAUNCH-BLOCKER)

**Source:** `tasks/v5-soak-finding-phantom-twab-draw11.md` (full evidence). **Severity:** HIGH.

**Symptom.** On the M8 testnet soak, `draws(11)` recorded `totalTwab = 2.994` and minted a **0.996 MON prize for a period with zero participant balance**. A full-history Deposit scan of the vault found exactly one deposit, timestamped **760s after** draw 11's period ended (it belongs to period 12). `getTwabBetween(account, period11)` correctly **reverts `InsufficientHistory`**; yet `getTotalTwabBetween` over the same period returned non-zero. The off-chain winner builder correctly computes participant-sum TWAB = 0, which is why the keeper's TWAB-mismatch guard fired (guard working as intended).

**Leading hypothesis (confirm or refute, don't assume).** The vault-total observation read extrapolates/attributes a later observation into a period that precedes the first observation, while the per-account read is guarded by `InsufficientHistory`. That asymmetry — total path returns phantom mass where the account path correctly reverts — is the prime suspect. Alternatives to rule out: (b) the draw's stored `[periodStart, periodEnd)` doesn't match the period whose TWAB `startDraw` actually measured; (c) an unobserved sponsor/balance interaction.

**Required behavior (ADR-0036 §3.4).** A draw whose period has **zero total participant TWAB must skip cleanly** — recorded, no prize minted, prize rolls to the next period. A phantom prize on an empty period must be impossible.

**Work:**
1. Reproduce in a test: single deposit whose observation timestamp falls in period N+1, then query period N — assert `getTotalTwabBetween(vault, startN, endN) == 0` (or reverts consistently with the per-account read; pick the behavior that matches PoolTogether upstream and make both paths agree).
2. Root-cause: is this upstream PoolTogether behavior, or an EverDraw adaptation defect (we split participant-total vs full-principal totals at M1 — check that split)? State which, with the offending lines.
3. Fix so total and per-account reads are **consistent** at the empty-period boundary.
4. Enforce the §3.4 skip as a **hard invariant**: no draw with zero participant TWAB may produce a non-zero `totalPayout`. Add it to the invariant suite.
5. Cross-check that `startDraw` measures exactly the draw's stored `[periodStart, periodEnd)` (rules out hypothesis b).

---

## TWAB-2 — Re-enable TWAB-on-transfer for the ADR-0039 transferable share

**Context.** M1 (`tasks/v5-m1-twab-gate-evidence-2026-06-15.md`) **removed user-facing transfer/delegation flows** and kept only the sponsor-delegate surface. ADR-0039 makes the V5 position a **real transferable ERC-4626 share**, which **reverses that removal**. Transfer paths are therefore currently unimplemented/untested.

**Work:**
1. Re-introduce the upstream balance-transfer path so a mid-period transfer updates **both sender and receiver** observations atomically (one balance decrease + one increase, both written to the ring buffers).
2. Verify the timing-attack property survives transfers: a transfer **in** late in a period yields ~zero current-period odds for the receiver (identical to a late deposit — ADR-0036 §3.4, "a last-second deposit has negligible average"). A transfer must **not** let anyone buy current-period odds.
3. Confirm sponsor-delegated balances stay excluded from participant odds across transfers (participant-total vs full-principal split, ADR-0036 §3.1).
4. **Re-point/extend the differential harness** (`test/v5/EverdrawTwabControllerDifferential.t.sol`) to cover `transfer`/`transferFrom` against the pinned PoolTogether commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112` — these paths lost coverage when transfer was removed at M1.

---

## TWAB-3 — Period-boundary / cadence consistency (ties to ADR-0037, backlog P1-5)

Because TWAB-1 may be a boundary-attribution issue, close the boundary semantics in the same pass:
1. Confirm period boundaries are **half-open `[start, end)`** consistently between the draw record and every TWAB query — no off-by-one that double-counts or drops the boundary second.
2. Confirm a calendar-anchored **skipped/zero-TWAB period still consumes exactly one `drawPeriod` slot** (ADR-0037 / P1-5) and leaves **no TWAB gap or overlap** with its neighbors.
3. Add the drift+empty-period test: N consecutive empty periods advance the schedule by exactly `N · drawPeriod`, each recorded as a clean skip, with no phantom TWAB on any of them (this also regression-guards TWAB-1).

---

## External dependencies (CLAUDE.md working rule 5)

- **PoolTogether upstream** commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112` — the pinned differential reference of record (`test/v5/upstream/PoolTogetherV5TwabReference.sol`). If TWAB-1's correct behavior is found to diverge from upstream, document the divergence and why it is safe.
- **IRandomnessOracle (ADR-0029)** — draw seed; unchanged by this ticket, but the §3.4 skip must avoid VRF spend on skipped draws "where avoidable."
- **shMON ERC-4626 strategy** — prize backing; unchanged here (but note the separate P1-4 shortfall-rounding item).
- **Merkl** — event-shape re-confirm against the *real* ADR-0039 share token is **tracked separately** in the backlog ADDENDUM (P1); call it out if your transfer change alters the emitted `Transfer`/`balanceOf` surface.

## Acceptance criteria

- [ ] No draw mints a non-zero payout on a zero-participant-TWAB period (test + invariant).
- [ ] `getTotalTwabBetween` over an empty/pre-history period agrees with the per-account read (returns 0 or reverts consistently) — root cause stated with offending lines.
- [ ] `startDraw` provably measures the draw's stored `[periodStart, periodEnd)`.
- [ ] Transfer updates both sender and receiver TWAB atomically; a late transfer-in cannot raise current-period odds; sponsor exclusion holds across transfers.
- [ ] Differential harness extended to transfer paths vs the pinned upstream commit; full M1 suite green **including** the new empty-period and transfer cases.
- [ ] Boundary half-open consistency + drift/empty-period test landed.
- [ ] `tasks/v5-m1-twab-gate-evidence-2026-06-15.md` updated with the new cases and re-run results.

## Out of scope (don't bundle)

- Keeper `previewStartDraw()` view + revert-path regression tests — backlog **P1-2**.
- Keeper input-builder → proper indexer — backlog **P1-3**.
- Shortfall deposit-rounding boundary — backlog **P1-4**.
- ADR-0006 Merkl event-shape re-confirm against the real share token — backlog ADDENDUM **P1** (depends on ADR-0039 landing, but is its own verification task).
