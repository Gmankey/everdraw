# ADR-0005 — UX and operational decisions for the two-vault redeploy

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** User + Claude (PM)

## Context

ADR-0001 through ADR-0004 cover cadence, lock semantics, migration, and verified contract behavior. This ADR captures the remaining UX and operational decisions needed before the builder ticket can be written.

## Decisions

### A. Auto-rollover for principal — NOT in Phase 1

We accept the retention leak from forgetful users missing alternate rounds. Auto-rollover deferred to Phase 2.

**New requirement on indexer:** track time-to-withdraw for each settled round. Specifically, for each user's deposit:
- `settled_at` = block timestamp of the round's settle tx
- `withdrawn_at` = block timestamp of the user's first `withdrawPrincipal` call for that round
- Delta surfaced via API as a per-user and aggregate metric (median, p90, p99) across rounds and across vaults.

This delta tells us in Phase 2 design how badly users actually leak — long deltas mean they forget; short deltas mean they actively redeploy and we may not need auto-rollover at all.

### B. Two-vault user mental model — "two draw schedules"

The framing to users is simply: "EverDraw has two deposit windows per week." No branding distinction between Vault A and Vault B beyond their open day. Marketing copy:

- "Deposit windows open every [Vault A day] and [Vault B day]"
- Each vault is structurally identical — same ticket price, same lock duration, same prize mechanic
- Users don't "choose between" vaults; they pick whichever window is most convenient for their deposit timing

### C. UX during the 6-day Lock — countdown only

Header during Lock state: **"Yield accruing"** with a countdown to the draw moment. No live yield estimate, no leaderboard, no participant tiles in Phase 1. This is what's already designed/built in the frontend; preserve it.

(Live yield, leaderboard, social tiles deferred to a future "richer dashboard" phase, not now.)

### D. Unclaimed prize/principal window — INDEFINITE for Phase 1

Winners and depositors can claim/withdraw at any time, no expiry, no rollback to pool. This matches current contract behavior — no contract change.

**Phase 2 must revisit this.** Add to Phase 2 design checklist: "decide unclaimed-funds policy."

### E. Vault open day-of-week and time — pragmatic

Whatever date and UTC time we deploy mainnet, that becomes Vault A's anchor. Vault B opens 3.5 days after Vault A's first round opens. Both vaults stay anchored to that day-of-week and time forever (drift-free per ADR-0004's keeper logic).

No advance scheduling — anchor to deploy time.

### F. Testnet rehearsal — SKIPPED

Going straight to mainnet. Justified because:
- Only depositor on current Vault A is the user (testing).
- Contract logic (settle, commit, openNextRound, Skipped, Failed) is already battle-tested on current Vault A through Round 38.
- Only deltas in the new deploy are: (i) `yieldPeriodSec = 518100` instead of 604800, (ii) keeper-side scheduling gate. Neither is contract-logic-novel.

### H. Keeper-side scheduling vs contract change — keeper-side, accept anchor drift

For Phase 1, scheduling gates live entirely in the keeper. The contract is unchanged. Approach:

- Set `yieldPeriodSec = 518100` (6 days minus 5 minutes) so `commit()` becomes eligible 5 minutes before the target weekday/time.
- Keeper actively waits until the exact target weekday/time wall-clock before firing `commit()`.
- New `salesEndTime` is set as `block.timestamp_at_commit + roundDurationSec`, which lands within block-inclusion variance (~1–3 seconds) of the target.
- Per-cycle drift is bounded, not cumulative, as long as keeper fires within the 5-minute buffer.

**Accepted failure mode:** if the keeper is offline for more than ~5 minutes spanning the target moment, `commit()` fires at recovery time and the weekly anchor permanently shifts to that recovery weekday/time. Manual re-sync procedure (pause + skip + reopen at correct weekday) is documented in the runbook.

Justification:
- Phase 1 has effectively zero users; a one-off anchor shift is recoverable.
- Keeper-side gating avoids new contract surface (audit, testing, redeploy if buggy).
- User has explicitly accepted this trade-off.

**Phase 2 must revisit** if user count or anchor-stability matters more.

### G. Outstanding V2 bug fixes to bundle — UPDATED after builder review

Inventoried the bugs flagged during the prior session against current `web/src/App.jsx`:
- Timer seconds counter: fixed (line 146-150 includes `s`)
- `buyTicketsShmon` over-approval: fixed (uses `previewWithdraw(cost) + 1`, line 1947/1956)
- `window.open` blank-tab on redirect: fixed (uses `noopener` not `noreferrer`, line 1867)
- Redemption modal copy + KEEP PLAYING: restored (line 284, 296)
- Vault B `salesOpen` gating: shipped in prior deploy

Builder ticket scope is purely: new contract deploys + keeper schedule logic + env config + indexer withdrawal-tracking metric. No frontend bug-fix bundle required.

## Consequences

- ADR-0001's "default Saturday/Wednesday" is updated to "anchor to deploy time."
- Indexer gets a new requirement: per-round withdrawal-latency tracking, surfaced via API.
- Phase 2 planning must include: (i) auto-rollover decision, (ii) unclaimed-funds policy.
- No frontend bundling reduces scope/risk of the redeploy.

## Open questions

None remaining for Phase 1 cadence. Ready for builder ticket.
