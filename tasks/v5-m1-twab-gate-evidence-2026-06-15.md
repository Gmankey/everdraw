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
