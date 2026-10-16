# Everdraw Indexer Scaffold

This directory contains the initial Everdraw indexer/backend scaffold discussed in prior PM-reviewed architecture notes.

## Included in this pass
- SQLite schema for `raw_events`, `rounds`, `wallet_rounds`, `wallet_stats`, auth tables, and `indexer_state`
- Derivation services:
  - `deriveRounds.ts`
  - `deriveWalletRounds.ts`
  - `deriveWalletStats.ts`
- Repo helpers including:
  - `walletRoundsRepo.listAll()`
  - `rawEventsRepo.deleteForBlockRange(fromBlock, toBlock)`
  - `rawEventsRepo.upsertMany(rows)`
- Full rebuild entry point:
  - `ts-node src/rebuild.ts`
- Auth service entry point:
  - `tsx src/auth/server.ts`
- Indexer runner entry point:
  - `tsx src/run.ts`

## Notes
- This is now a working scaffold with derivation, auth, and a polling runner.
- The runner ingests finalized blocks only by waiting for configurable confirmations.
- `RPC_URL` serves canonical head, block, and contract reads. `INDEXER_LOGS_RPC_URL` serves combined-address `eth_getLogs` requests. Both endpoints are chain-ID validated.
- `RPC_URL_FALLBACK` is explicit, non-racing canonical-read fallback only. It is disabled unless `INDEXER_FALLBACK_MAX_REQUESTS_PER_HOUR` is positive; retries, request timeout, hourly budget, and post-failure cooldown are configured independently. Log ingestion never spills into this fallback.
- Production polls every 15 seconds. Log ranges adaptively split when an endpoint enforces a smaller block-range limit. `/api/health` exposes provider/method calls, errors, fallback reasons, budget use, cursor lag, and canonical state.
- Configure two-vault V2 indexing with `POOL_ADDRESSES_V2=<vaultA>,<vaultB>`.
- Production uses `POINTS_START_UNIX=0` so the live points ledger can be reconstructed from all indexed historical participation.
- Do not run `npm run reset:points` on the live indexer unless the user explicitly approves a production points reset. Once points have been shown publicly, existing wallet balances must be preserved across mechanics changes.
- Participant lists are pool scoped with `/api/rounds/:roundId/participants?pool=<address>`; the unscoped form remains as a backwards-compatible shim and may merge colliding round IDs.
- `replaceForRound(roundId, rows)` explicitly deletes the round first, then inserts replacements so a reorg to zero rows does not leave stale `wallet_rounds` state.
- The runner commits decoded events, canonical range metadata, and its cursor atomically. RPC errors, provider disagreement, missing block metadata, or in-flight reorgs reject the range without advancing the cursor.

## ADR-0043 (V5 prize auto-compound) UAT re-point — TODO after redeploy

`everdraw-indexer-uat` (Fly app) config is **Fly-secret-authoritative**, not committed to this
repo (mirrors the `everdraw-indexer` prod pattern — see `tasks/disaster-recovery-runbook.md`).
There is no per-environment `fly.toml` here to edit; the operator sets env directly via
`flyctl secrets set -a everdraw-indexer-uat ...`.

For the V5 stack, `POOL_ADDRESSES` must include **all three** contracts the indexer scans logs
from: PrizeVaultV5 (Deposit/Withdraw/BoostDeposit/BoostWithdraw), DrawManagerV5 (draw lifecycle),
and ClaimManagerV5 (claim/distribution events) — see `tasks/v5-indexer-event-ingestion-builder-ticket.md`
§1 and `POOL_EVENT_ABI` in `src/runner/abi.ts`.

**TODO after running `scripts/redeploy-v5-claim-draw-managers.js`:** the PrizeVaultV5 address is
unchanged (do not touch that entry), but the DrawManagerV5 and ClaimManagerV5 addresses in
`POOL_ADDRESSES` must be swapped for the new ones from the deployment record, and `START_BLOCK`
must move forward to the new deploy block (or the indexer will scan a huge unnecessary range
against the OLD claim/draw manager addresses, which no longer emit anything relevant, while
missing nothing from the vault since that address didn't change). See
`tasks/v5-auto-compound-uat-redeploy-runbook.md` for the exact `flyctl secrets set` command and
verification steps.

**Known gap (out of scope for this redeploy tooling, flagged for a follow-up ticket):**
`POOL_EVENT_ABI` in `src/runner/abi.ts` does not currently include ClaimManagerV5's
`PrizeCompounded(distributionId, leafIndex, account, amount)` event (ADR-0043). Until that event
is added to the ABI list and a derivation path labels the accompanying `Deposit` as a
prize-compound, the indexer will ingest the compound as an ordinary `Deposit` (correct for
tranche/points math, per ADR-0043's "standard Deposit ingestion should do this already") but
will NOT be able to label it "prize restaked" for history/UI purposes.
