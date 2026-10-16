# EverDraw V5 RPC cost and reliability remediation

Date: 2026-10-16
Status: code complete for independent re-review; production not changed
Scope: indexer, keeper, independent root watcher, frontend release guard, monitoring

## Root cause

The production indexer polled every two seconds, fetched logs separately per contract and used an ethers fallback provider with a two-second stall timeout. Slow primary reads could therefore race into Alchemy even when the primary had not failed. The original 7.8-12.5M CU/day estimate remains a workload estimate, not measured post-change usage.

## Independent-review remediation

### R-RPC-01: stale independent evidence after a reorg

Closed in code and regression tests.

- Independent cache format is versioned forward, invalidating legacy root-only markers.
- Seed, proposal and finalization evidence is bound to event block number/hash, seed block/hash and root.
- The cache checkpoint is revalidated before reading any verified/finalized marker.
- Canonical divergence clears reconstructed history and every verification/publication marker, then rescans.
- Evidence is checked again after reconstruction and immediately before a healthy heartbeat.
- The full exported watcher main() regression changes canonical hashes, participant Alice to Bob and the seed; the old root is rejected and no second healthy heartbeat is sent.

### R-RPC-02: recovered proposals bypassed veto coverage

Closed in code and regression tests.

- Discovery events and independently recovered current draws now use one verifyProposal path.
- The independent event deadline is retained and compared with the discovery event and on-chain challengeEndsAt.
- The same minimum remaining veto window is enforced for both paths.
- Omitted proposals with sufficient time pass; expired proposals and deadline disagreements alert, reject the run and withhold health.

### R-RPC-03: routine watcher traffic used the security RPC

Closed in code and regression tests.

- Routine head, bytecode, state, scan-boundary, log-block and checkpoint reads use WATCHER_HEAD_RPC_URL.
- Discovery logs remain on WATCHER_LOGS_RPC_URL.
- WATCHER_RPC_URL is initialized but makes no request in a no-root idle cycle.
- Security chain/code checks, security event/history scans, TWAB reconstruction and root verification run only when a proposed/finalized root requires independent verification.
- The idle full-main regression asserts zero security-provider calls.

### R-RPC-04: range splitting missed ethers error wrappers

Closed in code and regression tests.

- Error classification walks nested ethers shortMessage, message, reason, body, error, info and data wrappers.
- Quota, compute-unit, capacity and HTTP 429 failures are not treated as range limits.
- Recursive splitting is depth-bounded and sequential, preventing fan-out.
- A loopback JSON-RPC server returns a standard nested -32602 range error; the actual ethers provider bisects, completes and advances the cursor with one request in flight.

## RPC routing and limits

### Indexer

- RPC_URL: public canonical reads.
- INDEXER_LOGS_RPC_URL: combined-address log reads.
- RPC_URL_FALLBACK: explicit canonical fallback only; log ingestion never falls back.
- Three primary attempts, 10-second transport/application timeout, 500ms-5s backoff.
- Production fallback allowance: 12 requests/hour and five-minute cooldown after fallback failure.
- This allowance is deliberately reported as fallbackBudgetScope=process. It resets on process restart and is not a fleet-wide or persistent quota.
- Events, canonical metadata and cursor updates remain one database transaction. Error, missing metadata, disagreement or in-flight reorg means no cursor advance.

### Keeper

- Continuous chain, contract, event-cache, fee and balance reads use KEEPER_READ_RPC_URL.
- The write provider is used only by transaction-triggered work. Its actual wire traffic includes chain ID, nonce, gas estimation, raw transaction broadcast and receipt polling as required by ethers.
- Idle loops do not call the write provider.
- Wire usage is emitted on success and failure.

### Root watcher

- Discovery logs: Tenderly.
- Routine canonical validation: public Monad head endpoint.
- Independent completeness/reconstruction: Alchemy security endpoint, only for proposal/finalization verification.
- Unknown or non-canonical evidence cannot emit healthy status.

