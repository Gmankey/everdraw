# ADR-0001 — Two-vault staggered deposit cadence

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** User + Claude (PM)

## Context

Each EverDraw vault runs a weekly cycle: 24h Open (deposits) + 6d Lock (yield accrual + draw at end). With a single vault, a user who arrives just after Open closes waits ~7 days for the next chance to deposit. That is too long.

## Decision

Run **two independent vaults (A and B)** on a fixed weekly schedule, offset by ~3.5 days, so the worst-case wait is ~3.5 days.

### Schedule

- **Vault A**: deployed Wed 2026-05-06 12:59:54 UTC. Permanent anchor: **Wed 13:00 UTC weekly**. Address: `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888`.
- **Vault B**: deployed Sun 2026-05-10 13:42:19 UTC after PM-approved late launch. Permanent anchor: **Sun 13:42 UTC weekly**. Address: `0x1B20BAa2D3992834E1E75cf75e3cD7b6AAA38096`.
- Each cycle is exactly 7 days. Schedule is calendar-anchored (no drift) per ADR-0004.
- Worst-case deposit wait under this stagger: **2.5 days** (the 3.5-day open-to-open offset minus the 24h Open window). Better than the 3.5-day target.

### TVL is per-vault, not shared

Each vault's depositors are isolated. Vault B does **not** dilute Vault A's prize. A new vault simply gives users who missed Vault A's window an alternate place to deposit fresh capital. No cross-vault hopping mid-cycle.

### Worst-case wait

User arrives 1 minute after Vault A locks (Sun 00:01 UTC) → next deposit window is Vault B opening Wednesday 00:00 UTC = ~3 days wait. Symmetric the other way = ~4 days wait. Maximum ~3.5 days.

## Rationale

- The 6-day Lock is the prize-generation mechanism (yield accrual on the deposited shMON). It is not protocol-imposed — it's a product choice. See ADR-0002.
- Fixed weekly anchor self-heals skipped rounds: if a round skips, the next one still opens at the same calendar slot.
- Two vaults is the minimum needed to halve the worst-case deposit wait. More vaults would shorten further but multiply ops/contract surface.

## Alternatives considered

- **Single vault**: rejected — 7-day worst-case wait is the problem.
- **N vaults staggered 1 day apart**: rejected for Phase 1 — multiplies ops/keeper/indexer surface; reconsider later if user demand justifies.
- **Floating cycle (e.g. always 7 days from previous settle, no fixed weekday)**: rejected — drift accumulates, harder to communicate, doesn't self-heal skips.
- **Cross-vault hopping** (release Vault A principal early to deposit into Vault B): rejected — breaks the round abstraction and yield-accrual integrity.

## Consequences

### Contract / deployment
- Vault A: `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a` (existing).
- Vault B: `0x1B20BAa2D3992834E1E75cf75e3cD7b6AAA38096`. Deployed with same bytecode/config cadence as fresh Vault A, except its late-approved anchor is Sun 13:42 UTC.
- No contract logic change needed for the fixed-day schedule — round opening is keeper-triggered, so the keeper enforces the calendar.

### Keeper
- `POOL_ADDRESSES_V2` includes both addresses.
- Per-pool config: `VAULT_A_OPEN_DAY=Saturday@00:00UTC`, `VAULT_B_OPEN_DAY=Wednesday@00:00UTC`.
- Settle previous round + open next round are executed atomically in one keeper tx at the target weekday/time.
- Drift policy: small drift (minutes/hours) is acceptable. If keeper misses by more than ~1 day, **skip that week's cycle for that vault** — wait for the following week's slot. Do not catch up by opening a partial-week round.

### Frontend
- Already multi-pool. UI renders both vaults as independent tiles with their own state.
- Surface the schedule to users: "Next deposit window: Wednesday 00:00 UTC" per vault.

### Indexer
- Already multi-pool. No changes expected.

### User-facing docs
- `docs/how-it-works/round-lifecycle.md` line 72 currently says "at any given time, at least one vault is in State 1 (Open)." This is **incorrect** under this ADR. Replace with: "Two vaults run on offset weekly schedules — Vault A opens Saturdays, Vault B opens Wednesdays — so you wait at most ~3.5 days for the next deposit window."

## Open questions

None. All resolved.

## Related ADRs

- ADR-0002 — Lock-period semantics and draw timing in shMON-native vaults
- ADR-0003 — Migration plan for current Vault A and Vault B deployment
