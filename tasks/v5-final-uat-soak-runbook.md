# V5 final-bytecode UAT soak runbook

**Decisions:** ADR-0036, ADR-0037, ADR-0042, ADR-0043, ADR-0045.

This is the launch-gating soak for the final V5 bytecode. The clock starts only after the fresh
six-hour UAT stack is activated, every service is pointed at it, monitoring is live, and the
keeper has enough MON for the full window plus margin. Any code change, watcher coverage gap,
unresolved alert, manual lifecycle transaction, or funding halt resets the clock.

## Acceptance window

- Duration: seven uninterrupted days.
- Cadence: six hours (`drawPeriod = 21,600`), aligned to the one-hour TWAB grid.
- Expected periods: 28.
- Required completed paying draws: at least 24.
- Keeper funding: fund once for the projected seven-day oracle and gas cost plus at least 50%
  margin. Record the opening balance and calculation in the evidence file.

## Preconditions

1. The cadence-governance PR is merged and included in the deployed DrawManager bytecode.
2. The fresh UAT stack is fully wired after the vault's 24-hour DrawManager timelock.
3. Keeper, indexer, frontend, and independent root watcher all target that exact stack.
4. `KEEPER_HEALTHCHECK_URL` is enabled.
5. The independent root watcher schedule, cache, Telegram delivery, and healthcheck are green.
6. Participant and Patron deposits are present, and the strategy has enough test yield to produce
   at least 24 paying draws.

## Required observations

- Every period is consecutive, with no schedule gap, overlap, or drift.
- At least 24 draws complete start, seed, propose, finalize, and claim without manual lifecycle
  transactions.
- The independent watcher runs continuously and matches every proposed root. Any blind spot
  invalidates the window.
- The keeper remains managed and unattended. Force one Fly machine restart and verify automatic
  recovery from the persistent cache.
- Prove the dead-man switch: stop the keeper long enough for the healthcheck to go red and deliver
  the operator alert, then restart it and verify recovery to green. Record both timestamps.
- Indexer lag remains healthy and every lifecycle event is ingested.
- Participant MON and shMON deposits both work.
- A partial withdrawal consumes newest tranches first while surviving tenure and streak remain.
- An exact full withdrawal leaves zero participant principal and resets the participant streak.
- A Patron deposit contributes yield, receives zero entries, and can be withdrawn in shMON.
- At least one winning prize auto-compounds into a fresh tenure-zero tranche.
- Withdrawing that prize tranche works without withdrawing the user's pre-existing principal.
- The frontend remains usable throughout and never incorrectly reports a healthy advancing
  backlog as paused.

## Evidence and completion

Create `tasks/v5-final-uat-soak-evidence-YYYY-MM-DD.md` containing the deployed addresses and
bytecode commit, opening/closing keeper balances, all draw IDs and lifecycle transactions,
watcher run links, dead-man red/green evidence, restart evidence, indexer health snapshots, and
the transaction IDs for every user path above. PM reviews the evidence before the gate is marked
complete.

