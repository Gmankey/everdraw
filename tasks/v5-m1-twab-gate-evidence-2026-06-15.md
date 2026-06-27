# V5 M1 TWAB Gate Evidence — 2026-06-15

Branch/worktree: `feat/v5-twab-m1` at `/home/c/.openclaw/workspace/everdraw-v5-twab-m1`

## Scope Landed

- Added `src/v5/twab/EverdrawTwabController.sol`, adapted from PoolTogether V5 TWAB Controller lineage.
- Restricted writes to owner-registered vaults.
- Removed user-facing transfer/delegation flows; retained only the sponsor delegate accounting surface.
- Split total accounting into participant totals and full-principal totals so winner odds and sponsor fee attribution can use different denominators.
- Added PoolTogether source/license notice in `src/v5/twab/POOLTOGETHER_NOTICE.md`.
- Added a pinned upstream-compatible differential harness under `test/v5/upstream/`.

## Gate Coverage

- Registered-vault write authorization.
- Owner-only vault registration.
- Same-period overwrite behavior.
- Period-boundary TWAB reads.
- Pre-offset reads.
- Zero-length reads.
- Current overwrite-period query rejection.
- Participant total TWAB equals eligible account TWAB.
- Sponsor deposits have zero participant odds while remaining readable via delegate TWAB.
- Sponsor withdrawal updates delegate and principal TWAB.
- Multi-account plus sponsor hand-calculated reference timeline.
- Ring-buffer wraparound using a test-only small cardinality subclass.
- Direct differential tests against PoolTogether V5 TWAB commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112` for same-period overwrite, sparse binary-search reads, participant totals, sponsor zero-delegate observation skipping, and ring-buffer wraparound.
- Fuzzed two-epoch account TWAB against a hand calculation.
- Invariants for current supplies, account balances, and sponsor delegate accounting over random participant/sponsor deposit/withdraw sequences.

## Verification

- `forge test --match-path 'test/v5/EverdrawTwabControllerDifferential.t.sol' -vv`
  - 5 tests passed, 0 failed, 0 skipped.
  - Differential reference: `test/v5/upstream/PoolTogetherV5TwabReference.sol`, vendored from `GenerationSoftware/pt-v5-twab-controller` commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112`.
- `forge test --match-path 'test/v5/EverdrawTwabController*.t.sol' --no-match-contract '.*Invariant.*' -vv`
  - 20 tests passed, 0 failed, 0 skipped.
- `forge test --match-path 'test/v5/EverdrawTwabControllerInvariant.t.sol' -vv`
  - 3 invariants passed, 0 failed, 0 skipped.
  - Full configured invariant depth: 5000 runs / 250000 calls per invariant.
- `env -u MONAD_MAINNET_RPC_URL -u MONAD_MAINNET_FORK_BLOCK forge test --no-match-contract '.*Invariant.*' -vv`
  - 203 tests passed, 0 failed, 1 skipped.
- `npm run build`
  - Hardhat compiled successfully.

## M1 Gate Status

Closed. The shared PoolTogether-derived TWAB paths now have direct differential coverage against the pinned upstream commit. EverDraw-only sponsor accounting remains covered by local sponsor/unit/invariant tests, with the zero-delegate shared path compared to upstream.

---

## TWAB-1 Closure Addendum — 2026-06-26

Branch/worktree: `fix/twab-empty-period-skip-20260626` at
`/home/c/.openclaw/workspace/.worktrees/twab-empty-period-skip`

### Root Cause

The phantom empty-period TWAB was caused by a boundary mismatch between DrawManager cadence and the PoolTogether-derived TWAB read grid, not by the M1 participant-total/full-principal split.

- `EverdrawTwabController._getTwabBetween` snaps `startTime` and `endTime` through `_periodEndOnOrAfter` before reading observations (`src/v5/twab/EverdrawTwabController.sol:401-402`). This matches the pinned PoolTogether reference behavior.
- If a DrawManager period end is not exactly aligned to the TWAB period grid, a stored draw period `[periodStart, periodEnd)` can be measured as `[snappedStart, snappedEnd)`, where `snappedEnd > periodEnd`. A deposit after the stored draw end but before `snappedEnd` can then leak into the draw's total TWAB read.
- The participant-total/full-principal split was ruled out by the new aligned pre-history tests: participant total, principal total, and account reads all return zero for an aligned empty period before the first observation.

### Fix

`DrawManagerV5` now rejects any deployment whose `_firstPeriodStart` is not on the TWAB period boundary or whose `_drawPeriod` is not an integer multiple of `twab.periodLength()`.

This makes `startDraw`'s stored `[periodStart, periodEnd)` exactly match the period that `getTotalTwabBetween`, `getTotalPrincipalTwabBetween`, and `getDelegateTwabBetween` measure.

### New Coverage

- `test_emptyAlignedPeriodBeforeFirstObservationReturnsZeroForAccountAndTotal`
  - Single deposit lands in period `N+1`; querying aligned period `N` returns zero for account, participant-total, and principal-total TWAB.
