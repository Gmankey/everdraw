# M0 Pass 5 — External Dependencies

**Scope:** Re-derive ADR-0036 §7.2 dependency table and pipeline failure modes.

## Dependencies Checked

- shMON/yield venue
- Future strategy adapters
- Pyth Entropy / randomness adapter
- Keeper
- Watcher
- Reference implementations
- Archive RPC and event log access
- Indexer infrastructure
- Frontend hosting / DNS
- Wallet stack
- Merkl registration and event consumption
- Alerting / dead-man checks
- Reference-implementation npm supply chain
- Monad reorg/finality assumptions

## Result

The amended dependency table is materially complete for M0. Remaining dependency work belongs in later milestone gates, not M0:

- M3 must prove two independent winner implementations and archive/event reconstruction.
- M8 must prove watcher hosting, dead-man alerts, veto drill, and runbooks.
- M9 must confirm Merkl registration and live points flow.

## Findings

No remaining external-dependency blocker.