### Transport and telemetry

- Indexer, keeper and watcher providers count actual JSON-RPC payloads at the ethers _send boundary as wireCalls and wireErrors, by provider role and method.
- Existing calls/errors remain application-operation counters and are not presented as billing totals.
- Counters include application retries, ethers transport calls, transaction support calls and failure paths.
- Provider HTTP requests now have a transport timeout aligned with the configured application timeout, so a timed-out operation does not leave an unbounded request running.
- Endpoint URLs and credentials are never included in counters or logs.

## Frontend release guard

- A mainnet manifest must use https://rpc.monad.xyz.
- Alternate exposed VITE_*RPC* environment paths are rejected if they contain a credential-bearing RPC; legacy VITE_RPC_URL must also use the public Monad RPC.
- Every production build now scans the generated dist artifact and fails if it contains a Monad Alchemy endpoint or a credential-bearing /v2/<token> URL. Violations report only the file and rule, never the matched value.
- The local production build with V5 disabled passes this scan. The real approved V5 manifest build must pass the same mandatory post-build scan during deployment; that live artifact remains an acceptance gate.

## Production configuration

Indexer:
- RPC_URL=https://rpc.monad.xyz
- INDEXER_LOGS_RPC_URL=https://monad.gateway.tenderly.co
- RPC_URL_FALLBACK=<Alchemy Monad mainnet endpoint>
- INDEXER_POLL_INTERVAL_MS=15000
- INDEXER_CHUNK_SIZE=1000
- INDEXER_RPC_TIMEOUT_MS=10000
- INDEXER_RPC_RETRY_ATTEMPTS=3
- INDEXER_RPC_RETRY_BASE_DELAY_MS=500
- INDEXER_RPC_RETRY_MAX_DELAY_MS=5000
- INDEXER_FALLBACK_MAX_REQUESTS_PER_HOUR=12
- INDEXER_FALLBACK_COOLDOWN_MS=300000

Keeper:
- KEEPER_READ_RPC_URL=https://rpc.monad.xyz
- WATCHER_LOGS_RPC_URL=https://monad.gateway.tenderly.co
- RPC_URL=<Alchemy Monad mainnet transaction endpoint>

Watcher:
- WATCHER_LOGS_RPC_URL=<Tenderly>
- WATCHER_RPC_URL=<independent Alchemy security endpoint>
- WATCHER_HEAD_RPC_URL=https://rpc.monad.xyz
- WATCHER_INDEPENDENT_LOG_CHUNK_SIZE=1000
- WATCHER_INDEPENDENT_STATE_FILE=.watcher-cache-mainnet/independent-state.json

## Verification

- Indexer TypeScript build: pass.
- Indexer tests: 34/34 pass.
- Keeper tests: 23/23 pass.
- Watcher tests: 32/32 pass.
- Frontend release/artifact tests: 9/9 pass.
- Frontend production build and generated-artifact scan: pass with V5 disabled.
- The auditor's former watcher reproduction now exits nonzero at the expired recovered proposal.
- The auditor's former indexer reproduction now exits nonzero because sync succeeds instead of throwing the expected unsplit-range error.

## Remaining live acceptance gates

No production service was changed by this patch. After independent approval:

1. Deploy only the indexer and run a 24-hour canary. Confirm bounded lag, zero normal fallback use, no cursor advance under injected failure/disagreement and reduced Alchemy usage.
2. Deploy keeper read routing. Observe idle and transaction cycles; confirm write-provider wire calls occur only around transactions and dead-man health stays green.
3. Deploy the watcher. Complete cache catch-up, outage/reorg/omitted-log drills and one full proposal, independent recomputation, finalization, proof publication, claim and auto-compound lifecycle.
4. Build the actual approved mainnet V5 release manifest and retain the successful artifact-scan output.
5. Compare 24-48 hours of emitted wire counters with Alchemy and Tenderly dashboards.

These are evidence gates, not additional code findings.
