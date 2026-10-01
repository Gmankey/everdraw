# PR #319 independent re-audit remediation response

**Date:** 28 September 2026  
**Incident:** OPS-20260927-01  
**Input:** `tasks/v5-pr319-independent-reaudit-2026-09-28.md`

## R319-01  resolved in candidate code

`ShmonStrategy` now has a one-time owner-configured `nativeMigrationSource`. Its receive path accepts
native MON only from that predecessor. Raw MON remains excluded from `totalAssets`, principal,
TWAB, and `availableYield`, and `migrateTo` carries it to a subsequent correctly configured
replacement.

Regression evidence:

- Unauthorized and zero source configuration revert.
- The migration source cannot be changed after it is set.
- Unrelated native transfers still revert.
- A pinned mainnet fork forces 1 wei into the original deployed strategy before commit.
- The governed migration succeeds with exact shMON transfer and unchanged principal/yield.
- A second forced 0.25 MON plus the original 1 wei crosses a second governed migration.
- The second replacement excludes the native balance from accounting.
- The affected participant then completes a normal full exit.
- Public Monad RPC pinned-fork result: 1 passed, 0 failed, 0 skipped.

## R319-02  resolved in code and procedure

The production frontend now obtains the shMON approval target through the parsed release config.
The migration regression proves:

- old manifest + replacement runtime fails closed;
- replacement manifest + replacement runtime passes;
- direct shMON approval targets the replacement strategy.

The guarded deployment helper is
`scripts/deploy-v5-strategy-replacement.js`. It is preflight-only without the exact confirmation
string and verifies the current strategy, share token, vault, pending-strategy state, replacement
vault, replacement share token, and configured predecessor.

The coordinated executable procedure is
`tasks/v5-ops-20260927-01-strategy-migration-runbook.md`. It includes append-only deployment
provenance, candidate manifest/build, Ledger queue/commit, fail-closed frontend transition,
production Vercel activation, keeper refresh, unchanged indexer start/history, and live closure
evidence. It does not authorize a live action.

## Verification

- Full Solidity suite: 341 passed, 0 failed, 2 skipped.
- Invariants: 5,000 runs / 250,000 calls per invariant, all passed.
- New focused strategy unit suite: 11 passed, 0 failed.
- Pinned forced-native mainnet-fork regression: 1 passed, 0 failed.
- Frontend release-config tests: 6 passed, 0 failed.
- Frontend UAT production bundle compile: passed.
- Deployment helper syntax: passed.
- `git diff --check`: passed.

The two skipped tests in the unconfigured full-suite invocation are the RPC-gated real-shMON suites;
the new pinned adversarial fork was run separately and passed.

## Live state

No contract was deployed, no strategy change was queued or committed, and no production service or
frontend was changed. The live vault still uses the original strategy. OPS-20260927-01 remains open
until independent approval, governed migration, coordinated release cutover, and a live normal full
exit complete.
