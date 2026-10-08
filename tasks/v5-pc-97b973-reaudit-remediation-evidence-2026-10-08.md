# V5 Patron capital re-audit remediation evidence

Date: 2026-10-08

Status: ready for independent re-audit; no live execution authorized or performed

Decision record: ADR-0051

Source review:
`/home/c/.openclaw/workspace/.worktrees/v5-pc-reaudit-97b973-20261008/tasks/v5-pc-97b973-independent-reaudit-2026-10-08.md`

Reviewed baseline: `97b97315c372f76948e406d863ed4c0df4722d80`

## Finding closure

### R325-01 - forced native MON migration denial of service

- `ShmonStrategy.receive()` now accepts native MON and emits `NativeDustReceived`.
- Raw native MON remains excluded from `totalAssets()`, principal, and prize yield.
- `migrateTo()` retains the existing all-native forwarding step, so forced dust cannot block a same-code replacement.
- Unit coverage verifies direct native receipt is non-accounting.
- Fresh-vault migration coverage forces one wei into the old adapter, then proves exact shMON and native-dust conservation, unchanged principal, and a complete exit.
- The pinned current-mainnet-vault fork forces one wei into the deployed old adapter and proves the corrected replacement migrates and restores the complete exit.

### R325-02 - unauthenticated replacement runtime

The migration CLI now fails closed unless all of the following match:

- a clean worktree at the exact `APPROVED_REPLACEMENT_COMMIT`;
- compiled source hash equal to the current worktree source;
- locally materialized runtime hash equal to `APPROVED_STRATEGY_RUNTIME_CODEHASH`;
- deployed runtime byte-for-byte equal to that approved local runtime;
- the mainnet shMON immutable equals `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`;
- `shareToken()` and one-time `vault()` binding match the approved dependencies.

Committed-phase verification authenticates the mined transaction target and selector and records numbered snapshots from the block before commit and the commit block. It checks exact shMON share conservation, exact native-dust conservation, and unchanged participant, sponsor, Patron, aggregate principal, and deposit cap. The follow-up remediation binds those snapshots to the receipt/header chain and re-reads the identities after state collection.

Executable negative controls reject plausible getters with arbitrary/stale runtime, wrong immutable, wrong vault binding, stale compiled source, wrong or dirty source identity, wrong approved runtime hash, missing shares, changed principal, and invalid phase state.

### R325-03 - invalid pre-queue verification flow

`--verify` now requires an explicit `--phase prequeue|queued|committed`:

- `prequeue` authenticates a fresh target while the recorded old adapter is active and pending strategy is zero;
- `queued` requires the exact target and a nonzero activation time;
- `committed` requires a successful `MIGRATION_COMMIT_TX`, validates the transaction, and proves conservation from pinned snapshots.

The runbook uses these exact phases and carries the approved commit and runtime hash through every verification command.

## Approved-build fingerprints

A forced Hardhat rebuild on the remediation worktree produced:

- Compiler: `0.8.33`
- EVM target: `paris`
- Source hash: `0x86a66780da4e61c31eb8a5bb070e8575502d647bb0c73193e59d53f89865d74a`
- Settings hash: `0xb8eb26c8a0f634243409168668a5d58207e40e8f270531085a64278cc0f83e11`
- Mainnet-shMON-materialized runtime code hash: `0x7613697b3e2d63da9cacf931ed10f890cfc76b0b66a431fcc9a7f91c284ca47b`

The independently approved merged commit must be supplied at execution time. The runtime hash above must be independently reproduced and approved; the migration CLI requires both values before any deployment transaction.

## Verification results

- `npx hardhat compile --force`: 24 Solidity files compiled successfully, Paris target.
- Migration/deployment JavaScript tests: 20 passed, 0 failed.
- Complete `forge test -q`: exit 0 with committed invariant limits unchanged.
- Pinned real-shMON suite at block `111477200`: 12 passed, 0 failed, 0 skipped.
- Current-mainnet-vault forced-native migration fork: 1 passed, 0 failed, 0 skipped.
- Targeted `forge fmt --check` for all touched Solidity files: passed.
- JavaScript syntax checks and `git diff --check`: passed.
- Read-only mainnet migration plan: exit 0 at block `111556734`.

The read-only plan confirmed:

- Vault: `0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa`
- Owner: `0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2`
- Active strategy: `0xA3e037641825B17586cC9B5D4d9473A76f25c44b`
- Pending strategy: zero
- Principal: `1006010100738197926`
- Old strategy shares: `616510436451682373`
- Old strategy native dust: zero
- Deposit cap: `25000000000000000000000`

## Remaining gates

1. Independently re-audit the exact merged remediation commit and reproduce the runtime hash.
2. Obtain explicit GO for the current-vault exit-restoration migration and the fresh ADR-0051 stack separately.
3. Only after GO, execute the runbook's deploy, prequeue verification, Ledger queue, 24-hour review, commit, two-RPC conservation verification, and live complete-exit proof.
4. Keep the current vault withdraw-only after migration.
5. Deploy and independently verify a fresh full stack before reopening deposits.
6. Do not raise the 25,000 MON cap. The proposed 1,500,000 MON allocation remains NO-GO.

No mainnet pause, deployment, queue, commit, withdrawal, service re-point, or configuration change was performed while producing this evidence.
