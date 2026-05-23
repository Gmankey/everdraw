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
