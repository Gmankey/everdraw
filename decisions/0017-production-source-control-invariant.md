# ADR-0017 - Production source-control invariant

**Status:** Accepted
**Date:** 2026-05-22

## Decision

EverDraw production must never be ahead of Git.

Every production contract must have, in `origin/staging`:

- Exact Solidity source.
- ABI and/or artifact used by frontend, keeper, and indexer.
- Constructor arguments.
- Deployment address and production role.
- Compiler version and settings.
- Runtime bytecode verification evidence.
- A deployment manifest entry.

If any of those are missing, the contract is not a valid source of truth for future work, even if it exists on-chain.

## Enforcement

Mainnet deploys must run `npm run deploy:preflight` before sending transactions.

Preflight refuses:

- Non-`staging` branches, unless explicitly overridden for a controlled release.
- Dirty working trees.
- Local HEAD not matching `origin/staging`.
- Missing production source-control files.

CI must run:

- `npm run build`
- `npm run check:abi`
- `npm run check:deploy-source`
- `forge test`

Direct deployment commands are not valid release procedure. Do not deploy mainnet with raw `npx hardhat run`, raw `forge script --broadcast`, or `cast send`. Mainnet deployment must use a committed wrapper that runs preflight before broadcasting.

For manual release review, operators should also run:

- `npm run check:bytecode`
- `~/.foundry/bin/forge test`

## Rationale

The V2 production source for Vault A was previously deployed from uncommitted local state and later recovered from a housekeeping backup. That caused downstream V3/VRF work to drift from the actual production implementation.

This invariant exists to make that class of mistake mechanically hard to repeat.

## Consequences

- Deploy scripts may be less convenient, but they must fail closed.
- Specs and ADRs are not enough; deployed behavior comes from committed source plus bytecode verification.
- A fresh PM or builder must be able to start from `PM_CURRENT_STATE.md` and `deployments/monad-mainnet.json` without prior chat context.
