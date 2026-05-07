# ADR-0002 — Lock-period semantics and draw timing in shMON-native vaults

**Status:** Accepted
**Date:** 2026-05-03
**Deciders:** User + Claude (PM)

## Context

V2 vaults (TicketPrizePoolShmonV2) hold shMON shares directly, not raw MON. This is a fundamental change from V1: the contract no longer needs to unstake MON during a "Finalizing" period, because shMON is itself the asset and yield accrues automatically as the share-rate moves.

This means the V1 round lifecycle (Open → Committed → Finalizing 7d → Settled) no longer maps to a protocol constraint. The 6-day Lock period in V2 is a **product choice**, and we need to define what it actually does and when the draw happens.

## Decision

### Round lifecycle (V2)

```
Sat 00:00 UTC       Sun 00:00 UTC                              next Sat 00:00 UTC
     │                    │                                            │
     │   24h Open         │              6d Lock (yield accrual)       │   ← Settle + reopen
     │ ──────────────────▶│ ──────────────────────────────────────────▶│
     │                    │                                            │
     ▼                    ▼                                            ▼
 deposits              deposits         shMON share-rate grows;     draw winner
  open                 close;            principal locked;          using committed
                       commit            no user activity            block hash;
                       target                                        prize = yield
                       block                                         (delta in shMON
                                                                     share value);
                                                                     new round opens
```

### Lock period purpose

The 6-day Lock exists **to accumulate yield**. The vault's shMON balance grows in value as Monad's staking yield accrues over those 6 days. The yield delta = the prize. Without the lock there is no prize.

This is the only purpose. The lock is not for unstaking (no unstake happens), not for randomness windowing, not for keeper convenience.

### Draw timing

- **Commit** happens at the end of the Open window (Sun 00:00 UTC). The contract records a target future block (current block + N, where N gives ~6 days of cushion).
- **Reveal/draw** happens at the next round-transition moment (Sat 00:00 UTC). At that point the target block is in the past; its blockhash is the randomness source. Winner is selected, prize is computed (= shMON share-value delta over the lock period × winner's share of tickets).
- **Settle** is the same transaction as the new round's open. One keeper tx executes both: settle previous round (draw + finalize prize accounting) + open new round (begin accepting deposits for next cycle).

### What users see

- During Open: "Deposit window — buy tickets here. 18h remaining."
- During Lock: "Vault locked, accruing yield. Winner drawn in 4d 12h. Prize so far: X shMON yield."
- At settle moment: "Previous round settled. Winner: 0x... — prize: X shMON. New deposit window now open."
- The "previous vault" view shows the just-settled round with claim/withdraw actions. It stays accessible until claims are exhausted (no time limit on claiming).

### Backend may differ from UX

The user has been explicit: regardless of contract internals, the user-visible flow is "deposit 24h → lock & accrue → draw at end → repeat." If the contract emits intermediate events (Committed, etc.), the frontend collapses those into the user-facing two-state view (Open / Locked).

## Rationale

- Yield accrual time = prize size. The lock duration is a product lever, not a constraint.
- 6 days × ~5% APY shMON × TVL = a meaningful prize. Shorter locks (e.g. 1 day) would produce negligible prizes; longer locks (e.g. 30 days) would mean too few rounds and stale UX.
- 6-day lock + 1-day open = 7-day weekly cycle, which fits the fixed-weekday schedule from ADR-0001.
- Atomic settle + reopen at the same moment matches user intuition ("the moment one round ends, the next begins") and avoids dead-time gaps.

## Alternatives considered

- **Draw at end of Open window** (i.e. lock period is just a claim/principal-freeze, not a draw delay): rejected. Yield accrued during the lock would have to go somewhere — either to the winner (which means the winner is drawn before the prize is fully formed, weird) or to nobody (wasted). Drawing at end of lock is cleaner.
- **Draw mid-lock**: rejected. No benefit, adds complexity.
- **Variable lock based on TVL** (longer lock if TVL is small to grow prize): rejected. Breaks fixed-schedule contract.
- **Continuous TWAB-style accrual without rounds**: that's Phase 2 (`docs/vision/phase-2.md`). Out of scope for this ADR.

## Consequences

### Contract
- The existing V2 contract's commit/reveal mechanism is reused. No semantic change at the contract level — the contract has always supported "draw at lock end." The clarification here is that V2 has no internal unstake during lock, so lock duration is freely configurable.
- Round duration constants (Open=24h, Lock=6d) need to be set/verified. If currently different in deployed Vault A, that's a deployment config choice not a code change. See ADR-0003.

### Keeper
- One keeper tx per vault per week, at the scheduled weekday/time. This tx settles the previous round (using the target block's hash) and opens the next round.
- Keeper must verify the target block has been mined before attempting to settle. With a 6-day lock and Monad's blocktime, this is trivially satisfied.

### Frontend
- Display two states to users: Open (deposit) and Locked (accruing). Internal Committed state is collapsed into Locked.
- Show running prize estimate during lock based on current shMON share rate vs share rate at lock-start.

### Docs
- `docs/how-it-works/round-lifecycle.md` should be rewritten for V2: drop the "Finalizing 7d for unstaking" framing and replace with "Locked 6d for yield accrual."
- `docs/faq.md:21` — the "Why does withdrawal take 7 days?" answer is V1-specific and incorrect for V2. Withdrawal of shMON shares is immediate after settle. Only converting shMON → raw MON requires the 7-day Monad unstake queue, and that's outside the EverDraw contract.

## Open questions

None.

## Related ADRs

- ADR-0001 — Two-vault staggered deposit cadence
- ADR-0003 — Migration plan
