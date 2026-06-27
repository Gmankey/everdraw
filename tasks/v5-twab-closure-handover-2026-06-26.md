# V5 TWAB Closure Handover — 2026-06-26

## Paths / Workspace

Use this worktree, not the root workspace checkout:

- Linux path: `/home/c/.openclaw/workspace/.worktrees/twab-empty-period-skip`
- Windows Explorer path: `\\wsl.localhost\Ubuntu\home\c\.openclaw\workspace\.worktrees\twab-empty-period-skip`
- Branch: `fix/twab-empty-period-skip-20260626`
- Tracking: `origin/fix/twab-empty-period-skip-20260626`

The root workspace `/home/c/.openclaw/workspace` has unrelated dirty files and other EverDraw historical/reference trees. Do not continue this ticket from the root checkout unless you intentionally move/merge the work.

## Source Documents

Read these first:

- `tasks/v5-twab-design-closure-builder-ticket.md` — the closure ticket and acceptance criteria.
- `tasks/v5-m1-twab-gate-evidence-2026-06-15.md` — updated evidence log with TWAB-1 and TWAB-D/2/3 addenda.
- `decisions/0036-v5-twab-architecture.md` — TWAB architecture, zero-TWAB skip, sponsor delegate model.
- `decisions/0039-v5-transferable-share-token.md` — ADR-0039, real transferable share token decision.
- `decisions/0037-v4-cadence-drift-defect.md` — cadence/drift defect and V5 fixed-period gate.

The user mentioned `tasks/v5-twab-testnet-completion-plan.md`, but that file is not present in this worktree. I used the full ticket plus the user's condensed instructions.

## Current Git State

Modified files:

- `scripts/deploy-v5-testnet.js`
- `src/v5/PrizeVaultV5.sol`
- `src/v5/twab/EverdrawTwabController.sol`
- `tasks/v5-m1-twab-gate-evidence-2026-06-15.md`
- `test/v5/DrawManagerV5.t.sol`
- `test/v5/EverdrawTwabController.t.sol`
- `test/v5/EverdrawTwabControllerDifferential.t.sol`
- `test/v5/PrizeVaultV5.t.sol`

No commit has been made by me. No deploy has been run.

## What Landed

### TWAB-1 — Phantom TWAB / Empty Period

Root cause: DrawManager periods could be off the PoolTogether-derived TWAB period grid. `EverdrawTwabController._getTwabBetween` snaps reads through `_periodEndOnOrAfter`; if a draw period end was off-grid, the measured TWAB interval could extend beyond the stored `[periodStart, periodEnd)` and include a later deposit. This was not caused by the M1 participant-total/full-principal split.

Fix: `DrawManagerV5` now rejects deployments where `_firstPeriodStart` is off the TWAB grid or `_drawPeriod` is not a multiple of `twab.periodLength()`.

Evidence/tests:

- `test_emptyAlignedPeriodBeforeFirstObservationReturnsZeroForAccountAndTotal`
- `test_differential_emptyAlignedPeriodBeforeFirstObservationMatchesUpstream`
- `test_constructorRejectsDrawPeriodsNotAlignedToTwabGrid`
- `test_zeroParticipantTwabSkipInvariantHoldsWithSponsorYield`

### TWAB-D — Testnet Deploy Script

`scripts/deploy-v5-testnet.js` now:

- Asserts `DRAW_PERIOD_SEC % TWAB_PERIOD_LENGTH_SEC == 0`.
- Asserts `TWAB_PERIOD_OFFSET <= latest.timestamp`.
- Computes the default `firstPeriodStart` from `latest.timestamp + FIRST_PERIOD_DELAY_SEC` and snaps it forward to the next TWAB grid boundary.
- Validates an explicit `FIRST_PERIOD_START`; it does not silently re-snap explicit operator input.
- Rejects explicit starts before the TWAB offset.
- Logs resolved alignment values: `firstPeriodStart`, `firstPeriodStartExplicit`, `firstPeriodStartRemainder`, `twabOffsetAgeSec`, and `drawPeriodRemainder`.

Pitfall: the old default was effectively `offset + 300`, which is not on the 3600-second TWAB grid and is rejected by the new `DrawManagerV5` guard.

