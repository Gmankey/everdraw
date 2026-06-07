# Security

## Audit status

The current `TicketPrizePoolV4` contract has been through internal security review combining a structured manual methodology (map → hunt → attack → verify, with skeptic-judge conflict resolution) and automated static analysis (Slither). The review found **no critical, high, or medium-severity vulnerabilities at high confidence**; the only items raised were low-severity, defense-in-depth improvements, and the automated pass independently corroborated the manual findings.

→ **Latest report: [V4 internal audit (`AUDIT_REPORT_V4_2026-06-05.md`)](https://github.com/Gmankey/everdraw/blob/staging/security_audit/AUDIT_REPORT_V4_2026-06-05.md).** All audit reports live in the [`security_audit/`](https://github.com/Gmankey/everdraw/tree/staging/security_audit) directory.

A formal third-party audit is planned **before scaling TVL beyond bootstrapping levels.**

**Until a third-party audit is complete, do not deposit more than you are comfortable losing.** This page updates with each audit milestone.

---

## Contract properties

**No loss, enforced on-chain.** Principal and prize are tracked as separate state. Every non-winning ticket redeems for its full deposit value. There is no privileged function that can move depositor principal.

**Non-custodial.** The protocol never holds unencumbered user funds. MON deposits become shMON shares immediately on deposit, and per-user, per-round principal is tracked on-chain.

**Non-upgradeable.** No proxy, no upgrade key — the deployed contract is the contract. This removes upgrade-related attack vectors. New versions require a fresh, separately-deployed contract.

**Verifiable randomness.** Winner selection uses [Pyth Entropy](https://docs.pyth.network/entropy) — a two-party commit-reveal where the provider commits to a value before the request and the contract supplies its own seed. Neither party can bias the outcome, and any change to the entropy provider is gated behind a public time-delay so depositors can observe it in advance. If randomness ever fails to arrive, a round can be force-settled with full principal returned — no round can be permanently stuck. See [Winner Selection](how-it-works/winner-selection.md).

**Bounded admin surface.** The owner's powers are limited and cannot reach user funds. In particular, the owner cannot:

- Access or move user principal
- Change a round's fee, prize, or winners after that round has opened
- Raise the protocol fee above its hardcoded cap (20%)
- Instantly swap the randomness provider (changes are time-delayed)
- Block claims or withdrawals on already-settled rounds (those calls are not pausable)

Fees are snapshotted per round at open time and never apply retroactively. A separate **pauser** role can temporarily halt new deposits without any power over claims or withdrawals.

**Resilient payouts.** Every payout is wrapped so a single failing transfer can never freeze settlement. If a payout can't complete (for example, the underlying yield token is briefly unavailable), it's recorded as a retriable pending claim and is never lost.

The full owner-power inventory and trust model are documented in the project's Architecture Decision Records ([`decisions/`](https://github.com/Gmankey/everdraw/tree/staging/decisions)).

**Owner key custody.** The owner is a hardware-backed account today, with a documented plan to migrate to a multisig. Custody status is tracked in the repo.

---

## External dependencies

EverDraw inherits trust from several external systems. Each is documented with explicit failure-mode coverage in the project's ADRs and dependency audit:

| Dependency | Used for | Failure model |
|---|---|---|
| **shMON** | Holds all user principal as ERC-4626 shares and generates the prize yield | Documented in the shMON dependency ADR |
| **Pyth Entropy** | Verifiable randomness for winner selection | Documented in the randomness ADRs; provider migratable via time-delay |
| **Monad L1** | Execution and finality | Standard L1 trust |
| **Keeper / indexer** | Round progression and history API | If down, funds stay safe on-chain; worst case is a progression or UI delay |
| **Frontend / DNS** | Public app and docs | If down, contracts remain usable directly; current addresses live in the deployment manifest |
| **Owner / keeper keys** | Admin functions and automated progression | Documented trust model |

If you build on or audit EverDraw, **read the relevant ADRs first** — contract correctness in isolation is not sufficient; the protocol's safety depends on the documented assumptions about each dependency above.

---

## Verified source and current addresses

Every active contract is verified on the Monad explorer — source, constructor arguments, and compiler settings are public and independently checkable. Because contract addresses change across protocol generations, the **canonical, always-current list of deployed addresses** (with runtime bytecode hashes) lives in the deployment manifest: [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json).

To confirm you're interacting with the audited build, match the bytecode hash from `cast code <address>` against the hash recorded in that manifest.

---

## Operational resilience

The off-chain components (keeper, indexer, frontend) are cloud-hosted with documented failure modes. If any single off-chain service is down, user funds remain safe on-chain; the worst case is a UI or progression delay that recovers when the service returns. Operator disaster recovery is documented in the repo's recovery runbook.

---

## Responsible disclosure

If you find a vulnerability, contact the team privately before public disclosure. Contact details will be added here once the bug bounty program is finalized.
