# Builder Ticket — V5 Indexer Event Ingestion + Tranche Ledger (foundation for points)

**Implements:** ADR-0008 (points), ADR-0040 (Degen pool), and the TWAB V5 vault design.
**Blocks:** `tasks/v5-points-redesign-builder-ticket.md` (points cannot be built until this lands).
**Status:** This is the missing prerequisite the points ticket assumed but did not sequence. Build this FIRST.

---

## Why this exists

The points redesign ticket specified the *math* (per-tranche tenure, LIFO withdrawal, base = entries, bonuses, multipliers) but assumed the indexer already had the ordered V5 event stream to compute it from. It does not. The current indexer does **not** ingest V5 `Deposit`, `Withdraw`, `BoostDeposit`, or `BoostWithdraw` events. Without those ordered events there is no way to build per-deposit tranches or LIFO withdrawal logic. This ticket closes that gap. That sequencing miss is on the PM, not the builder.

---

## 1. Events to ingest (V5)

Ingest from the V5 contracts (PrizeVaultV5 + DrawManagerV5 + ClaimManagerV5). Enumerate the exact signatures against the deployed ABIs in `abi/` — do not guess. At minimum:

- **`Deposit(address indexed owner, uint256 assets, ...)`** — vault deposit (odds-bearing).
- **`Withdraw(address indexed owner, uint256 assets, ...)`** — vault withdrawal.
- **`BoostDeposit(address indexed owner, uint256 assets, ...)`** — Degen pool deposit (zero odds, ADR-0040).
- **`BoostWithdraw(address indexed owner, uint256 assets, ...)`** — Degen pool withdrawal.
- **Draw lifecycle** — whatever DrawManagerV5 emits on draw start/finalize/skip (e.g. `DrawStarted`/`DrawFinalized`/`DrawSkipped`) and ClaimManagerV5 on prize claim/win. Needed to attribute wins, losses, skipped draws, and "which draws a deposit was live for."

For each event capture: block number, log index, tx hash, timestamp, owner, amount, and draw id where applicable. **Ordering is mandatory** — persist (blockNumber, logIndex) so events can be replayed deterministically. Tranche/LIFO correctness depends entirely on stable ordering.

## 2. Tranche ledger

Build an append-only per-user tranche ledger derived from the ordered event stream:

- Each **Deposit** opens a tranche: `{owner, amount, openedAt (block+ts), openedDrawId, source: vault|degen}`.
- Each **Withdraw** consumes tranches **LIFO** (newest first), reducing/closing them. A withdrawal that fully drains the user's vault balance resets their streak/tenure state; a partial withdrawal only affects the withdrawn (newest) tranches. This mirrors the withdrawal rule in the points ticket — **full = reset, partial = LIFO, only the withdrawn portion loses its tenure.**
- Degen (`Boost*`) tranches are tracked separately (they carry the Degen multiplier ramp, zero odds) and must not commingle with vault tranches.
- Each tranche carries its **own tenure clock** (weeks live), so a multiplier earned by an old small tranche never applies to a large late deposit. This is the anti-gaming requirement from the points ticket §2b — it lives HERE, in the ledger, not in the UI.

## 3. Idempotency & reorg safety

- Ingestion must be **idempotent**: re-running over the same blocks must not double-count. Key on (txHash, logIndex).
- Handle chain reorgs on testnet: track a confirmed head and roll back tranche state if ingested logs disappear.
- Backfill from the vault deployment block on first run; then follow head.

## 4. Schema

Extend `scripts/indexer/src/services/schema.sql` (and repos) with:
- `v5_events` (raw ordered log store).
- `tranches` (open/closed tranche state per user, with source + tenure).
- Whatever the points math needs downstream (draws-live-count per tranche, etc.).

Keep this additive — do not break the existing V4.1 points path while V4.1 is still live.

## 5. Acceptance / verification (per CLAUDE.md end-to-end rule)

1. Point the indexer at the UAT vault; confirm it ingests real Deposit/Withdraw/BoostDeposit/BoostWithdraw logs (not zero rows).
2. Deposit → partial withdraw → deposit again on UAT; confirm the tranche ledger shows correct LIFO consumption and independent tenure clocks.
3. Confirm draw finalize/skip events are ingested and attributable (needed so "no paying draw" vs "win" is distinguishable downstream).
4. Re-run ingestion over the same range; confirm no double-counting (idempotency).
5. Report the row counts + a sample user's tranche timeline back for review before the points math ticket is started.

## 6. External dependencies (CLAUDE.md working rule #5)

- **Monad testnet RPC** — event source. On RPC gap/lag: ingestion must resume from last confirmed block, not skip.
- **Deployed V5 ABIs** (`abi/`) — must match the deployed UAT contracts; if the vault is redeployed, re-point and re-backfill.
- **Keeper** — draw lifecycle events only exist once the keeper finalizes draws (see keeper note below). Points depend on this being live.

---

**Sequencing:** this ticket → then `v5-points-redesign-builder-ticket.md` (math/UI) → then verify points end-to-end on UAT.
