# PR #319 deployment-tooling remediation response

**Date:** 1 October 2026  
**Addresses:** R319-03 and R319-04 from `v5-pr319-0da0c6-independent-reaudit-2026-09-28.md`  
**Operational state:** Code and tests only. No mainnet deployment, queue, commit, service update, or user transaction was performed.

## R319-03: dedicated V5 replacement verification

Added `scripts/verify-v5-strategy-replacement.mjs` and
`scripts/lib/v5-strategy-replacement-verifier.mjs`. The verifier:

- selects exactly one nested `ShmonStrategy` component from an append-only V5 strategy migration;
- requires the selected component to be `local-runtime-match`;
- fails if RPC chain ID is not 143, RPC is unavailable, or deployed code is absent;
- validates the raw live-runtime SHA-256 recorded in the component;
- zeroes compiler-declared immutable references and compares the live runtime with the reviewed
  Hardhat build output;
- separately records and validates the immutable-normalized runtime SHA-256;
- binds the record to the migration's source commit, source SHA-256, complete build-info SHA-256,
  Solidity/compiler settings, and production Paris target;
- checks `shareToken`, `vault`, `nativeMigrationSource`, owner, and vault active/pending wiring;
- preserves the original stack `deployCommit`, `startBlock`, non-strategy addresses, and each
  unchanged component's original provenance.

The generic `check:bytecode` command is now explicitly documented as insufficient for nested V5
migration approval. The migration runbook requires `check:v5-strategy-replacement` before queue,
during the timelock, and after commit.

## R319-04: compile and artifact provenance before broadcast

`scripts/deploy-v5-strategy-replacement.js` now:

- compiles before loading a factory on both dry-run and confirmed paths;
- rejects a missing artifact or build info;
- rejects an ABI missing any required replacement function;
- requires the build input source to equal the checked-out source;
- requires artifact runtime to equal build-info runtime;
- requires Solidity 0.8.33, Paris, viaIR, and optimizer runs 200;
- reports source, build-info, raw deployed-runtime, normalized runtime, and compiler evidence;
- retains the exact `DEPLOY V5 STRATEGY REPLACEMENT` confirmation;
- routes deployment through a tested boundary that cannot invoke `factory.deploy` without the exact
  confirmation.

The `monadMainnet` Hardhat default chain ID is corrected from 101 to 143, and the runbook also
exports `MONAD_MAINNET_CHAIN_ID=143`. The fork profile remains Cancun; production compilation
remains Paris.

## Regression evidence

Commands run locally:

```bash
npm run build
npm run test:v5-strategy-release
forge test --match-path test/v5/PrizeVaultV5ShareBackingHardening.t.sol -vv
forge test --no-match-contract Fork --no-match-test invariant -vv
cd web && npm run test:v5-release
```

Results:

- Hardhat compile: 24 Solidity files compiled successfully, EVM target Paris.
- Deployment/verifier tests: 22 passed, 0 failed.
- Focused share-backing/migration suite: 11 passed, 0 failed.
- Broad non-fork, non-invariant Solidity suite: 332 passed, 0 failed, 0 skipped.
- Frontend release/cutover suite: 6 passed, 0 failed.
- Actual Hardhat `ShmonStrategy` build passed the provenance validator with Solidity 0.8.33,
  Paris, viaIR, and optimizer runs 200.
- Script syntax and `git diff --check`: passed.

Negative coverage includes absent artifact, old ABI, stale source/build input, Cancun artifact,
unconfirmed execution, wrong strategy address, skipped nested component, absent deployed code, raw
runtime mismatch, normalized runtime/build mismatch, stale build provenance, changed historical
component provenance, unavailable RPC, wrong chain, and wrong wiring.

## Requested independent retest

Retest R319-03 and R319-04 against the immutable PR head. If approved, the operator can proceed
through the governed runbook only with separate explicit authorization. Approval of this commit is
not authorization to deploy or transact.
