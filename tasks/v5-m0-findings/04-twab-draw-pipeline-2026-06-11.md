# M0 Pass 4 — TWAB + Draw Pipeline

**Scope:** TwabController, draw pipeline, ring-buffer risks, snapshot ordering, root proposal liveness/griefing, veto scope, and adapt-vs-greenfield decision.

## TwabController Decision

Conditionally approved: adapt PoolTogether V5's TwabController. Greenfielding is rejected unless a later ADR amendment justifies it.

Required M1 conditions:

- Differential tests against upstream behavior for retained paths.
- Property/fuzz tests for ring-buffer wraparound, same-block updates, period-boundary queries, overflow bounds, and zero/short periods.
- Explicit sponsor-delegate accounting tests: participant odds exclude sponsor-delegated TWAB, while fee attribution can read sponsor-delegate TWAB and total principal TWAB.
- License attribution and upstream version recorded in-tree.

## Draw Pipeline

The amended pipeline is acceptable:

- Account enumeration is deterministic from Merkl-shaped participant `Deposit`/`Withdraw` events.
- Winner sampling uses participant TWAB, not sponsor-delegated TWAB.
- Root proposal is permissionless after grace, single-active-proposal plus cooldown limits griefing, and bad-root veto is bounded to prize funds.
- Watcher independence, off-Fly hosting, dead-man heartbeats, draw timing inside operator waking hours, and a real veto drill are M8 gates.

## Findings

Fixed in this PR:

- **F-M0-RR-03:** ADR-0036 needed an explicit read surface for sponsor-delegated TWAB. The amended spec now separates account TWAB, total principal TWAB, and sponsor-delegate TWAB.
- **F-M0-RR-04:** The pipeline referred to `DepositShmon`, but ADR-0036 §8 preserves the Merkl-shaped `Deposit(account, assetValue)` event for direct shMON deposits. The pipeline now matches the ADR event surface.

No remaining TWAB/draw blocker.
