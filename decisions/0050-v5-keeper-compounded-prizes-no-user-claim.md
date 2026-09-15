# ADR-0050: V5 prizes are keeper-compounded, with no user claim action

**Status:** Accepted by the operator, 2026-09-15.
**Amends:** ADR-0043 frontend/fallback wording. **Related:** ADR-0045, ADR-0048.

## Context

ADR-0043 requires a transaction to consume each finalized Merkle leaf and move escrowed shMON shares into a fresh winner vault tranche. A blockchain cannot perform that transaction on a timer by itself. The managed keeper pays gas and calls `ClaimManagerV5.claimMany`; successful claims invoke the configured vault compound path. To the winner this is automatic: they do not claim, choose a destination, or withdraw a prize.

A stale frontend requirement exposed the same permissionless `claimMany` as a clickable WINNER action. That conflicts with the approved product: no compound opt-out, no upfront win banner, and no prize-only claim/withdrawal. History is the discovery surface. The contract function remains necessary for keeper execution and permissionless liveness, but it is not a user workflow.

## Decision

- The managed keeper is the normal claimant and automatically compounds every eligible prize into a new tenure-0 vault tranche.
- My History renders the existing prominent WINNER result and prize amount as information only. It is not a button and initiates no transaction.
- The V5 frontend contains no `claimMany` transaction builder or user-facing “Claim prize” action. Principal withdrawal remains the only user exit surface.
- Remove the temporary single-draw UAT browser-claim hold. A browser-originated claim is not launch acceptance because it tests a deliberately absent feature.
- Correct acceptance evidence is a paying draw followed by keeper `claimMany`, successful `PrizeCompounded`, the same-transaction vault Deposit credit, and refreshed History/position data.

## Failure behavior and external dependencies

- **Keeper/Fly unavailable:** prize shares remain escrowed and unclaimed. Managed restart, dead-man monitoring and retry restore automatic processing. The winner's principal is unaffected.
- **Terminal proof/config error:** existing quarantine and one-time alerting prevent a retry storm; operator remediation is required. No UI bypasses proof verification.
- **Transient RPC/Pyth/indexer outage:** keeper retries; escrow remains fixed and drift-free. Indexer failure can delay History display but cannot change custody or claim state.
- **Compound vault failure:** ClaimManager's audited never-brick path governs payout behavior. The frontend must not invent a second settlement path.
- **Permissionless contract call:** another party can submit a valid proof before the keeper. The leaf can be consumed only once and credits/pays the leaf account under contract rules; the caller cannot redirect it. This is protocol liveness, not a promoted user feature.
- **shMON:** payout and compounding remain share-denominated under ADR-0045; no synchronous MON redemption.

## Acceptance

Tests prevent the WINNER result from becoming clickable and prevent browser claim code from returning. Live UAT must show informational WINNER history and independently prove keeper claim → PrizeCompounded → vault credit. No contract redeploy is required.