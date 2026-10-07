# V5 mainnet weekly keeper cache incident (2026-10-07)

**Status:** remediation in progress.  
**Scope:** off-chain keeper only; no contract migration or private-key handling.  
**Decision basis:** ADR-0036 sections 4.3, 7.2 and B2; ADR-0050 automatic keeper compounding.

## Impact

Mainnet draw 3 started and received randomness, but remained `Seeded`. The managed keeper repeatedly exited before `proposeRoot`, so finalization and automatic prize compounding could not begin. Participant principal remained withdrawable and the fixed prize payout remained escrowed.

The keeper wallet also crossed its warning threshold: 10.4434812709284392 MON against an 11.3 MON warning and a 5.7 MON hard floor. This did not cause the crash loop, but it leaves less than eight oracle-fee cycles of configured warning headroom.

## Evidence

- DrawManager: `0x266ab124480baDDB4af8Dfe578dDAb9F1Ed7610c`
- Draw 3 status: `Seeded`; request ID `352979`
- Canonical `DrawStarted`: block `111200953`
- Canonical `SeedReceived`: block `111200959`
- Keeper cache seed cursor: block `109199000`
- Failing scan: approximately 2.12 million blocks from the stale cursor to head
- Keeper logs: `Missing canonical block 109199001` and `eth_getLogs ... Error getting block by number`
- Primary RPC could read the old block header but could not serve its logs.
- Logs RPC could serve current data but could not serve the old block header or logs.
- Production indexer remained healthy and near chain head.

## Root cause

The event cache only advanced when constructing a draw input. With weekly cadence, the cursor remained idle for roughly one week. At the next seed, `DrawInputEventCache.seedBlockFor` called the global seed synchronizer, forcing an all-events scan from the stale cursor. Both configured RPC providers had already pruned part of that log range.

The same latent failure existed for participant discovery because that cursor also advanced only while constructing a draw input.

## Remediation

1. Resolve a draw's seed block from the on-chain `seedReceivedAt(drawId)` timestamp using a logarithmic block search.
2. Query only a bounded block window around that timestamp with the indexed `SeedReceived(drawId)` topic.
3. Advance the participant-event cache on every healthy keeper loop, including idle periods.
4. Add regression coverage for a 2.1-million-block weekly gap and for idle-loop participant synchronization.
5. Recover the live cache from canonical indexer evidence before restarting the merged keeper.

## External dependencies and failure behavior

| Dependency | Failure observed | Remediation behavior |
| --- | --- | --- |
| Primary Monad RPC | Old block headers available; old logs unavailable | Targeted seed lookup requests only current draw blocks; transient retries remain |
| Logs RPC | Historical triedb/archive range unavailable | Caller-RPC fallback remains, but bounded lookup avoids pruned history |
| Production indexer | Healthy during incident | Used once as canonical recovery evidence; contracts remain source of truth |
| Fly volume | Preserved stale checkpoint correctly | Back up before recovery; retain persistent incremental cache |
| Telegram / Healthchecks | Repeated crash and low-balance alerts delivered | Verify recovery heartbeat after keeper restart |

## Acceptance

- Focused draw/watcher tests pass.
- Focused keeper/supervisor tests pass.
- Live draw 3 reaches `Proposed`.
- Independent watcher recomputes and matches the root during the challenge window.
- Draw 3 reaches `Finalized`, the keeper executes claims, and `PrizeCompounded` is indexed.
- Keeper stays healthy with an incrementally advancing participant cursor.
