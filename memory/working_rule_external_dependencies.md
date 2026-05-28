# Working rule: external dependencies are part of every design

**For Claude (and any other agent) working on EverDraw.**
**Established:** 2026-05-28
**Triggered by:** Post-audit review on V3 Vault A launch. Internal audit covered contract correctness but did not explicitly map external-dependency failure modes. Operator (the user) flagged this gap.

---

## The rule

Whenever you design, audit, or extend any part of this protocol, **you must explicitly enumerate the external dependencies that the new component relies on**, and for each one, describe:

1. What we depend on it for (one sentence)
2. The failure modes that matter to us (the ones we'd actually feel the impact of)
3. Whether the contract / off-chain code currently degrades gracefully, freezes, or breaks for each failure mode
4. The recovery path (automated, owner-action, or contract-redeploy)

This applies to:

- **ADRs.** Every new ADR for a feature with external touchpoints (oracles, vault tokens, infra) must include a "dependency surface and failure modes" section.
- **Builder tickets.** Tickets that introduce a new external integration must list the dependency and its failure-mode coverage in the ticket.
- **Audit reports.** Internal audits must include a dedicated section on external-dependency assumptions, separate from the contract correctness section. If a dependency assumption is what makes a finding non-exploitable, that assumption must be named.
- **Disaster recovery runbooks.** When adding a new ops surface, the runbook must explicitly cover what happens when that surface (or its provider) is down.

## Why this exists

The V3 contract audit on 2026-05-28 was rated clean for contract logic but the operator surfaced six concrete external-dependency risks that the audit had not addressed (shMON pause/hack, Pyth deprecation, Monad RPC redundancy, DNS hijack, owner bus-factor, automated alerting). Two of those — shMON pause bricking the fee transfer, and the owner key being unrecoverable on operator death — were genuinely uncovered until the user pushed on them.

The lesson: **a contract audit is necessary but not sufficient.** A contract that's correct in isolation can still fail catastrophically if a dependency fails in a way the design didn't anticipate. Future audits, ADRs, and tickets must explicitly cover that surface.

## What "thorough enumeration" looks like

For every external dependency:

| Dimension | What to capture |
|-----------|-----------------|
| Identity | Specific contract address / domain / vendor |
| Trust assumption | What we assume they do (per ADR-0022 if applicable) |
| Failure modes (relevant) | List the ones we'd feel — don't theoretically enumerate every conceivable break |
| Coverage status | ✅ Mitigated in contract / 🟡 Operationally addressable / 🔴 Gap |
| Recovery path | Automated escape hatch, owner action, or redeploy |
| Out-of-scope items | Cleanly noted as deferred or accepted |

Coverage tags ✅ 🟡 🔴 are encouraged so readers can scan for gaps quickly.

## Concrete examples to follow

- **Good:** ADR-0022 §3 documents the Pyth dependency, names the trust assumption ("trusted provider"), names the mitigation (24h timelock + EntropyChangeQueued event), and names the recovery path (emergencyForceSettle for the unstuck path).
- **Good:** ADR-0023 (shMON dependency model — to be written) is the template for what each external dependency should look like in writing.
- **Bad:** A ticket that adds a new oracle without listing what happens when the oracle returns stale or zero data. **Reject these tickets.**

## How to enforce this on yourself

Before completing a design / audit / ticket, walk through this checklist:

1. List every external contract address this component reads from or writes to.
2. List every off-chain service this component depends on (RPC providers, hosting, DNS, wallets).
3. For each, ask "if this goes offline for a day, what happens to user funds? to user UX? to my ability to respond?"
4. For each non-✅ answer, either fix it in the change, or document it as a tracked gap with an owner and a target date.

If you skipped this checklist, the work is incomplete.

## Related

- ADR-0022 — Operational trust assumptions (the broader trust model)
- ADR-0023 — shMON dependency model (template implementation of this rule)
- `tasks/external-dependency-ops-plan-2026-05-28.md` — the action plan that triggered this rule
- `tasks/disaster-recovery-runbook.md` — operational counterpart
