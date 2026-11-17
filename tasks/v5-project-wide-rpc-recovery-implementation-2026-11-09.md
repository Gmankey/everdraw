# EverDraw V5 project-wide RPC recovery

Updated: 2026-11-17
Status: implementation complete; independent review required. Mainnet keeper remains stopped and the mainnet watcher remains disabled.

## Safety boundary

This change does not deploy or restart any mainnet component. Recovery order is fixed:

1. independent review of one immutable commit;
2. an auditor-authorized, one-shot, bounded watcher canary;
3. verification of root reconstruction, participant completeness, canonical hashes, alerting and veto coverage;
4. a separately approved keeper restart.

An Alchemy quota reset never clears a latch, enables a workflow or restarts a service.

## Provider roles

| Role | Endpoint | Workload |
|---|---|---|
| canonical head and hashes | `rpc.monad.xyz` | current state and canonical boundary/log hashes |
| discovery logs | configured Tenderly endpoint | combined-address discovery only |
| independent logs | qualified `rpc2.monad.xyz` | fixed-window independent event history |
| historical state | qualified `rpc2.monad.xyz` | block-tagged root reconstruction calls |
| paid transaction path | scoped egress gateway | nonce, fees, estimation, broadcast and receipts only |

No log or historical-state role may fall back to Alchemy. Errors and incomplete windows are unhealthy and never become zero events.

## Provider qualification

Qualification is manual and environment-approved in `.github/workflows/v5-rpc-qualification-mainnet.yml`. It is not run on pull requests or schedules.

The operator supplies an immutable approved commit, unique qualification ID, reviewed known-event evidence file, provider billing-period ID and shared provider-period request cap.

The qualification script:

- binds candidate, reference and canonical providers to chain 143 and one pinned final block/hash;
- compares complete V5 event history and range boundaries;
- verifies independently supplied nonempty seed, proposal, finalization, mint, transfer and burn identities and receipts;
- reconstructs historical roots through candidate and reference using the complete participant set;
- compares summed TWAB, prize legs and Merkle roots;
- reserves every wire request in a durable provider-period admission ledger before sending it;
- enforces a 10,000-request run ceiling, operator-supplied period ceiling, 250 ms minimum interval and 24-hour cooldown;
- writes incremental evidence and marks interrupted or capped work incomplete.

`scripts/rpc/mainnet-qualification-evidence.example.json` documents the reviewed input. A capability sample is not proof of complete history; the final artifact must be reviewed before recovery authorization.

## Durable paid-RPC enforcement

Raw paid-provider URLs are rejected by keeper and Hardhat mainnet clients. Only the paid egress gateway receives the raw credential.

The gateway:

- requires long, role-scoped bearer tokens;
- allows approved methods per role and denies `eth_getLogs`, trace/debug methods and oversized batches;
- reserves conservative compute units before every outbound batch item;
- validates schema, safe counters, role totals, reservations, caps and latch state;
- fsyncs the temporary state and parent directory around atomic rename;
- serializes reservations and every admin mutation under one lock;
- rejects same-period resets, redundant unlatches and stale state hashes;
- disables redirects, bounds request/response bodies and times the complete response body;
- latches durably on quota/capacity responses;
- exposes usage, latch and state hash without credentials.

Fly must run exactly one gateway machine attached to exactly one persistent volume. A durable writer lease rejects a second writer. Machine replacement or stale-lease recovery is fail-closed and requires an operator-reviewed lease reset while all gateway machines are stopped.

Default controls are 15M CU per explicit billing period, a protected 4M CU reserve, 8M keeper-write, 3M deployment and 2M CI-fork caps. The provider account must retain its external hard limit.

## Keeper write authentication

Mainnet keeper requires:

- `RPC_URL=https://everdraw-rpc-egress-mainnet.fly.dev/rpc/keeper-write`;
- `KEEPER_RPC_BEARER_TOKEN` containing its dedicated token.

Startup validates route, approved host, authentication and chain ID before lifecycle work. Missing/invalid credentials enter the persistent stop class. Tokens remain headers, never URL credentials or logs. Hardhat mainnet tasks use the same model with their own role token.

## Bounded watcher execution

Scheduled monitoring and recovery are separate workflows sharing one concurrency group.

The scheduled workflow runs one invocation only when normal monitoring is enabled and recovery approval is false. It cannot bootstrap missing/reorg-reset independent state. Whole-job limits are 20,000 block-work and 1,500 actual wire requests.

The manual canary is environment-approved, bound to an immutable commit and approval record, and runs only while the schedule is disabled and recovery approval is true. It invokes the watcher once. Whole-job limits are 250,000 block-work, 5,000 actual wire requests and 720 seconds.

