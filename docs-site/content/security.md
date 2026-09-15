# Security

## Audit status

EverDraw V5 has undergone an external project audit followed by multiple remediation and focused-retest passes. The repository records findings, fixes, test evidence, UAT evidence, and remaining release decisions under tasks/ and security_audit/.

This work is not represented as a completed formal third-party audit. The beta interface states that formal third-party review is still pending. Smart-contract and third-party risk cannot be eliminated, so do not deposit more than you are comfortable risking.

---

## V5 safety model

**Principal and prize accounting are separate.** Participant and Patron principal are tracked independently from prize yield. Normal withdrawals return shMON shares representing the requested principal value. Shortfall handling, rounding, and external shMON behavior are covered by contract and fork tests.

**Continuous positions.** Deposits and withdrawals are available throughout a draw period. TWAB records time-weighted participation; a draw result does not reduce a losing participant's principal.

**Fixed prize escrow.** At draw start, the prize is moved as a fixed shMON share amount into ClaimManager before a root can be proposed. Later shMON exchange-rate movement cannot change that finalized payout amount.

**Challengeable roots.** Pyth Entropy supplies randomness. The keeper computes a deterministic winner root, an independent watcher recomputes it, and a challenge window permits the guardian to veto a mismatch before finalization.

**Automatic prize compounding.** The managed keeper submits finalized winner proofs. Normal winner payouts are compounded into fresh tenure-zero main-vault tranches. Permissionless claim functions are protocol-level liveness mechanisms, not a browser claim workflow.

**Non-upgradeable deployments.** V5 uses fresh non-proxy contracts. Replacing a vault or manager requires a new deployment and explicit configuration changes. Sensitive manager, strategy, oracle, timing, and role changes use the contract's documented controls and delays.

---

## External dependencies

| Dependency | Role | Failure effect |
|---|---|---|
| shMON / ShMonad | Strategy shares, principal exits, prize yield | Exchange-rate, contract, liquidity, and delayed MON unstaking risk |
| Pyth Entropy | Draw randomness | Draw progression pauses until randomness or configured recovery |
| Monad | Execution and finality | Transactions and indexing can be delayed during chain or RPC disruption |
| Managed keeper | Starts, proposes, finalizes, and submits prize proofs | Draws or prize compounding pause; escrow and principal remain on-chain |
| Independent watcher | Recomputes proposed roots and alerts on mismatch | A coverage gap weakens detection and is operationally alerted |
| Indexer | History, points, tranches, and frontend-derived views | UI data can lag; it does not control contract custody |
| Frontend, wallet connector, RPC, DNS | User access and transaction construction | Users may need verified direct-contract access during an outage |
| Owner, guardian, pauser, keeper keys | Governance, veto, emergency controls, automation | Compromise impact follows each role's bounded on-chain permissions |

The deploy and operations runbooks contain the exact monitoring, signer, bytecode, and dependency checks required for launch.

---

## Verified source and addresses

Use the canonical deployment manifests in the repository:

- deployments/monad-mainnet.json for mainnet
- deployments/monad-testnet.json for UAT history

Do not use addresses copied from screenshots, old vaults, or previous UAT stacks. Match deployed runtime bytecode and constructor arguments to the reviewed artifacts before enabling deposits.

---

## Operational resilience

The managed keeper and independent watcher have separate health signals and alert paths. The indexer uses finalized-chain ingestion, deployment scoping, reorg handling, persistent storage, and health reporting. Runbooks cover restarts, balance floors, root veto, data correction, and fresh-stack cutover.

Operational monitoring reduces detection and recovery time; it does not replace contract safety or independent review.

---

## Responsible disclosure

Report suspected vulnerabilities privately to the project operator before public disclosure.
