# Builder Ticket — Post-Launch Doc Rewrite + V2 Smoke Tests

**Date:** 2026-05-07
**PM:** Claude
**Source of truth:** `docs/decisions/0001`–`0006` and the live Vault A contract `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888`. Read those before starting.

## Goal

Make user-facing and developer-facing documentation accurate against the post-redeploy V2 reality, and smoke-test the four shipped fixes that have no live verification yet.

## Part A — Documentation rewrite

### Scope

Every file under `docs/` (excluding `docs/decisions/` and `docs/_pm-inbox/`). Most are still framed around the V1 contract: 4-state lifecycle including "Finalizing 7d unstake," `executeNext()`, single-vault language, V1 ABI in developer references. None of that matches V2.

### Required corrections

These are the specific known errors. Sweep the remaining files for the same patterns and fix them too.

**`docs/how-it-works/round-lifecycle.md`** — full rewrite:
- Replace the 4-state model with V2's 3-state success path (Open → Committed → Settled) plus terminal states Skipped (zero tickets) and Failed (blockhash expired).
- Drop the "Finalizing = 7d unstake" framing entirely. The lock period is **6 days of yield accrual**, not unstaking. shMON is not unstaked inside the contract during the round.
- Replace line 72 "at any given time, at least one vault is in State 1 (Open)" — false. Correct: "Two vaults run on offset weekly schedules — Vault A opens Wednesdays at 13:00 UTC, Vault B opens Sundays at 01:00 UTC — so the worst-case wait for an open deposit window is ~2.5 days."
- Update the timeline summary table to: Open 24h → Committed (instant, atomic with new round opening) → Settled (~3 blocks later, prize finalized).

**`docs/faq.md`** — content fixes:
- L21 "Why does withdrawal take 7 days?" — rewrite. V2 shMON withdrawal is **immediate** post-settle. Only converting shMON → raw MON requires the 7-day Monad unstake queue, and that's outside the EverDraw contract entirely.
- L33–35 "Unclaimed prizes roll forward / claim window" — **delete and rewrite**. Per ADR-0005 (D) unclaimed prizes and principal sit in the contract indefinitely. There is no claim window, no rollforward. Update copy accordingly.

**`docs/getting-started/claiming-withdrawing.md`** — full rewrite:
- L3 "after the ~7 day finalization period" — wrong. Settlement happens within seconds of the lock period ending (3-block delay between commit and settle, not 7 days).
- L17 "You must claim the prize before it expires" — wrong. No expiry.
- L29–31 unstake-queue countdown explanation — wrong. The Withdraw button is gated on round state being Settled (or Skipped/Failed), not on an unstake queue.
- L39 "Prize claims do have an expiry window" — wrong. Delete.

**`docs/getting-started/buying-tickets.md`** — small edit:
- L27 "Purple ring — vault is locked, in finalization" → "Purple ring — vault is locked, yield accruing."

**`docs/how-it-works/protocol-overview.md`** — content fixes:
- L30 "A new round opens simultaneously, so there is always an active vault accepting deposits" — wrong. Replace with the staggered two-vault explanation (worst-case 2.5d wait, not always-open).
- L32 references `executeNext()` as the lifecycle-advancing function — V2 doesn't have `executeNext()`. The keeper now calls `commit(rid)` and `settle(rid)` separately. The "anyone can call" property still holds (commit and settle are public), so update copy without losing that point.