Budgets include discovery, independent reconstruction, canonical validation, historical state and retries. Independent bootstrap/reorg reset requires explicit admission. Each completed chunk persists. A limit returns incomplete/unhealthy without a success heartbeat and never truncates participant or claim history.

## Audit finding closure

- **F-1:** paid log scans removed; exact production provider qualification added.
- **F-2:** strict persistent gateway ledger, scoped roles, external hard cap and durable latch.
- **F-3:** self-dispatch removed; one invocation per workflow; recovery and schedule separated.
- **F-4:** no paid logs/history fallback; errors fail closed.
- **F-5:** actual wire requests reserved and counted at the transport boundary.
- **F-6:** fixed windows and per-chunk atomic progress; no recursive bisection.
- **F-7:** public/scoped routes enforced across all RPC consumers.
- **R330-01:** scoped bearer authentication, startup validation, redaction and real gateway integration test.
- **R330-02:** cumulative whole-job budgets including independent cache and retries.
- **R330-03:** known nonempty histories plus complete participant/root/TWAB reconstruction.
- **R330-04:** corrupt structures rejected; durable fsync-backed atomic writes.
- **R330-05:** admin/reservation mutations share one lock; multiprocess race regression.
- **R330-06:** qualification is manual, approved, admitted, cooled down and capped.
- **R330-07:** redirect denial, full-body timeout and response-size limit.

## Expected workload

Steady state has zero Alchemy log or historical-read load.

- Indexer: 15-second combined-address discovery polling with public canonical checks; paid CU zero.
- Scheduled watcher: four runs/hour, capped at 1,500 requests and 20,000 block-work per job; paid CU zero.
- Manual catch-up: one approved invocation, maximum 5,000 requests and 250,000 block-work.
- Qualification: manual only, maximum 10,000 requests plus shared provider-period cap.
- Keeper: public reads; only transaction-triggered support calls use the paid gateway.
- Deployment: manual only, capped at 3M CU.

Observe method/provider counters, fallback reasons, indexing lag, watcher freshness and paid-ledger state. Alchemy usage must remain flat outside approved transaction work.

## Reproducible verification

```bash
npm ci
npm run rpc:incident:test
npm run draw:watch:test
npm run keeper:v5:test

npm --prefix scripts/indexer ci
npm --prefix scripts/indexer test
npm --prefix scripts/indexer run build

npm --prefix web ci
MODE=test npm --prefix web run build

npm --prefix docs-site ci
npm --prefix docs-site run build
```

Do not run live qualification until the auditor approves its exact evidence input and admission values.

## Recovery runbook

### 0. Maintain containment

- Keep the mainnet keeper stopped.
- Keep `V5_WATCHER_MAINNET_ENABLED=false`.
- Do not clear persistent keeper or gateway latches.

### 1. Independent review

Approve one immutable commit and evidence report. Later code changes invalidate approval.

### 2. Prepare gateway after approval

1. Create one gateway app, one persistent volume and exactly one machine.
2. Initialize the reviewed budget config/ledger for the explicit billing period.
3. Configure the approved config SHA-256, raw paid URL and distinct long random role tokens only on the gateway.
4. Set the provider account hard limit.
5. Rotate the old paid credential and remove it from all other apps, Actions and operator files.
6. Configure keeper gateway URL/token but do not start it.
7. Verify the writer lease, `/healthz`, zero usage and state hash.

Rollback: stop the sole gateway, revoke the affected role token, preserve the volume/ledger, and do not reset the writer lease without recorded review.

### 3. Indexer canary

Deploy only reviewed routing. Observe 24-48 hours for cursor advancement, bounded lag, no fallback, no secret leakage and flat Alchemy usage. Never restore raw paid fallback.

### 4. Qualify provider

After evidence-input approval, dispatch `v5-mainnet-rpc-qualification` once. Review completeness, request counts, pinned block, known identities, participant totals and reconstructed roots. Partial evidence does not authorize recovery.

### 5. Authorized watcher catch-up

1. Keep scheduled watcher disabled.
2. Set recovery approval true.
3. Dispatch `v5-root-watcher-mainnet-canary` once with approved commit/reference.
4. Review block/request totals, cursors, canonical evidence and root result.
5. Repeat only under new explicit authorization.

Any disagreement, cache reset, cap, incomplete window or insufficient veto time is unhealthy. Preserve evidence and stop.

### 6. Security coverage

Require full watcher catch-up, matched roots, complete participants, canonical boundaries, healthy dead-man alert, working veto path and untouched gateway reserve.

### 7. Coordinated keeper restart

Requires separate auditor approval. Record any keeper latch and approved gateway state hash before clearing it. Start one keeper machine and observe a complete lifecycle.

## Rollback

Stop keeper, disable watcher, preserve caches/DB/ledger, revoke only affected scoped tokens, roll back the image and leave budget/quota latches intact. Unknown state is unhealthy.
