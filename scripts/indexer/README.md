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
- `replaceForRound(roundId, rows)` explicitly deletes the round first, then inserts replacements so a reorg to zero rows does not leave stale `wallet_rounds` state.
- The runner currently polls RPC and rebuilds derived tables after each finalized sync window.
