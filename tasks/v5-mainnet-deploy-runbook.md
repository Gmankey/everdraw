# Runbook - EverDraw V5 mainnet deploy and cutover

**Implements:** V5 launch readiness, ADR-0042 owner-surface hardening, ADR-0043 prize auto-compound.

**Scope:** mainnet deployment plan for chain `143`. This runbook is operational documentation only. Do not run any live-network command from a builder session. The operator runs signer-bearing steps in their own terminal.

**Hard rule:** do not copy the UAT hourly settings. Mainnet V5 uses weekly draw/TWAB cadence.

## Current blocker before execution

The checked-in `scripts/deploy-v5-testnet.js` is explicitly testnet-only and refuses any network except `monadTestnet`. Before this runbook can be executed, a reviewed mainnet V5 deploy script must exist, or the testnet script must be deliberately generalized in a separate PR with mainnet guards.

The mainnet deploy script must:

- require `--network monadMainnet` and verify chain id `143`
- write to `deployments/monad-mainnet.json`, not `deployments/monad-testnet.json`
- use real mainnet shMON and real mainnet Pyth Entropy addresses
- set weekly cadence values, not UAT hourly values
- record constructor args, deploy txs, start block, runtime bytecode hashes, and verification status
- never read, print, derive, or enumerate private keys outside Hardhat's signer mechanism

## Signer vs config matrix

| Step | Needs signer key? | Notes |
|---|---:|---|
| Source preflight and build | No | Pure local checks |
| Contract deployment | Yes | Deployer/owner key; operator only |
| `queueDrawManagerChange` / `commitDrawManagerChange` | Yes | Vault owner key; timelocked by ADR-0042 |
| Keeper Fly deployment | No deploy key, yes keeper secret | `PRIVATE_KEY` is set as Fly secret by operator only |
| Indexer deployment/backfill | No | Infra config only |
| Frontend cutover | No | Vercel config/build only |
| Read-only verification | No | Use RPC/cast/curl without secrets |

## Mainnet parameters

Confirm these before deployment and copy the final values into `deployments/monad-mainnet.json`.

| Parameter | Mainnet value / decision |
|---|---|
| Chain | Monad mainnet, chain id `143` |
| shMON | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` from existing mainnet records; verify before execution |
| Pyth Entropy | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` from existing mainnet records; re-confirm against current Pyth/Monad docs before execution |
| Pyth provider | `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506` from existing mainnet records; re-confirm before execution |
| `TWAB_PERIOD_LENGTH_SEC` | `604800` (weekly; do not use UAT `3600`) |
| `DRAW_PERIOD_SEC` | `604800` (weekly; must be a multiple of TWAB period) |
| `TWAB_PERIOD_OFFSET` | explicit launch anchor chosen by operator; must align with `FIRST_PERIOD_START` |
| `FIRST_PERIOD_START` | explicit weekly boundary, not an implicit immediate start |
| Deposit cap | `25000` MON, approved in `tasks/v5-launch-params-operator-approved.md` |
| Minimum deposit | operator must explicitly decide before deploy. If no product/legal decision exists, leave contract min at `0` and rely on UI copy only; do not invent a hard min in the deploy script |
| Guardian | operator-approved guardian address |
| Keeper/proposer | primary proposer address used by managed V5 keeper |
| Pauser | operator-approved pauser, or owner only if deliberately accepted |

## Step 0 - Source freeze

Operator starts from the production branch only:

```bash
git fetch origin staging
git checkout staging
git pull --ff-only origin staging
git status --short
```

Expected: clean worktree on `staging` and HEAD equal to `origin/staging`.

Run source gates:

```bash
npm run deploy:preflight
npm run build
npm run check:abi
```

If any gate fails, stop. Do not deploy from a local branch, dirty worktree, backup folder, or historical worktree.

## Step 1 - Prepare mainnet deployment env

Signer-bearing commands are run by the operator only. Use an interactive shell or the operator's normal secret manager. Do not persist deployer keys in `.env` files shared with agents.

Example non-secret env shape:

```bash
export MONAD_MAINNET_RPC_URL="<paid mainnet RPC>"
export SHMON="0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c"
export ENTROPY="0xD458261E832415CFd3BAE5E416FdF3230ce6F134"
export ENTROPY_PROVIDER="0x52DeaA1c84233F7bb8C8A45baeDE41091c616506"
export GUARDIAN="<operator-approved guardian>"
export KEEPER="<primary proposer address>"
export PAUSER="<operator-approved pauser>"
export TWAB_PERIOD_LENGTH_SEC=604800
export DRAW_PERIOD_SEC=604800
export TWAB_PERIOD_OFFSET="<weekly anchor unix>"
export FIRST_PERIOD_START="<weekly anchor unix>"
export DEPOSIT_CAP_MON=25000
export DEPLOY_COMMIT="$(git rev-parse HEAD)"
```

