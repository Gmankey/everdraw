# PR #319 R319-03 immutable-reference remediation response

**Date:** 1 October 2026, Australia/Sydney  
**PR:** [#319](https://github.com/Gmankey/everdraw/pull/319)  
**Responds to:** `tasks/v5-pr319-c7ac22-focused-reaudit-2026-10-01.md`  
**Scope:** R319-03 only. R319-04 remains closed.

## Resolution

The verifier no longer treats compiler-declared immutable ranges as safe to ignore without first validating their values.

`validateStrategyBuild()` now resolves immutable declaration IDs from the Solidity AST for the exact `ShmonStrategy` contract. It requires exactly the reviewed `shmonVault` and `owner` declarations and a one-to-one compiler mapping. It fails closed on unknown, missing, duplicate, empty, malformed, out-of-bounds, or overlapping references.

Before runtime normalization, `verifyRuntime()` now compares every compiler-declared 32-byte word against an independently expected value:

- every `shmonVault` occurrence must equal the recorded constructor shMON address;
- every `owner` occurrence must equal the recorded deployment sender.

Only after all immutable occurrences pass does the existing normalized-runtime comparison run. Updating the manifest's raw hash to match altered code cannot bypass this check.

## Regression coverage

The release suite now includes:

- altered non-getter immutable references with a self-consistent raw runtime hash;
- every synthetic occurrence of both `shmonVault` and `owner`;
- every occurrence in the actual Solidity 0.8.33 Paris/viaIR/optimizer-200 build: eight `shmonVault` references and three `owner` references;
- unknown and missing compiler declaration IDs;
- malformed reference lengths;
- unexpected immutable declaration names;
- the existing valid pre-queue/pending/post-commit, missing-code, wrong-chain, unavailable-RPC, provenance, ordinary-bytecode-mismatch, and historical-record cases.

The Contracts workflow now executes this release suite after compilation so the immutable regression is enforced in CI.

## Verification

```text
npm run test:v5-strategy-release
28 tests passed; 0 failed; 0 skipped
```

The command performs a Hardhat compile before executing the suite. The actual-build test uses the generated compiler AST and immutable reference table rather than a hand-authored ordering.

`git diff --check` passes.

## Operational status

No mainnet deployment, strategy queue, strategy commit, service update, or user transaction was performed. The governed migration remains blocked pending independent approval of the new immutable PR head.
