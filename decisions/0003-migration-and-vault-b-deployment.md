# ADR-0003 — Migration of current Vault A and Vault B deployment

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** User + Claude (PM)

## Context

ADR-0001 commits us to a fixed weekly schedule (Vault A opens Saturday, Vault B opens Wednesday — both 00:00 UTC, both flexible day-of-week as long as fixed weekly). The current deployed Vault A (`0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a`) is mid-cycle on a non-anchored schedule. Vault B does not exist yet.

The only depositor in current Vault A is the user themselves, testing. No external user funds are at risk.

## Decision

### Migration steps (in order)

1. **Let the current Vault A round finish on its existing schedule.** It is mid-lock right now (~6d 2h remaining). The keeper settles it whenever its lock ends, as currently configured.
2. **After settle, the user withdraws their principal** from current Vault A.
3. **Pause / disable current Vault A** by removing it from `POOL_ADDRESSES_V2` (keeper) and `VITE_POOL_ADDRESSES_V2` (frontend). The contract stays on-chain (immutable) but receives no new keeper actions and is not displayed to users.
4. **Deploy fresh Vault A** with the fixed-schedule keeper config. First round opens on the next chosen weekday at 00:00 UTC.
5. **Deploy fresh Vault B** with same bytecode. First round opens on the offset weekday (3.5 days after Vault A's open day) at 00:00 UTC. Vault B's first round waits for its natural slot — does not open immediately on deployment.
6. **Update keeper, frontend, indexer config** with both new pool addresses.
7. **Update user-facing docs** per ADR-0001 and ADR-0002 consequences sections.

### Why fresh deploys

- Current Vault A's history is one round of testing-only deposits. Nothing of value to preserve.
- A fresh deploy lets us pick clean round IDs starting from 1, aligned with the new schedule.
- Avoids any risk of state collision between old non-anchored rounds and new anchored ones.
- Contract bytecode is unchanged — fresh deploys are just new addresses.

### Day-of-week selection

User has stated the specific weekday is flexible. **Default: Vault A on Saturday, Vault B on Wednesday, both 00:00 UTC.** User can override at deploy time. This default goes into ADR-0001 unless overridden.

## Rationale

- Migration is trivial because there are no real users to migrate. Don't over-engineer.
- Fresh contracts give clean state and let us bake in any V2 contract refinements that come from current bug-fix work without legacy compatibility concerns.
- Keeping the old contract on-chain (just unconfigured) means the user can still recover their deposit via a direct contract call if anything ever goes wrong with the withdrawal step.

## Alternatives considered

- **Reuse current Vault A as the new fixed-schedule Vault A**: rejected. Round numbering would be inconsistent (round 38 onwards on a different cadence than 1–37). Confuses indexer history and frontend "previous round" rendering.
- **Force-end the current round early** (don't wait the remaining ~6d): rejected. No benefit — it costs a day or two of user inconvenience but saves nothing meaningful. Cleaner to let it finish.
- **Keep current Vault A and just add Vault B**: rejected. Doesn't fix the non-anchored schedule on Vault A.

## Consequences

- Builder ticket needed: deploy two new V2 contracts, update env files, update keeper service, redeploy frontend, redeploy indexer.
- Old contract address stays in code-history references but should be removed from active config.
- Brief downtime (~the time between current Vault A settling and new Vault A's first scheduled open). Could be a few hours up to a few days depending on when current settle lands relative to the chosen weekday. Acceptable since there are no external users.

## Open questions

1. **Final day-of-week choice.** Default is Saturday (Vault A) / Wednesday (Vault B). User confirms or overrides before deploy.
2. **Should the new V2 contracts also include any pending bug fixes** (e.g. the `buyTicketsShmon` over-approval issue surfaced earlier this session)? The builder ticket should bundle outstanding V2 fixes into the redeploy rather than redeploy twice. PM to confirm scope before issuing the ticket.

## Related ADRs

- ADR-0001 — Two-vault staggered deposit cadence
- ADR-0002 — Lock-period semantics and draw timing
