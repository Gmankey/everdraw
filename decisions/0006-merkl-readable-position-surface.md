# ADR-0006 — Merkl-readable position surface on V2 vault

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** User + Claude (PM) + Builder

## Context

shMonad runs an ecosystem points program via Merkl. We want users who deposit into EverDraw to also earn shMonad points for that activity, without building a custom integration on either side. Merkl's generic vault integrator can do this if our contract exposes the right surface.

Merkl confirmed their indexer model: **they consume `Deposit` / `Withdraw` events and compute time-weighted balances off-chain.** They do not poll `balanceOf`. This means we do not need to add TWAB checkpointing or historical balance storage on-chain — a simple event surface plus current-balance views is sufficient.

## Decision

Add a **read-only, non-transferable** ERC-20-style accounting surface to `TicketPrizePoolShmonV2`:

### Metadata views
- `name()` = `"EverDraw shMON Position"`
- `symbol()` = `"EVRDRAW-SHMON"`
- `decimals()` = `18`

### Accounting views
- `balanceOf(address user)` = user's currently active EverDraw principal across all open and locked rounds, denominated in MON-wei (1 ticket at 1 MON = 1e18)
- `totalSupply()` = sum of all `balanceOf` values (total active EverDraw principal)

### Events
- `event Deposit(address indexed recipient, uint256 amount)` — emitted on every `buyTicketsMON` and `buyTicketsShmon` call, with `amount` = the MON-principal value of the purchase
- `event Withdraw(address indexed recipient, uint256 amount)` — emitted on every `withdrawPrincipal` call, with `amount` = the user's original MON-principal for that round

### Explicitly NOT added
- `transfer`, `transferFrom`, `approve`, `allowance` — these positions are non-transferable. Calls to these (if integrators try them) will simply not exist on the contract.
- TWAB checkpoints, historical balance storage, snapshot mechanisms — Merkl computes these off-chain.

### Code-level clarity
Contract source must include a comment block at the start of the Merkl section stating:

> ERC-20-readable position accounting for Merkl indexing.
> NOT a transferable token. No transfer/approve methods exist by design.

### Param naming note

Merkl's published spec names the first event param `recipient`. Solidity event topic hashes are derived from `(eventName, paramTypes)` only — param names are not part of the on-chain signature, so naming has no functional impact on indexing. Use `recipient` in the source code anyway to match Merkl's docs verbatim and remove any future confusion. Merkl's `totalSharesFunctionSignature` and `userSharesFunctionSignature` are satisfied by `totalSupply()` and `balanceOf(address)` — they call them "shares" by convention; our `balanceOf` returns MON-principal and that is fine because deposits/withdrawals net consistently to the current balance.

## Why MON-principal as the balance basis

Merkl asked "how much a user has staked." Three options:
- shMON shares (rejected — volatile due to share-rate drift, makes points basis fluctuate)
- Ticket count (rejected — abstract, doesn't map to MON value)
- **MON-principal** (accepted — stable, matches user's deposited value, intuitive)

A user buying 5 tickets at 1 MON each sees `balanceOf` increase by 5e18, regardless of shMON share rate at deposit time. On withdrawal, balance returns to its prior value exactly.

## Cross-vault behavior

With two pool contracts (Vault A and Vault B per ADR-0001), each contract has its own independent `balanceOf` and event stream. Merkl integration must register both pool addresses. A user depositing into both vaults has separate balances on each contract, summed off-chain by Merkl's indexer.

## Phase 1 / Phase 2 forward compatibility

If Phase 2 introduces TWAB-style continuous deposits, this surface remains compatible as long as:
- `Deposit` continues to be emitted on stake increases
- `Withdraw` continues to be emitted on stake decreases
- `balanceOf` continues to reflect current active stake

The contract surface will not need to change for Merkl when Phase 2 ships. This is a deliberate forward-compat decision.

## Coordination with EverDraw's own points program

EverDraw has its own points program (`tasks/points-program-plan.md` / `memory/project_everdraw_points.md`), separately tracked off-chain. The two programs run **independently and stack**:

- A user depositing 1 MON for 1 round earns:
  - EverDraw points (1 point per MON-round) via our off-chain points pipeline
  - shMonad points via Merkl indexing the same `Deposit`/`Withdraw` events

There is no double-counting concern because the budgets and reward pools are independent. Marketing should explicitly highlight this as a "double points" benefit when both programs are live.

## Consequences

### Contract
- Storage cost: one mapping (`balanceOf`) and one uint256 (`totalSupply`). Negligible.
- Gas cost per buy: +1 SSTORE on `balanceOf[user]`, +1 SSTORE on `totalSupply`, +1 LOG. Roughly +30k gas per buy. Acceptable.
- Symmetric on withdraw.
- No changes to lottery mechanics, share accounting, prize math, or round lifecycle.

### Test coverage
Builder confirmed tests added covering: symbol/name/decimals reads, balanceOf zero start, Deposit emit on buy, balanceOf increase, totalSupply increase, Withdraw emit on principal withdrawal, balanceOf return to zero, existing round accounting intact. V2 critical: 15 passing. V2 full+critical: 92 passing.

### Deployment
- Bundled into the two-vault staggered redeploy (same fresh contracts as ADR-0003). No separate deploy needed.
- Both Vault A and Vault B addresses must be registered with Merkl before user deposits can earn shMonad points.

### Marketing / docs
- User-facing copy can advertise "Earn EverDraw points + shMonad points on every deposit" once both pipelines are live.
- `docs/getting-started/buying-tickets.md` should mention shMonad points alongside the EverDraw mechanic.

## Open questions

None.

## Related ADRs

- ADR-0001 — Two-vault staggered cadence (Merkl registration applies to both vaults)
- ADR-0003 — Migration plan (Merkl surface bundled into the redeploy)
