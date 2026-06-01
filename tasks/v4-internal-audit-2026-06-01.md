# V4 Internal Audit Pass — Draft

**Date:** 2026-06-01  
**Scope:** `TicketPrizePoolV4`, `PythRandomnessOracle`, V4 interfaces, initial V4 Foundry test scaffolding.  
**Status:** Draft / PR-stage. This is not deploy approval.

## Summary

V4 implementation has been started on `feat/v4-contract` from `origin/staging`.

Implemented surfaces:

- Merkl-readable non-transferable position surface: `name`, `symbol`, `decimals`, `balanceOf`, `totalSupply`, `Deposit`, `Withdraw`.
- Generic native/ERC-20 deposit paths with ERC-4626-style `IYieldVault`.
- Multi-winner selection with per-vault fixed allocation.
- Sponsor drop-in contributions with skipped-round refund path.
- Multi-recipient fee allocation snapshots.
- Transfer deferral wrapper for yield-vault share transfers.
- Randomness oracle abstraction and Pyth adapter.
- Graceful `stop()`.
- Separate `pauser` role.
- Mutable ticket price with per-round snapshot.
- V3 hardening preserved at a high level: two-step ownership, per-round metadata, fee snapshot, 24h oracle timelock, version constant.

## Commands Run

```bash
npm install
npm run build
npm run check:abi
npm run check:deploy-source
npm test
git grep -n "yieldVault.transfer" -- src/TicketPrizePoolV4.sol
```

Results:

- `npm run build`: passed.
- `npm run check:abi`: passed.
- `npm run check:deploy-source`: passed.
- `npm test`: passed with 0 Hardhat tests, because this repo's Hardhat test path currently has no JS tests.
- `git grep -n "yieldVault.transfer" -- src/TicketPrizePoolV4.sol`: no matches.
- `forge test`: not run in this environment because `forge` is not installed.

## Findings / Open Items

### F-01 — Foundry suite is scaffolded but not executed here

Severity: High for merge readiness.

The builder ticket requires `forge test`. This WSL environment currently returns `forge: command not found`. Initial V4 Foundry test files and mocks exist, but they must be run in an environment with Foundry installed before merge.

Resolution required:

- Install Foundry in the builder environment or run the branch in the operator's Foundry-capable environment.
- Expand the current scaffold into the required ≥10-case suites before deploy approval.

### F-02 — `forfeitBps` settlement accounting needed one extra field

Severity: Medium / needs PM confirmation.

ADR-0025 says when `effectiveN < numWinners`, `forfeitBps` is set and "Each depositor's withdraw bonus = principalReturn × forfeitBps / 10000." That formula can overpay if the actual unallocated prize is smaller than principal return × bps. The implementation records `forfeitPrizeShares` and distributes the actual unallocated prize pro-rata by deposited asset principal.

Resolution required:

- PM/operator should confirm this interpretation in PR review.
- If the literal ADR formula is intended despite the accounting risk, revise with an explicit invariant proof.

### F-03 — Pyth oracle deployment has a constructor-address ordering constraint

Severity: Medium / deployment runbook concern.

`PythRandomnessOracle` pins `consumer` immutable, while `TicketPrizePoolV4` requires the oracle address in its constructor. The deploy script precomputes the V4 vault address from the deployer's next nonce, deploys the oracle first with that predicted consumer, then deploys V4. This is correct for a simple EOA deploy sequence but must not be interrupted by any extra transaction between the two deploys.

Resolution required:

- Operator deploy runbook must keep the oracle/vault deployment atomic in one script.
- If multisig deployment is required later, use CREATE2 or a two-phase oracle design.

### F-04 — `claimDeferred` uses low-level transfer retry

Severity: Low / audit clarity.

The acceptance grep requires no direct `yieldVault.transfer(...)` calls outside `_transferOrDefer`. The implementation uses a single low-level `_tryYieldVaultTransfer` helper, called by `_transferOrDefer` and deferred retry. Grep passes, but auditors should review that helper as the single transfer primitive.

Resolution required:

- Confirm this satisfies ADR-0028 intent.

## Not Yet Deploy-Ready

This branch should be treated as a PR-stage implementation, not a deployable artifact, until:

- Foundry is installed and `forge test` passes.
- The V4 test suites are expanded to the required depth.
- Operator resolves F-02 in PR review.
- A second internal audit pass reviews the final diff after tests are complete.
