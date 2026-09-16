# V5 final focused mainnet closure — 2026-09-16

**MAINNET GO for staging commit `1d7906da0fcfa2153b9b822c70967ea846be2a8a`. Remaining audit/release blockers: none within the agreed release scope.**

Tree: `cd1067f3b3c9c2c7eec36730470e0679acf3b432`. Fetched `origin/staging` and verified that it resolves to this exact commit. This report closes the sole remaining legitimate gate, R-303-01, through merged PR #305 (`a6673f0ad37b8d5c33b9cd4b6ac8ffc60daf8651`) and confirms that later PRs #307/#308 do not change the tested points behavior.

This is approval to proceed with the existing mainnet deployment runbook for the pinned candidate, not a statement that mainnet has already been deployed. No deployment, live database reset, transaction, or product-code modification was performed during this review.

## R-303-01: CLOSED

The independent September 14 reproduction was reused with assertions changed to require correct behavior. Each fixture uses real in-memory SQLite repositories, canonical raw position/draw events, tranche derivation and points replay; no mocked points or streak outputs.

For both full withdrawal and full transfer: hold 100 MON through four complete earning periods, fully exit at the fourth period end or one second later, and re-enter one second after exit, before any old settlement. Old settlements are tested in both forward and reverse order. This yields eight independent re-entry fixtures.

| Observation | Full withdrawal | Full transfer |
|---|---:|---:|
| Active streak after old delayed settlements | 0 | 0 |
| Historical longest retained | 4 | 4 |
| Legitimately earned historical points retained | 18,220 | 18,220 |
| All four historical award rows preserved exactly | Pass | Pass |
| Active streak after nine fresh participating draws | 9 | 9 |
| Longest after those nine draws | 9 | 9 |
| Total points at that point | 19,957 | 19,957 |
| Highest milestone remains | 4 | 4 |
| Early 13-draw / 20,000-point milestone | Absent | Absent |
| Repeated replay preserves award rows and profile values | Pass | Pass |

Each fresh draw was added and replayed separately: active progression is exactly 1 through 9, with no duplicate old milestone or early new milestone. The first fresh period includes the shortly-after-boundary re-entry, preserving the original reproduction's participation semantics.

Positive control: continue to thirteen fresh draws. Active and longest become 13, the highest milestone becomes 13, and the legitimate 20,000-point milestone appears exactly once on draw 17. Replay does not duplicate it. This establishes that closure does not merely suppress milestone awards.

Two additional independent remaining-empty fixtures, withdrawal and transfer, preserve two genuine missed draws, historical longest 4 and 18,220 points while active remains 0.

Negative control: the same closure script was run on pre-fix #304 commit `84c7dffb108b2d1ed894e893dd463397ac34ff5c`. It fails at the intended assertion: **actual active 4, expected 0**. The failure is the original defect, not a harness/import/build failure.

## Supporting checks and later merges

- PR #305's `derivePointsDelayedReentry.test.ts`: all 21 backlog, exact-boundary, reversed-settlement, within-period re-entry and partial-exit fixtures pass.
- Existing `derivePointsV5Checkpoint`, `derivePointsCanonicalReplay`, `deriveV5Transfers` and `derivePoints` test files pass. These specifically cover the checkpoint, historical awards and tranche boundaries touched by this fix.
- Indexer TypeScript build passes. Frontend points/value tests pass, four TAP tests total, including historical longest independence and amount-weighted tranche multiplier display.
- The complete `scripts/indexer` Git tree is identical at #305 and the candidate: `b7a7e789e3df367290251de51be73dc3358f831d`. This includes the points services, repositories, API, tests and indexer dependency manifests.
- PR #307 removes the browser claim feature/hold, restores normal keeper submission, changes product/docs copy and prize projection, and removes duplicate milestone display. It does not change points derivation, award values, active progression or tranche multipliers. The remaining frontend points behavior was checked against its diff and passing tests. Proof storage and winner attribution remain in the unchanged indexer.
- PR #308 changes only `docs-site/package.json` and its lockfile for the sharp update; it has no path into indexer points execution.
- Solidity source tree, contract tests, root dependency manifests and compiler configuration are identical to #305. Source tree ID is `39b597146ae1cc2eb7ee2e3f9da349350e674b9a`. These PRs introduce no requirement for an additional contract redeployment.

## Final closure checklist

| Item | Final disposition |
|---|---|
| R-303-01: withdrawal/transfer, delayed settlement, re-entry, early milestone | **Closed by independent retest above** |
| Prior code audit findings, including formula guards, replay/health isolation and transfer/prize-ownership coverage | Prior accepted closures retained; no affected contract delta requiring their repetition |
| Historical longest display-only; legitimate awards and missed-draw counts | Preserved; focused checks pass |
| Genuine-stop dead-man DOWN/recovery | Accepted recovered evidence retained |
| Keeper claims, watcher, backup/reset and recovered user-path evidence | Prior accepted evidence retained |
| Browser-originated claim acceptance | Withdrawn by September 15 requirements-drift correction; not a gate |
| Seven-day duration / higher paying-draw count | Operator waiver / recorded count acceptance retained; not gates |
| Prize-only withdrawal / transfer UI drills | Outside approved required scope; not gates |
| Outstanding blockers | **None** |

This supersedes the NO-GO and remaining-blocker entries in `tasks/v5-focused-final-closure-checklist-2026-09-14.md`, together with the scope correction in `tasks/v5-product-requirements-drift-audit-2026-09-15.md`. Prior accepted evidence is retained rather than rerun without cause.

## Reproduction and exact evidence

Isolated checkout: `/home/c/.openclaw/workspace/audit-closure-20260916`.

Evidence directory: `/home/c/.openclaw/workspace/audit-closure-20260916/scripts/indexer/audit/`.

- `r303-closure-retest.ts`: independent executable reproduction and closure assertions.
- `r303-closure-results.json`: exact outcomes for all ten independent fixtures. SHA-256: `ff627530f1835146bc90ce78c5fea7e3cbca661f985ee5d76213d295938e13e3`.
- `independent-closure.log`, `negative-control-pr304.log`: passing candidate and expected failing old commit.
- `suite-results.json`: all nine execution jobs and exit codes; eight expect success, the old-commit negative control expects failure.
- `services_*.log`, `frontend-points.log`, `indexer-build.log`: supporting checks.
- `evidence-manifest.json`: pinned commits/tree, source-equivalence IDs, runtime version and SHA-256 hashes of scripts/results/logs.

Run the complete focused verification from the checkout with `python3 scripts/indexer/audit/run-closure.py`; run only the independent candidate test from `scripts/indexer` with `./node_modules/.bin/tsx audit/r303-closure-retest.ts`. Node v22.22.0 was used. Existing installed dependencies were reused through symlinks after confirming unchanged relevant manifests/lockfiles. `git diff --exit-code` and `git diff --check` pass; only untracked audit artifacts and dependency links were added to the isolated checkout.