### TWAB-2 — Transferable Share / TWAB-on-Transfer

`PrizeVaultV5` now exposes ERC-20-style share functions/events:

- `allowance`
- `approve`
- `transfer`
- `transferFrom`
- `Transfer`
- `Approval`

Participant transfers move `principalOf[from]` to `principalOf[to]` and call `twabController.transferBalance(from, to, amount)`. Totals do not change:

- `totalParticipantPrincipal` unchanged.
- `totalPrincipal` unchanged.
- participant total TWAB unchanged.
- full principal total TWAB unchanged.

`EverdrawTwabController.transferBalance` atomically decreases the sender observation and increases the receiver observation in the same transaction. It does not touch participant or principal totals.

Sponsor principal remains non-transferable at the vault surface because `balanceOf(sponsor)` is participant principal only. Sponsor delegate accounting remains excluded from participant odds.

Important nuance: this is the ERC-20 share surface needed by ADR-0039 and wallet scanners. The broader Merkl event-shape reconfirm against this real share token is explicitly out of scope in the ticket and remains a separate backlog item.

### TWAB-3 — Cadence / Drift

`test_driftSimulationEmptyPeriodsAdvanceExactlyNPeriods` was strengthened. For each empty draw, it now asserts:

- `DrawSkipped(..., "ZERO_TWAB")` is emitted.
- Stored `periodStart` and `periodEnd` are exact and consecutive.
- `nextPeriodStart` advances by exactly one `drawPeriod`.
- `totalTwab == 0`.
- `totalPayout == 0`.
- no VRF request occurs (`oracle.nextRequestId()` stays at 1).

## Verification Already Run

Syntax:

- `node --check scripts/deploy-v5-testnet.js` — passed.

Focused tests:

- `forge test --match-path test/v5/EverdrawTwabController.t.sol -vv` — 18 passed.
- `forge test --match-path test/v5/EverdrawTwabControllerDifferential.t.sol -vv` — 8 passed.
- `forge test --match-path test/v5/PrizeVaultV5.t.sol -vv` — 22 passed.
- `forge test --match-path test/v5/DrawManagerV5.t.sol -vv` — 17 passed.

Gate:

- `forge test --match-path 'test/v5/*.t.sol' -vv` — 86 passed, 0 failed, 1 skipped.

The exact gate took about 14 minutes because invariant depth is high (`runs = 5000`, `depth = 50` in `foundry.toml`). Do not assume it is hung just because it is silent for several minutes; check CPU first.

## Remaining Priorities / Next Builder Checklist

1. Review the diff carefully, especially the transfer semantics in `PrizeVaultV5` and `EverdrawTwabController`.
2. Decide whether the current share surface is sufficient for the ADR-0039 wording "ERC-20 / ERC-4626 share token". The implemented surface is ERC-20-style transferability on the existing vault deposit/withdraw API; it is not a full ERC-4626 interface.
3. Re-run the exact gate after any edit: `forge test --match-path 'test/v5/*.t.sol' -vv`.
4. If preparing PR/merge, include the evidence doc update in the same changeset.
5. Do not deploy from this worktree until branch/project intent is explicit and deploy preflight is done. This work was code/test only.

## Pitfalls

- The old deployment default was off-grid. If a testnet redeploy still fails at `DrawManagerV5`, inspect `FIRST_PERIOD_START`, `TWAB_PERIOD_OFFSET`, and `TWAB_PERIOD_LENGTH_SEC` first.
- Explicit `FIRST_PERIOD_START` is intentionally validated, not snapped. If the operator supplies a bad value, the script should fail loudly.
- `transfer`/`transferFrom` move participant principal only. They do not move sponsor principal.
- Transfers are allowed while paused/stopped; pause/stop should not trap principal or break the share token surface.
- `transferFrom` with `type(uint256).max` allowance does not decrement allowance.
- `Deposit`/`Withdraw` events still emit for principal accounting, and `Transfer` now emits on participant mint/burn/transfer. Sponsor deposit/withdraw does not emit ERC-20 `Transfer`.
- The pinned PoolTogether reference in `test/v5/upstream/PoolTogetherV5TwabReference.sol` does not have a first-class transfer function; the differential harness models transfer as upstream decrease-from plus increase-to, matching the shared accounting path.