If a min deposit is approved, it must be an explicit env/config input and a post-deploy owner transaction. Do not silently hardcode it.

## Step 2 - Deploy V5 contracts

Blocked until a reviewed mainnet V5 deploy script exists. The intended invocation shape is:

```bash
npx hardhat run scripts/deploy-v5-mainnet.js --network monadMainnet
```

The deploy script should deploy and wire:

1. `EverdrawTwabController(TWAB_PERIOD_LENGTH_SEC, TWAB_PERIOD_OFFSET)`
2. `ShmonStrategy(realShmon)`
3. `PrizeVaultV5(twab, strategy, depositCap, symbol)`
4. `ClaimManagerV5()`
5. `PythRandomnessOracle(entropy, provider, predictedDrawManager)`
6. `DrawManagerV5(vault, twab, claimManager, oracle, guardian, keeper, firstPeriodStart, drawPeriod, proposerGrace, challengeWindow)`

Then setup:

1. `strategy.setVault(vault)`
2. `twab.registerVault(vault)`
3. `claimManager.setAuthorizedSource(drawManager, true)`
4. `claimManager.setCompoundVault(drawManager, vault)` for ADR-0043 auto-compound
5. optional `vault.setPauser(pauser)` if approved
6. optional `vault.setMinDeposit(minDeposit)` only if explicitly approved

Do not open deposits until the draw manager is active and verified.

## Step 3 - Activate draw manager through the ADR-0042 timelock

`PrizeVaultV5.setDrawManager(address)` is now a queue alias, not an instant switch. Mainnet activation is two transactions separated by the delay.

Queue:

```bash
cast send <PRIZE_VAULT> "queueDrawManagerChange(address)" <DRAW_MANAGER> --rpc-url "$MONAD_MAINNET_RPC_URL"
```

Read the queued state:

```bash
cast call <PRIZE_VAULT> "pendingDrawManager()(address)" --rpc-url "$MONAD_MAINNET_RPC_URL"
cast call <PRIZE_VAULT> "pendingDrawManagerEffectiveAt()(uint64)" --rpc-url "$MONAD_MAINNET_RPC_URL"
```

Wait until `pendingDrawManagerEffectiveAt` has passed. Then commit:

```bash
cast send <PRIZE_VAULT> "commitDrawManagerChange()" --rpc-url "$MONAD_MAINNET_RPC_URL"
```

Verify:

```bash
cast call <PRIZE_VAULT> "drawManager()(address)" --rpc-url "$MONAD_MAINNET_RPC_URL"
cast call <PRIZE_VAULT> "pendingDrawManager()(address)" --rpc-url "$MONAD_MAINNET_RPC_URL"
cast call <PRIZE_VAULT> "pendingDrawManagerEffectiveAt()(uint64)" --rpc-url "$MONAD_MAINNET_RPC_URL"
```

Expected: `drawManager` equals the new V5 draw manager, pending address is zero, pending time is zero.

## Step 4 - Verify deployment record and bytecode

Update `deployments/monad-mainnet.json` in the same style as prior records. Required fields:

- contract role and status
- address, source path, ABI path
- constructor args
- deploy tx and deploy block
- compiler settings
- runtime bytecode SHA256
- verification evidence/status
- start block for keeper/indexer backfill

Run:

```bash
npm run check:bytecode -- deployments/monad-mainnet.json
```

If bytecode verification fails, stop. Do not cut over keeper, indexer, or frontend.

## Step 5 - Managed V5 keeper on Fly

Do not run the mainnet keeper by hand in a terminal. Use the managed V5 keeper pattern from `scripts/keeper/fly.v5.uat.toml`, adapted to a separate mainnet app so V4.1-B and V5 are independently deployable.

Recommended app: `everdraw-keeper-v5-mainnet`.

Mainnet keeper config must include:

```toml
[env]
NODE_ENV = "production"
RPC_URL = "<paid mainnet RPC>"
DRAW_MANAGER_ADDRESS = "<V5_DRAW_MANAGER>"
CLAIM_MANAGER_ADDRESS = "<V5_CLAIM_MANAGER>"
V5_KEEPER_FROM_BLOCK = "<deployment startBlock>"
DEPLOYMENT_FILE = "deployments/monad-mainnet.json"
KEEPER_LOOP = "true"
KEEPER_INTERVAL_MS = "60000"
KEEPER_RECENT_CLAIM_WINDOW = "1000"
KEEPER_PREFLIGHT = "true"
KEEPER_LOW_BALANCE_MON = "<operator threshold>"
KEEPER_ERROR_ALERT_THRESHOLD = "<operator threshold>"
KEEPER_HEARTBEAT_LOG_EVERY_TICKS = "<operator threshold>"
```

Set the proposer key only as a Fly secret:

