# ADR-0016 - Production V2 source recovery

**Status:** Accepted
**Date:** 2026-05-22

## Context

Vault A at `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` was deployed from `TicketPrizePoolShmonV2`, but the Solidity source was not committed to the repo at deploy time.

The source survived only as a housekeeping backup of an untracked file:

`housekeeping-backups/everdraw-clean-20260508-155425/moved-untracked/src/TicketPrizePoolShmonV2.sol`

This broke the production source-of-truth invariant and caused later contract design work to rely on specs/ADRs instead of the exact deployed implementation.

## Recovered Source

The recovered file is restored to:

`src/TicketPrizePoolShmonV2.sol`

This file must be treated as the source of the current production no-unstake shMON V2 implementation unless bytecode verification proves otherwise.

## Bytecode Verification

Verification performed on 2026-05-22 against live Monad mainnet address:

`0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888`

Compiler/settings:

- `solc 0.8.33+commit.64118f21`
- optimizer enabled, `runs = 200`
- `viaIR = true`
- `evmVersion = paris`

Constructor immutables observed in live runtime bytecode:

- `shmon = 0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
- `roundDurationSec = 86400`
- `yieldPeriodSec = 518100`

Result:

```text
compiled runtime length: 17202 hex chars
live runtime length:     17202 hex chars
runtime sha256:          a8a7e930e3fde441e95f68966e94b3e7d533e92facfc5ab3aa6ef4d61a23bfd3
match after filling constructor immutables: true
```

The recovered source matches the deployed runtime bytecode exactly after constructor immutables are filled.

## Critical Implementation Facts

`settle(uint256 rid)` computes:

```solidity
uint256 principalShares = shmon.previewDeposit(r.totalPrincipalMON);
uint256 prizeShares = r.totalShmonShares > principalShares ? r.totalShmonShares - principalShares : 0;
```

`withdrawPrincipal(uint256 rid)` returns fair-value principal shares for profitable settled rounds:

```solidity
shares = r.principalSharesAtSettle * uint256(p.principalMON) / r.totalPrincipalMON;
```

It returns the user's original deposited share count only when the round has no prize, or when the round is skipped/failed:

```solidity
shares = originalShares;
```

## Source-Control Rule

Production contract source must never exist only in local untracked files. Before any deployed contract is considered a source of truth, the repo must contain:

- Exact Solidity source.
- ABI/artifact used by frontend, keeper, and indexer.
- Constructor args and deployment address.
- Bytecode verification evidence against the live address.

Any future integration work, including VRF, must start from committed production source rather than the spec.
