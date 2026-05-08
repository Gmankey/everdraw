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
- Configure the no-backfill points launch gate with `POINTS_START_UNIX=<unix-seconds>`.
  Production pre-launch reset gate: `1778217646` (`2026-05-08T05:20:46Z`).
  Rounds settled before this timestamp remain indexed for round/participation history but do not award points.
- One-time pre-public-launch points reset: after deploying the gate, run `npm run reset:points` on the live indexer.
  This truncates only `wallet_points`, `wallet_streaks`, and `wallet_round_points`.
- Participant lists are pool scoped with `/api/rounds/:roundId/participants?pool=<address>`; the unscoped form remains as a backwards-compatible shim and may merge colliding round IDs.
- `replaceForRound(roundId, rows)` explicitly deletes the round first, then inserts replacements so a reorg to zero rows does not leave stale `wallet_rounds` state.
- The runner currently polls RPC and rebuilds derived tables after each finalized sync window.