**`docs/developers/smart-contract.md`** — full V2 rewrite:
- Mainnet address: `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` (Vault A). Once Vault B deploys, list both with their anchor schedules.
- Constructor params (V2): `_shmon`, `_ticketPriceMON`, `_roundDurationSec`, `_yieldPeriodSec`, `_owner`. Drop `_commitDelayBlocks` (doesn't exist on V2). Note `TARGET_BLOCK_DELAY = 3` is a constant, not a constructor arg.
- `getRoundInfo` return signature must match V2 exactly (state, salesEndTime, targetBlockNumber, totalTickets, totalPrincipalMON, totalShmonShares, principalSharesAtSettle, prizeShares, shareRateAtSettle, winner, winningTicket, prizeClaimed). Drop V1-only fields (`unstakeCompletionEpoch`, `monReceived`, `yieldMON`, `lossRatio`).
- Round state enum: `0=Open, 1=Committed, 2=Settled, 3=Skipped, 4=Failed`. Add Skipped/Failed which weren't in V1.
- Replace `executeNext()` with `commit(uint256 rid)` and `settle(uint256 rid)`.
- Replace `buyTickets` with both V2 entry points: `buyTicketsMON(uint32)` (payable) and `buyTicketsShmon(uint32)` (uses shMON shares).
- Events: replace `TicketsBought` → `TicketsPurchased`, `DrawCommitted` → `RoundCommitted`. Add `RoundSettled`, `RoundSkipped`, `RoundFailed`, `PrincipalWithdrawn`, `PrizeClaimed`. Add the Merkl-surface events `Deposit(address indexed recipient, uint256 amount)` and `Withdraw(address indexed recipient, uint256 amount)`.
- Add a new "Merkl-readable surface" subsection documenting `name()`, `symbol()`, `decimals()`, `balanceOf(address)`, `totalSupply()`. State explicitly: read-only, non-transferable, MON-principal-denominated, present so that Merkl/shMonad indexers can compute time-weighted points off-chain.

**`docs/developers/integration.md`** — full V2 rewrite paralleling smart-contract.md:
- New ABI path: `out/TicketPrizePoolShmonV2.sol/TicketPrizePoolShmonV2.json`.
- Update state enum, event names, struct fields.
- `VITE_POOL_ADDRESSES` reference is correct in concept; update example to show the two-vault config.

### Sweep targets (re-read and reconcile)

These weren't fully audited but likely contain V1-era language or single-vault framing. Read each, reconcile against ADRs, fix or confirm clean:

- `docs/README.md`
- `docs/SUMMARY.md`
- `docs/why-everdraw.md`
- `docs/for-protocols.md`
- `docs/shmon-partnership.md` (must mention Merkl/shMonad points integration per ADR-0006)
- `docs/security.md`
- `docs/getting-started/README.md`, `connect-wallet.md`, `checking-results.md`
- `docs/how-it-works/README.md`, `winner-selection.md`
- `docs/developers/README.md`, `architecture.md`, `keeper-bot.md`
- `docs/vision/README.md`, `phase-1.md`, `phase-2.md`, `phase-3.md`, `phase-4.md`, `phase-5.md`

### Acceptance criteria for Part A

1. Every reference to "Finalizing", "7-day unstake wait inside the round", or "always at least one vault Open" is removed from non-decision docs.
2. Every reference to V1 functions (`executeNext`, `buyTickets`, `TicketsBought`, `DrawCommitted`) is replaced with V2 equivalents.
3. Every code/ABI snippet matches `src/TicketPrizePoolShmonV2.sol` exactly.
4. Mainnet address `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` appears in `developers/smart-contract.md`. Vault B address is added the day it deploys.
5. Merkl surface is documented (developer-facing) and the "double points with shMonad" benefit is messaged appropriately (user-facing, in `shmon-partnership.md` or wherever appropriate).
6. PM (Claude) reviews the rewritten files before merge.

## Part B — V2 smoke tests for shipped fixes

Four fixes shipped in the redeploy that have no live verification yet. Confirm each against live Vault A.

### B1. Final-30s buy cutoff (frontend)

- During Vault A round 1 (Wed 12:59:54 UTC → Thu 12:59:54 UTC), at approximately T-25s before salesEndTime, navigate to the buy flow with a connected wallet.
- Expected: buy button is disabled with the 30s-cutoff explainer copy showing.
- Expected: at T-31s the button is still enabled. Verify the threshold is exact.
- Capture: a screenshot of the disabled state + the actual countdown clock at the time.

### B2. Pool-scoped participants endpoint (indexer + frontend)

- With both new Vault A `0x2208…7888` and old Vault A `0xed67…` running concurrently, query: `GET /api/rounds/1/participants?pool=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` — should return only entrants from new Vault A round 1.
- Query without the pool param (legacy form): document what comes back and confirm it matches the documented backwards-compat shim.
- Frontend: load the previous-round view for both vaults; confirm participant lists are not cross-contaminated between pools.

### B3. Withdrawal-latency tracking (indexer)

- Will only have data after the first withdrawal happens. After the user does their planned end-to-end test (likely after Vault A round 1 settles ~Wed 2026-05-13), query the indexer's withdrawal-latency endpoint.
- Expected: per-round and per-wallet latency values populate; aggregate stats (median, p90, p99) are computable. Schema documented in this ticket.
- If no data flows after the first settle+withdraw, that is a bug — root-cause and fix.

### B4. ClaimFlowModal principal-mode copy (frontend)

- Open the ClaimFlowModal in principal-mode (non-winner) state — easiest by hitting an old settled round where the user was a non-winning depositor on either vault.
- Expected (Option A copy):
  - Title: "How do you want to handle your principal?"
  - Buttons: `WITHDRAW`, `KEEP PLAYING`, `WITHDRAW AND CONVERT TO MON`
- For winner-mode users: confirm the existing winner copy still renders correctly (no regression).
- Capture: screenshot of both modes side-by-side.

### Acceptance criteria for Part B

1. All four smoke tests executed and results documented in this ticket file (append a "Results" section at the bottom).
2. Any bugs discovered are fixed in the same PR or filed as separate tickets, depending on severity.
3. PM signs off after seeing screenshots and test logs.

## Part C — Coordination items (lighter weight)

- After Vault B deploys Sunday 2026-05-10, update the smart-contract docs and the Merkl handoff packet with Vault B's address.
- Add a short note to `docs/decisions/0001` updating the Vault B "deploy target" line to its actual mined-tx timestamp once known.

## Out of scope

- New features, new contract changes, retention features (auto-rollover etc.) — see Phase 2 backlog (separate tickets to be filed).
- Postmortem of the 12:00 UTC abort (filed separately as a runbook addendum).
- Marketing copy, blog posts, social — those are not engineering deliverables.

## Timeline

- **Doc rewrite (Part A)**: complete by EOD Mon 2026-05-11 so the user can do their end-to-end mainnet test against accurate docs.
- **Smoke tests B1, B2, B4**: run against Vault A round 1 before settle (i.e. before Wed 2026-05-13 13:00 UTC).
- **Smoke test B3**: run after first withdrawal lands (post-2026-05-13).
- **Vault B address propagation (Part C)**: same day as Vault B deploys (Sun 2026-05-10).

## ADR references

- [ADR-0001 — Two-vault staggered cadence](../decisions/0001-two-vault-staggered-cadence.md)
- [ADR-0002 — Lock-period semantics and draw timing](../decisions/0002-lock-period-and-draw-timing.md)
- [ADR-0003 — Migration plan](../decisions/0003-migration-and-vault-b-deployment.md)
- [ADR-0004 — V2 contract behavior verified](../decisions/0004-v2-contract-behavior-verified.md)
- [ADR-0005 — UX and operational decisions](../decisions/0005-ux-and-ops-decisions.md)
- [ADR-0006 — Merkl-readable position surface](../decisions/0006-merkl-readable-position-surface.md)