```bash
flyctl secrets set -a everdraw-keeper-v5-mainnet PRIVATE_KEY=0x<primary-proposer-key>
```

Deploy from repo root:

```bash
flyctl deploy . -c scripts/keeper/fly.v5.mainnet.toml --ha=false
```

Verification:

```bash
flyctl status -a everdraw-keeper-v5-mainnet
flyctl logs -a everdraw-keeper-v5-mainnet -f
```

Confirm startup logs show mainnet chain, V5 draw manager, V5 claim manager, loop mode, and preflight success. Force a Fly machine restart before launch signoff and confirm the keeper resumes without human intervention.

## Step 6 - Mainnet indexer cutover

V5 needs the V5 event ingestion and tranche ledger. Production indexer must dual-serve V4.1-B during sunset; do not drop the old pool until V4.1-B is drained.

Configure mainnet indexer with V5 addresses and backfill start block:

```bash
flyctl secrets set -a everdraw-indexer \
  POOL_ADDRESSES="<V4_1_B_POOL>,<V5_PRIZE_VAULT>,<V5_DRAW_MANAGER>,<V5_CLAIM_MANAGER>" \
  START_BLOCK="<V5 deployment startBlock>"
```

Verification:

```bash
curl -s https://<production-indexer-health>/api/health
flyctl logs -a everdraw-indexer -f
```

Confirm V5 `Deposit`, `Withdraw`, `BoostDeposit`, `BoostWithdraw`, draw lifecycle, `ClaimPaid`, and `PrizeCompounded` rows are ingested. Confirm a sample wallet's tranche ledger and position history match on-chain events.

## Step 7 - Frontend cutover on production Vercel

Production frontend is the canonical `everdraw` Vercel project and production branch is `staging`. Do not use UAT project settings for production.

Set production env values:

- V5 prize vault address
- V5 draw manager address
- V5 claim manager address
- V5 TWAB controller address
- production V5 indexer URL
- Monad mainnet chain id `143`
- PostHog envs if operator chooses to activate analytics

Redeploy from `staging`. Vite bakes `VITE_*` values into the bundle, so changing env vars alone is not enough.

Verification:

```bash
curl -s https://everdraw.xyz/ | grep -o 'assets/index-[^" ]*\.js' | head -1
# Fetch the bundle and confirm mainnet V5 addresses are present.
```

Then verify in the live app:

- chain is Monad mainnet `143`
- vault reads the V5 prize vault
- deposit/withdraw use the V5 vault
- Patron pool uses `boostDeposit` / `boostWithdraw`
- claim UI scans all unclaimed finalized prizes
- points profile shows V5 entries/recent draws/Patron source
- V4.1-B remains accessible only as the approved sunset/previous-vault flow

## Step 8 - Launch monitoring

Before opening deposits, confirm alerts are live for:

- keeper liveness and crash loop
- keeper proposer balance
- RPC failure rate
- indexer lag
- queued draw-manager and strategy changes
- ownership transfer
- pause/stop
- cap/min-deposit changes
- vault solvency/shortfall

Run one low-balance alert test on the keeper app and confirm the alert reaches the expected channel.

## Step 9 - Final launch gate

Do not announce or route real users until all are true:

- deployment record committed
- bytecode verified
- `drawManager()` active after timelock commit
- keeper managed service survives restart
- indexer backfilled and serving V5 events
- frontend live bundle contains mainnet V5 addresses
- deposit cap reads `25000 MON`
- min deposit matches explicit operator decision
- security review decision is recorded
- first controlled deposit/withdraw smoke passes

## Rollback

If the issue is before user deposits: pause the vault and stop frontend cutover.

If the issue is draw-manager related: use the ADR-0042 queue/commit flow to move to the intended manager. There is no instant mainnet switch.

If the issue is keeper/indexer/frontend config: roll back the relevant Fly/Vercel deployment. Contract state remains the source of truth.

Never delete deployment records. Append superseding records and mark the old entry's status.

## External dependencies

- **Monad mainnet RPC:** deploy, keeper, indexer, and frontend reads. Launch requires a paid/reliable RPC plan; free-tier public RPC is not enough for production traffic.
- **shMON:** real mainnet ERC-4626 yield source. If shMON deposit/withdraw is degraded, EverDraw deposits/withdrawals may fail or defer.
- **Pyth Entropy:** draw randomness. If unavailable, draws wait/recover through configured draw-manager paths; principal remains separate.
- **Fly:** keeper/indexer hosting. Failure delays automation/backfill but does not move funds.
- **Vercel:** frontend hosting. Failure blocks UI cutover, not contracts.
- **Blockaid/MetaMask allowlisting:** submit verified mainnet contracts before public launch to reduce wallet warning friction.
- **Operator signer custody:** owner/deployer and keeper proposer keys must stay outside agent-accessible environments.