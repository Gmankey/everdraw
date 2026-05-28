# Security

## Audit status

EverDraw V3 has been through an internal security review (2026-05-28) covering the `TicketPrizePoolShmonV3` contract at commit `186f1ad`. The review found **no high or medium-severity vulnerabilities at high confidence**. See the [internal audit report](https://github.com/Gmankey/everdraw/blob/staging/security_audit/AUDIT_REPORT_V3_2026-05-28.md) in the repo for full methodology and findings.

A formal third-party audit is budgeted and planned **before scaling TVL beyond bootstrapping levels**.

**Until a third-party audit is complete, do not deposit more than you are comfortable losing.**

This page updates with each audit milestone.

---

## What has been validated

- V3 contract internal audit complete; no findings at the reporting threshold ([report](https://github.com/Gmankey/everdraw/blob/staging/security_audit/AUDIT_REPORT_V3_2026-05-28.md))
- V3 contract source verified on the Monad explorer; runtime bytecode hash committed to the canonical [deployment manifest](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json) and independently checkable
- 115+ V2 and V3 unit + integration tests passing in CI (Foundry)
- Full V3 lifecycle (deposit → commit → Pyth VRF callback → finalize → claim → withdraw) tested on testnet and verified on mainnet
- Keeper preflight system in production for over six weeks
- shMON integration tested through production deposit and yield flows on V1, V2, and V3
- V3 contract uses the same hardening surface as V2 (non-upgradeable, non-custodial, two-step ownership, two-step fee changes) plus additional V3-specific guards: protocol fee snapshotting per round, Pyth entropy migration timelock, indexed governance events

---

## Contract properties (V3)

**Non-custodial.** The protocol never holds unencumbered user funds. MON deposits become shMON shares immediately on `buyTickets`. Per-user, per-round principal is tracked on-chain. There is no admin function that can move user funds.

**Non-upgradeable.** No proxy. No upgrade key. The deployed contract is the contract. This eliminates upgrade-related attack vectors at the cost of flexibility. New contract versions require a fresh deploy with explicit migration.

**Verifiable randomness.** V3 winner selection uses [Pyth Entropy](https://docs.pyth.network/entropy) — a two-party commit-reveal VRF where the provider commits to a hash chain before the request is made and the contract supplies its own seed. Neither party can bias the outcome. The exact mechanism is documented in [Winner Selection](how-it-works/winner-selection.md). The Pyth dependency is trusted but can be migrated via a 24-hour timelock if needed.

**Bounded admin surface.** The contract owner has 12 distinct admin functions. The maximum protocol fee is capped at 20% in a hardcoded constant. Fee changes are snapshotted into each round at open time and cannot be applied retroactively. Pyth entropy/provider changes require a 24-hour public timelock with a `EntropyChangeQueued` event so any depositor can observe the change in advance and exit if they choose. The owner cannot:
- Access user principal
- Change a round's fee, prize, or winner after that round opens
- Raise the fee above 20% (`MAX_FEE_BPS` is `constant`)
- Instantly swap the randomness provider
- Block `claimPrize` or `withdrawPrincipal` for already-settled rounds (these calls are not pausable)

Full owner-power inventory and the trust model: [ADR-0022](https://github.com/Gmankey/everdraw/blob/staging/decisions/0022-operational-trust-assumptions.md).

**Owner key custody.** Single EOA today, migrating to a 2-of-3 Safe multisig within the first three months of mainnet operation per the published roadmap.

---

## External dependencies

EverDraw inherits trust from three external systems. Each is documented with explicit failure-mode coverage:

| Dependency | Used for | Failure model |
|---|---|---|
| **shMON** (`0x1B68626d...62dE19c`) | Holds all user principal as ERC-4626 shares | [ADR-0023](https://github.com/Gmankey/everdraw/blob/staging/decisions/0023-shmon-dependency-model.md) |
| **Pyth Entropy** (contract `0xD4582618...0ce6F134`, provider `0x52DeaA1c...c616506`) | VRF for winner selection | [ADR-0014](https://github.com/Gmankey/everdraw/blob/staging/decisions/0014-vrf-launch-requirement-pyth-entropy.md), [ADR-0015](https://github.com/Gmankey/everdraw/blob/staging/decisions/0015-vrf-failover-playbook.md) |
| **Monad L1** | Execution + finality | Standard L1 trust |

If you build on top of EverDraw or audit it, **read the relevant ADRs first**. Contract correctness in isolation is not sufficient — the protocol's safety depends on documented assumptions about each of the above.

---

## Verified source

Every active contract is verified on the Monad explorer. Source code, constructor arguments, and compiler settings are public and independently checkable.

| Vault | Explorer link |
|---|---|
| Vault A V3 — `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee` | [Monad explorer](https://monadexplorer.com/address/0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee?tab=contract) |
| Vault A V2 (retiring) — `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` | [Monad explorer](https://monadexplorer.com/address/0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888?tab=contract) |
| Vault B V2 — `0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d` | [Monad explorer](https://monadexplorer.com/address/0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d?tab=contract) |

Runtime bytecode hashes for every active contract live in [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json). Match the hash from `cast code` against the manifest to confirm you are interacting with the audited build.

---

## Operational resilience

The off-chain components of the protocol (keeper, indexer, frontend) are all cloud-hosted with documented failure modes. If any single off-chain service is down, user funds remain safe on-chain; the worst case is a UI or progression delay that recovers when the service is back. Operator disaster recovery is documented in the [recovery runbook](https://github.com/Gmankey/everdraw/blob/staging/tasks/disaster-recovery-runbook.md).

---

## Responsible disclosure

If you find a vulnerability, contact the team privately before public disclosure. Contact details will be added here once the bug bounty program is finalized.
