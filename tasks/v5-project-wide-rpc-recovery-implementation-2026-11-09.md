# EverDraw V5 project-wide RPC recovery

Date: 2026-11-09  
Status: implementation submitted for independent review; mainnet keeper remains stopped and mainnet watcher remains disabled.

## Safety boundary

This change does not restart or deploy any stopped mainnet component. Recovery remains:

1. independent review of this immutable commit;
2. an explicitly authorized, bounded watcher catch-up;
3. verification that root reconstruction, participant completeness, canonical hashes and veto time are covered;
4. a separately coordinated keeper restart.

An Alchemy quota reset never clears a latch or enables a workflow.

## Provider qualification and role separation

Monad's current network documentation identifies:

- `rpc.monad.xyz` as QuickNode;
- `rpc2.monad.xyz` as Goldsky Edge, with historical-state support;
- `rpc1.monad.xyz` as Alchemy.

References:

- https://docs.monad.xyz/developer-essentials/network-information
- https://docs.monad.xyz/tooling-and-infra/rpc-providers
- https://goldsky.com/case-studies/monad

Goldsky is independent of QuickNode and of the Tenderly discovery endpoint. The shipped routing is:

| Role | Endpoint | Allowed workload |
|---|---|---|
| canonical head, block hashes and keeper state | `rpc.monad.xyz` (QuickNode) | current block/code, range boundaries, log block hashes and keeper reconstruction |
| discovery logs | `monad.gateway.tenderly.co` | combined-address event discovery only |
| independent logs | `rpc2.monad.xyz` (Goldsky) | fixed-window V5 event reconstruction |
| watcher historical state | `rpc2.monad.xyz` (Goldsky) | block-tagged `eth_call` for independent root reconstruction |
| transaction broadcast | budget egress role `keeper-write` | nonce/fee/estimate/send/receipt only |
| fork CI | `rpc2.monad.xyz` | bounded real-shMON fork reads |

`scripts/rpc/qualify-mainnet-provider.mjs` performs the full qualification, not a sample-only probe. It:

- scans every V5 address from deploy block 105196182 through the shared candidate/canonical head in fixed 10,000-block windows;
- validates every returned log's block hash through QuickNode;
- compares 24 evenly spaced 100-block log windows exactly between Goldsky and QuickNode;
- compares historical `DrawManager.vault()` state at five ages;
- compares representative transaction receipts;
- serializes each provider at a minimum 250 ms interval, performs no retries or fallback, caps itself at 2,500 total JSON-RPC requests and does not use Alchemy;
- emits a content-addressable evidence JSON artifact in CI.

The contracts workflow uploads `rpc2-mainnet-qualification-<commit>`. A missing artifact or any mismatch fails CI. Qualification is therefore tied to the reviewed commit.

The independent reviewer must use the artifact produced by the final immutable PR head; earlier branch-head artifacts are superseded.

## Durable paid-RPC enforcement

All direct Alchemy URLs are rejected by keeper, watcher, indexer configuration and Hardhat mainnet configuration. The raw provider credential is permitted only in the paid egress gateway.

The gateway reserves conservative compute units before each outbound HTTP attempt. Enforcement is durable in a persistent, atomic JSON ledger:

- account automated cap: 15,000,000 CU per explicitly named billing period;
- non-borrowable critical reserve: 4,000,000 CU;
- `keeper-write` role cap: 8,000,000 CU, critical;
- `deployment` role cap: 3,000,000 CU, ordinary;
- `ci-fork` role cap: 2,000,000 CU, ordinary;
- every batch element is charged at a deliberately conservative 1,000 CU per allowed method;
- unknown methods, `eth_getLogs`, debug/trace methods and oversized batches are denied;
- missing/corrupt ledger, period mismatch, approved-config hash mismatch or lock contention fails closed;
- HTTP 402/429 and provider quota/capacity responses set a durable latch;
- there are no hidden HTTP retries and no gateway retry;
- a billing-period replacement or unlatch requires the exact current state hash and an exact operator confirmation phrase.

