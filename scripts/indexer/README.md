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
- Configure `RPC_URL_FALLBACK` with a distinct RPC endpoint to enable `ethers.FallbackProvider` failover.
- Configure two-vault V2 indexing with `POOL_ADDRESSES_V2=<vaultA>,<vaultB>`.
- Production uses `POINTS_START_UNIX=0` so the live points ledger can be reconstructed from all indexed historical participation.
- Do not run `npm run reset:points` on the live indexer unless the user explicitly approves a production points reset. Once points have been shown publicly, existing wallet balances must be preserved across mechanics changes.
- Participant lists are pool scoped with `/api/rounds/:roundId/participants?pool=<address>`; the unscoped form remains as a backwards-compatible shim and may merge colliding round IDs.
- `replaceForRound(roundId, rows)` explicitly deletes the round first, then inserts replacements so a reorg to zero rows does not leave stale `wallet_rounds` state.
- The runner currently polls RPC and rebuilds derived tables after each finalized sync window.
