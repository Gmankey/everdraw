# Architecture Decision Records (ADRs)

This folder is the **source of truth for engineering decisions** on EverDraw. If a decision affects the contract, keeper, indexer, or frontend behavior in a way that isn't obvious from the code, it belongs here.

## Why this exists

Sessions with Claude reset. Chat history evaporates. User-facing docs describe what the product does, not why it was built that way or what alternatives were rejected. Without ADRs, the same decisions get re-litigated every session — which wastes time and risks drift between intent and implementation.

## Format

Each ADR is a numbered markdown file: `NNNN-short-slug.md`.

```
# ADR-NNNN — Title

**Status:** Proposed | Accepted | Superseded by ADR-XXXX | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** (e.g. user + Claude PM session)

## Context
What problem are we solving? What constraints apply?

## Decision
The decision, stated plainly.

## Rationale
Why this over the alternatives.

## Alternatives considered
- Option B — rejected because...
- Option C — rejected because...

## Consequences
What this commits us to. What becomes harder. What needs to change downstream (contract, keeper, frontend, docs).

## Open questions
Anything still unconfirmed.
```

## Process

1. **Before any spec-touching builder ticket**, confirm an ADR exists for the decision the ticket implements.
2. **If a ticket changes a decision**, update or supersede the ADR in the same PR.
3. **If the user describes a design intent that isn't captured**, draft the ADR before implementing — and confirm the draft with the user.

## Index

- [ADR-0001 — Two-vault staggered deposit cadence](0001-two-vault-staggered-cadence.md)
- [ADR-0002 — Lock-period semantics and draw timing in shMON-native vaults](0002-lock-period-and-draw-timing.md)
- [ADR-0003 — Migration plan and Vault B deployment](0003-migration-and-vault-b-deployment.md)
- [ADR-0004 — V2 contract behavior: verified facts and scheduling implications](0004-v2-contract-behavior-verified.md)
- [ADR-0005 — UX and operational decisions for the two-vault redeploy](0005-ux-and-ops-decisions.md)
- [ADR-0006 — Merkl-readable position surface on V2 vault](0006-merkl-readable-position-surface.md)
- [ADR-0007 — Defer "Keep Playing" to Phase 2 (TWAB)](0007-defer-keep-playing-to-phase-2.md)
- [ADR-0008 — EverDraw points system design](0008-points-system-design.md)
- [ADR-0009 — Frontend per-pool fetch hygiene](0009-frontend-per-pool-fetch-hygiene.md)
- [ADR-0010 — Cadence invariant for Vault A and Vault B contracts](0010-cadence-invariant-for-vault-a-and-b.md)
- [ADR-0011 — Vault B contract replacement (May 2026)](0011-vault-b-contract-replacement-may-2026.md)
- [ADR-0012 — Reentrancy trust model](0012-reentrancy-trust-model.md)
- [ADR-0013 — Randomness security model](0013-randomness-security-model.md)
- [ADR-0014 — VRF as launch requirement; Pyth Entropy as provider](0014-vrf-launch-requirement-pyth-entropy.md)
- [ADR-0015 — VRF failover playbook](0015-vrf-failover-playbook.md)
- [ADR-0016 — Production V2 source recovery](0016-production-v2-source-recovery.md)
- [ADR-0017 — Production source-control invariant](0017-production-source-control-invariant.md)
- [ADR-0018 — Legacy Vault B quarantine](0018-legacy-vault-b-quarantine.md)
- [ADR-0019 — V3 mainnet migration: replace both V2 vaults with VRF contracts](0019-v3-mainnet-migration.md)
- [ADR-0020 — Protocol fee on prize yield](0020-protocol-fee.md)
- [ADR-0021 — V3 pre-deploy hardening (entropy timelock, per-round metadata, event indexing)](0021-v3-pre-deploy-hardening.md)
- [ADR-0022 — Operational trust assumptions and resilience model](0022-operational-trust-assumptions.md)
- [ADR-0023 — shMON dependency model and graceful-degradation roadmap](0023-shmon-dependency-model.md)
- [ADR-0024 — V4 contract integrated specification](0024-v4-contract-spec.md)
- [ADR-0025 — Multi-winner rounds (V4)](0025-multi-winner-rounds.md)
- [ADR-0026 — Sponsor drop-in cash (V4)](0026-sponsor-drop-in-cash.md)
- [ADR-0027 — Multi-recipient fee router (V4)](0027-multi-recipient-fee-router.md)
- [ADR-0028 — Transfer-failure resilience (V4)](0028-transfer-failure-resilience.md)
- [ADR-0029 — Randomness oracle abstraction (V4)](0029-randomness-oracle-abstraction.md)
- [ADR-0030 — V4 future-proofing inventory](0030-v4-future-proofing-inventory.md)
- [ADR-0031 — V4 EOA ownership for hotfix deploy; multisig deferred to V5](0031-v4-eoa-ownership-hotfix.md)
- [ADR-0032 — V4 mainnet launch record](0032-v4-launch-record.md)
- [ADR-0033 — V4-B cadence defect and re-anchor remediation](0033-v4b-cadence-defect-reanchor.md)
- [ADR-0034 — V5 architecture requirements: flexible yield, decoupled rewards, rebasing (Proposed)](0034-v5-yield-and-reward-architecture.md)