The 15M ceiling is fixed at half of the 30M plan allowance and cannot be increased by a process restart. The 4M reserve cannot be consumed by deployment or CI roles. A new calendar month does nothing until the reviewed config period and ledger are explicitly replaced.

The gateway Fly definition uses an auto-stop machine with zero minimum machines. It is not deployed by this PR.

## Audit finding closure

### F-1: independent log workload exceeded the allowance

Closed by removing paid log scans entirely. Goldsky handles fixed-window independent logs; Tenderly remains discovery only. The full-history qualification proves the range and completeness assumptions used by the watcher.

### F-2: no durable account-wide breaker

Closed by the gateway ledger and scoped bearer roles. Tests cover restart persistence, protected reserve, batch charging, missing/corrupt state, lock contention, method denial, quota latching and subsequent rejection.

### F-3: scheduler amplification

Closed by removing both watcher self-dispatch successors and `actions: write`. A failed or timed-out cycle exits once. Mainnet manual and scheduled execution both require `V5_WATCHER_MAINNET_ENABLED=true` and `V5_WATCHER_MAINNET_RECOVERY_APPROVED=true`.

The keeper supervisor writes `/data/keeper-v5-rpc-incident.json` and stops without restart on quota/budget/state failures. It refuses to start while that file exists.

### F-4: uncontrolled paid fallback

Closed. Watcher roles are explicit. Discovery and independent log failures never fall back. The indexer rejects `RPC_URL_FALLBACK`, rejects direct Alchemy endpoints and pins production canonical/log endpoints in Fly configuration.

### F-5: incomplete billed-attempt telemetry

Closed at the paid boundary. Ethers transport retries are disabled. Reservations count each JSON-RPC batch item before the one permitted wire attempt. `/healthz` reports role usage, latch state and state hash without secrets.

### F-6: recursive checkpoint replay

Closed by deleting recursive bisection in watcher and indexer paths. Provider capability is a reviewed fixed window. Each successful watcher window is atomically checkpointed; a failure leaves the cursor on that exact window. Regression tests prove completed windows are not replayed after restart and indexer range failure does not advance its cursor.

### F-7: secondary consumers and credentials

- protocol monitor: hard-pinned to public QuickNode; reports hostname only;
- mainnet fork CI: public qualified Goldsky;
- indexer claim-proof reader: public canonical endpoint with hidden retries disabled;
- Hardhat deploy/migration: rejects raw Alchemy;
- mainnet indexer: public QuickNode plus Tenderly; fallback unset and rejected;
- watcher: QuickNode/Tenderly/Goldsky only;
- keeper: QuickNode reads/reconstruction and Tenderly logs; scoped gateway for writes. Watcher security reconstruction remains independently sourced from Goldsky;
- legacy keeper/watcher: no live app is authorized; old credentials must be removed in the rollout;
- manual tools: raw provider URL is not distributed. Use public endpoints or a scoped, time-bounded gateway token.

## Workload estimate

Steady state has zero Alchemy log or historical-read load.

- indexer: 15-second polling, one combined-address Tenderly log window plus public canonical boundary/hash reads; paid CU = 0;
- watcher: four scheduled runs/hour, approximately one or two Goldsky log windows per run plus public canonical hashes; paid CU = 0;
- root proposal/finalization: weekly historical reconstruction on Goldsky; paid CU = 0;
- fork CI: manual public Goldsky run; paid CU = 0;
- keeper: minute reads and root reconstruction are public. Only transaction-triggered nonce/fee/estimate/send/receipt calls use the gateway. Even 100 conservatively charged 1,000-CU calls per draw are about 100,000 CU/week;
- deployment: manually invoked and capped at 3M CU.

The conservative 15M gateway ceiling is therefore a catastrophe boundary, not an expected spend target.

## Reproducible tests

From the reviewed commit:

