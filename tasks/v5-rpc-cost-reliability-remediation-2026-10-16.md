# EverDraw V5 RPC cost and reliability remediation

Date: 2026-10-16
Status: implementation ready for review; production not changed
Scope: indexer, keeper, root watcher, frontend release guard, monitoring

## Root cause

The production indexer polled every two seconds and issued one eth_getLogs request per contract plus repeated canonical block reads. Its ethers FallbackProvider used a two-second stall timeout, so a slow primary could trigger Alchemy even when it had not failed. This creates a continuous paid-RPC baseline of roughly 7.8-12.5M Alchemy compute units per day.

The keeper and watcher were smaller consumers. The keeper routed its balance check through its transaction provider. The watcher used Tenderly for log discovery but needed a stronger independent completeness guarantee before treating a proposed root as verified.

## Implemented behavior

### Indexer

- RPC_URL is the canonical read provider.
- INDEXER_LOGS_RPC_URL is the log provider.
- One combined-address eth_getLogs query replaces one query per contract.
- Log ranges adaptively bisect when the endpoint enforces a range cap.
- Default polling is 15 seconds.
- Canonical start/end hashes are checked before and after each log range.
- Every returned log block hash is checked against the canonical provider.
- Events, canonical metadata, and cursor updates remain one database transaction.
- Any RPC error, missing block metadata, provider disagreement, or in-flight reorg rejects the range without advancing the cursor.
- The racing ethers FallbackProvider is removed.
- Canonical fallback is explicit: three primary attempts, 10-second timeout, 500ms-5s backoff, 12 requests/hour maximum in production, and five-minute cooldown after a fallback failure.
- Log ingestion never falls back to RPC_URL_FALLBACK.
- /api/health reports cursor lag and provider/method calls, errors, fallback reasons, and budget use.

### Keeper

- Continuous contract, chain-head, event-cache, fee, and balance reads use KEEPER_READ_RPC_URL.
- RPC_URL remains the signer/transaction provider. Its chain ID is validated only when a transaction is about to be sent; idle loops make no paid-provider calls.
- Provider/method counters are logged each loop.
- Mainnet Fly config points KEEPER_READ_RPC_URL at https://rpc.monad.xyz and keeps log reconstruction on Tenderly.

### Root watcher

- Tenderly remains the low-cost discovery log source.
- A separate persistent cache reconstructs participants, seed blocks, proposals, and finalizations directly from WATCHER_RPC_URL.
- Before accepting a proposal/finalization, the watcher requires the security RPC to contain the matching canonical event and recomputes from the security-RPC participant set.
- A current on-chain Proposed/Finalized draw whose root is not independently verified triggers security-RPC reconstruction even if Tenderly omitted the proposal event.
- Independent reconstruction checkpoints every completed batch and adaptively splits log ranges.
- Unknown, omitted, mismatched, or non-canonical data fails the run and cannot emit a healthy heartbeat.
- Watcher provider/method counts, errors, and fallback reasons are logged.
- This preserves backend independence: Tenderly cannot independently cause a bad root to be accepted as verified.

### Frontend

- A mainnet release manifest is rejected unless its RPC is https://rpc.monad.xyz.
- Alchemy endpoints and keys cannot be baked into the mainnet frontend bundle.

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
- RPC_URL=<Alchemy Monad mainnet endpoint, transaction provider>

Watcher:

- WATCHER_LOGS_RPC_URL=<Tenderly>
- WATCHER_RPC_URL=<independent Alchemy security/reconstruction endpoint>
- WATCHER_HEAD_RPC_URL=<public Monad head endpoint>
- WATCHER_INDEPENDENT_LOG_CHUNK_SIZE=1000
- WATCHER_INDEPENDENT_STATE_FILE=.watcher-cache-mainnet/independent-state.json

No secrets may be printed, committed, exposed in health output, or embedded in the frontend.

## Acceptance sequence

1. Merge only after indexer build/tests, keeper tests, watcher tests, and frontend tests pass.
2. Deploy the indexer first. Do not change keeper or watcher in the same step.
3. Run a 24-hour indexer canary:
   - lag remains bounded and returns to zero;
   - canonicalHash advances;
   - no cursor advance on injected log-RPC error;
   - a simulated provider disagreement reports unhealthy;
   - fallback counters stay zero during normal operation;
   - Tenderly reports sustainable usage;
   - Alchemy shows no continuous indexer baseline.
4. Deploy keeper read routing. Observe at least 24 hours including a normal idle loop and a transaction:
   - idle reads appear only on the public/Tenderly providers;
   - Alchemy use is limited to transaction-triggered nonce, gas, submit, and receipt calls;
   - dead-man heartbeat remains green.
5. Enable the updated watcher:
   - let the independent cache catch up;
   - do not consider watcher health green until it is current;
   - run an omitted-log fixture, outage, and adversarial reorg drill;
   - complete one end-to-end draw proposal, independent recomputation, finalization, proof publication, claim, and auto-compound.
6. Compare 24-48 hours of provider/method counters with Alchemy and Tenderly dashboards.

## Rollback

- Indexer: roll back the Fly image and restore previous secrets. The existing SQLite cursor remains canonical; the new code does not migrate the schema.
- Keeper: restore KEEPER_READ_RPC_URL to the prior endpoint or roll back the image. Do not alter signer secrets or deployment addresses.
- Watcher: disable only the new workflow revision or roll back it. A watcher failure is unknown/unverified, never healthy; keeper operation and guardian veto authority remain separate.
- Frontend: roll back the bundle only if the approved mainnet manifest still uses the public Monad RPC.

## Test evidence

- Indexer TypeScript build and tests: 30/30 pass, including adaptive range splitting, provider disagreement, in-flight reorg, and no cursor advance on RPC failure.
- Keeper tests: 22/22 pass, including no paid-provider read during idle loops.
- Watcher tests: 25/25 pass, including omitted independent proposal evidence and independent finalization persistence.
- Frontend release-config tests: 6/6 pass; frontend production build passes with V5 disabled and no secrets supplied.
- Required live evidence remains the 24-48 hour canary and one complete draw lifecycle. No claim is made that those live gates are complete.