- `test_differential_emptyAlignedPeriodBeforeFirstObservationMatchesUpstream`
  - Confirms the aligned empty-period behavior matches PoolTogether commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112`.
- `test_constructorRejectsDrawPeriodsNotAlignedToTwabGrid`
  - Prevents the cadence/TWAB-grid mismatch that caused the phantom read.
- `test_zeroParticipantTwabSkipInvariantHoldsWithSponsorYield`
  - Sponsor principal can create available yield, but zero participant TWAB records a `Skipped` draw with `totalPayout == 0`, no ClaimManager escrow, and no VRF request.
- Existing `test_driftSimulationEmptyPeriodsAdvanceExactlyNPeriods`
  - Confirms consecutive skipped periods still consume exactly one draw slot each.

### Verification

- `forge test --match-path test/v5/EverdrawTwabController.t.sol -vv`
  - 16 tests passed, 0 failed, 0 skipped.
- `forge test --match-path test/v5/EverdrawTwabControllerDifferential.t.sol -vv`
  - 6 tests passed, 0 failed, 0 skipped.
- `forge test --match-path test/v5/DrawManagerV5.t.sol -vv`
  - 17 tests passed, 0 failed, 0 skipped.
- `forge test --match-path 'test/v5/*.t.sol' --no-match-contract '.*Invariant.*' -vv`
  - 70 tests passed, 0 failed, 1 skipped.

---

## TWAB-D/2/3 Closure Addendum — 2026-06-26

Branch/worktree: `fix/twab-empty-period-skip-20260626` at
`/home/c/.openclaw/workspace/.worktrees/twab-empty-period-skip`

### TWAB-D — Testnet Deploy Grid Guard

- `scripts/deploy-v5-testnet.js` now validates:
  - `DRAW_PERIOD_SEC % TWAB_PERIOD_LENGTH_SEC == 0`.
  - `TWAB_PERIOD_OFFSET <= latest.timestamp`.
  - `FIRST_PERIOD_START` is exactly on the TWAB grid when explicitly supplied.
- The default `firstPeriodStart` is snapped forward to the next TWAB grid boundary from `latest.timestamp + FIRST_PERIOD_DELAY_SEC`.
- Deploy logs include the resolved `firstPeriodStart`, whether it was explicit, the alignment remainder, offset age, and draw-period remainder.

### TWAB-2 — Transferable Share / TWAB-on-Transfer

- `PrizeVaultV5` now exposes the ADR-0039 ERC-20 share surface: `allowance`, `approve`, `transfer`, `transferFrom`, `Transfer`, and `Approval`.
- Participant share transfers move `principalOf` between accounts without changing `totalParticipantPrincipal` or `totalPrincipal`.
- `EverdrawTwabController.transferBalance` updates sender and receiver observations atomically while leaving participant/full-principal totals unchanged.
- Sponsor principal remains non-transferable and excluded from participant odds.
- Differential coverage now includes transfer and transferFrom-equivalent paths against the pinned PoolTogether commit `29926961b2ecfa89e0f61a6d874c71b6f8e29112`.

### TWAB-3 — Empty-Period Drift Closure

- The empty-period drift test now asserts every empty draw:
  - emits `DrawSkipped(..., "ZERO_TWAB")`;
  - stores the exact half-open `[periodStart, periodEnd)` slot;
  - advances `nextPeriodStart` by exactly one `drawPeriod`;
  - records zero `totalTwab` and zero `totalPayout`;
  - makes no VRF request.

### Added/Updated Tests

- `test_transferUpdatesSenderAndReceiverTwabWithoutChangingTotal`
- `test_transferAtPeriodBoundaryDoesNotBuyPreviousPeriodOdds`
- `test_differential_transferMatchesUpstreamAccountPaths`
- `test_differential_transferFromMatchesUpstreamAccountPaths`
- `test_transferMovesParticipantSharesAndUpdatesTwab`
- `test_transferFromSpendsAllowanceAndUpdatesTwab`
- `test_sponsorPrincipalCannotTransferAndStaysExcludedFromParticipantOdds`
- Updated `test_driftSimulationEmptyPeriodsAdvanceExactlyNPeriods`

### Verification

- `node --check scripts/deploy-v5-testnet.js`
  - Passed.
- `forge test --match-path test/v5/EverdrawTwabController.t.sol -vv`
  - 18 tests passed, 0 failed, 0 skipped.
- `forge test --match-path test/v5/EverdrawTwabControllerDifferential.t.sol -vv`
  - 8 tests passed, 0 failed, 0 skipped.
- `forge test --match-path test/v5/PrizeVaultV5.t.sol -vv`
  - 22 tests passed, 0 failed, 0 skipped.
- `forge test --match-path test/v5/DrawManagerV5.t.sol -vv`
  - 17 tests passed, 0 failed, 0 skipped.
- `forge test --match-path 'test/v5/*.t.sol' -vv`
  - 86 tests passed, 0 failed, 1 skipped.