```bash
npm ci
npm run rpc:incident:test
npm run draw:watch:test
npm run keeper:v5:test

npm --prefix scripts/indexer ci
npm --prefix scripts/indexer test
npm --prefix scripts/indexer run build

npm run rpc:qualify:mainnet
```

Required regression coverage includes provider-role isolation, one outbound attempt, batch-item accounting, restart persistence, critical-reserve isolation, corruption/lock fail-closed behavior, quota latch, watcher fixed-window resume, in-flight reorg rejection, participant transfer completeness and indexer cursor preservation.

## Bounded rollout

### 0. Keep containment

Do not restart `everdraw-keeper-v5-mainnet`. Keep `V5_WATCHER_MAINNET_ENABLED=false` and `V5_WATCHER_MAINNET_RECOVERY_APPROVED=false`.

### 1. Independent review

Auditor reviews the PR head, CI artifact and this runbook. Record the approved immutable commit. Do not accept a later mutable branch head.

### 2. Credential closure and gateway preparation

After approval:

1. create the gateway Fly app and persistent volume;
2. copy the reviewed budget config to `/data`, replacing the placeholder period ID with the explicit provider billing period;
3. record the reviewed config SHA-256 as `RPC_BUDGET_CONFIG_SHA256` and initialize the ledger with `RPC_BUDGET_CONFIRM="INITIALIZE <period>"`;
4. set only the gateway secrets: raw paid upstream URL and role-token JSON;
5. rotate the Alchemy credential;
6. remove the old raw credential from keeper, indexer, watcher Actions secrets, protocol monitor, fork workflow and operator shell files;
7. issue distinct random tokens for keeper/deployment/CI; do not reuse them;
8. point keeper `RPC_URL` to `https://everdraw-rpc-egress-mainnet.fly.dev/rpc/keeper-write`.

Verify `/healthz`, state hash, zero usage and auto-stop behavior. Do not start keeper.

### 3. Indexer canary

Deploy indexer routing only. It is already running, so use rolling deployment. Confirm for 24-48 hours:

- cursor advances and lag remains bounded;
- no fallback is configured;
- `rpc.monad.xyz` supplies canonical reads;
- Tenderly supplies combined-address logs;
- Alchemy dashboard remains flat;
- no secrets appear in logs.

Rollback: restore the previous indexer image while retaining public canonical/Tenderly secrets. Never restore raw paid fallback.

### 4. Authorized watcher catch-up

Only after auditor authorization:

1. confirm `V5_WATCHER_MAINNET_ENABLED=false`;
2. set public/Tenderly endpoints and reviewed cache key;
3. set `V5_WATCHER_MAINNET_RECOVERY_APPROVED=true`;
4. set `V5_WATCHER_MAINNET_ENABLED=true`;
5. dispatch exactly one run;
6. verify the cursor advances by no more than `WATCHER_MAX_BLOCKS_PER_RUN=250000`;
7. inspect the qualification/canonical evidence and root result before another run.

If any endpoint disagrees, any window is incomplete, or veto time is insufficient: disable both variables, preserve caches/artifacts and do not advance or report healthy.

### 5. Security coverage

Before keeper restart, require:

- watcher fully caught up with no unacknowledged gap;
- every observed proposal reconstructed to the same root;
- participant set includes historical deposits and transfers;
- canonical boundary/log hashes match;
- dead-man health is green;
- veto alert and operator path remain available;
- paid ledger is healthy and critical reserve untouched.

### 6. Coordinated keeper restart

Requires a separate auditor approval. Remove any persistent keeper RPC incident latch only after recording its contents and the approved state hash. Start one keeper machine. Observe a complete lifecycle before declaring recovery.

## Rollback

At any stage:

1. stop the keeper;
2. set both watcher enable/recovery variables false;
3. preserve watcher caches, indexer DB and gateway ledger;
4. revoke the affected scoped token, not the account-wide provider key;
5. roll back the application image;
6. do not clear budget or quota latches;
7. resume only from a new recorded auditor approval.

Unknown, stale or unverifiable state is unhealthy. An RPC error is never interpreted as zero logs.
