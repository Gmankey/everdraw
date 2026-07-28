# EverDraw V5 mainnet deployment execution

**Implements:** ADR-0042, ADR-0043, ADR-0045.

This is the executable companion to `tasks/v5-mainnet-deploy-runbook.md`. The operator runs all
signer-bearing commands. Builders and reviewers do not receive or inspect keys.

## 1. Required operator inputs

- `MONAD_MAINNET_RPC_URL`: paid archive-capable Monad mainnet RPC
- `GUARDIAN`: final guardian address
- `PAUSER`: final pauser address
- `KEEPER`: primary proposer address used by the managed V5 keeper
- keeper alert destinations: Telegram bot/chat and an independent dead-man failure URL

The deploy script locks these accepted parameters:

- chain id `143`
- real mainnet shMON `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
- mainnet Pyth Entropy `0xD458261E832415CFd3BAE5E416FdF3230ce6F134`
- mainnet Pyth provider `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`
- deposit cap `25,000 MON`
- minimum deposit `0`
- weekly TWAB and draw periods
- launch-block-derived TWAB offset and first period start
- default minimum prize threshold `0.001 shMON`

`TWAB_PERIOD_LENGTH_SEC`, `DRAW_PERIOD_SEC`, `TWAB_PERIOD_OFFSET`, and `FIRST_PERIOD_START` must
not be supplied. The script derives cadence from the launch block and rejects overrides.

## 2. Source and local gates

Use a clean `staging` checkout at `origin/staging`.

```bash
git fetch origin staging
git checkout staging
git pull --ff-only origin staging
git status --short

npm ci
npm run deploy:preflight
npm run build
npm run check:abi
node --test scripts/deploy-v5-mainnet.unit.test.mjs
```

Stop on any failure.

## 3. Read-only mainnet dependency preflight

```bash
export MONAD_MAINNET_RPC_URL="<paid archive RPC>"
export SHMON="0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c"
export ENTROPY="0xD458261E832415CFd3BAE5E416FdF3230ce6F134"
export ENTROPY_PROVIDER="0x52DeaA1c84233F7bb8C8A45baeDE41091c616506"
export GUARDIAN="<final guardian>"
export PAUSER="<final pauser>"
export KEEPER="<primary proposer>"
export DEPLOY_COMMIT="$(git rev-parse HEAD)"

read -s -p "Deployer private key: " PRIVATE_KEY
echo
export PRIVATE_KEY

HARDHAT_NETWORK=monadMainnet \
  HARDHAT_CONFIG=hardhat.v5-mainnet.config.js \
  node scripts/deploy-v5-mainnet.js --preflight-only

unset PRIVATE_KEY
```

This sends no transaction. It verifies chain `143`, deployed code at shMON/Pyth, the shMON
ERC-4626 read surface, Pyth provider fee reads, fixed launch parameters, source branch and signer
availability.

## 4. Deploy and queue the DrawManager

Repeat the exports and interactive `read -s` from step 3, then:

```bash
npx hardhat run scripts/deploy-v5-mainnet.js \
  --config hardhat.v5-mainnet.config.js \
  --network monadMainnet

DEPLOY_EXIT=$?
unset PRIVATE_KEY
echo "Deploy exit: $DEPLOY_EXIT"
```

The script:

1. Runs source preflight before any transaction.
2. Deploys TWAB, strategy, vault, ClaimManager, consumer-bound Pyth oracle and DrawManager.
3. Wires strategy, TWAB registration, ClaimManager authorization/compound vault and pauser.
4. Sets the `0.001 shMON` dust threshold.
5. Queues the DrawManager through the 24-hour vault timelock.
6. Verifies every immutable/wiring relationship and all three payout/share tokens.
7. Compares live runtime bytecode with local Hardhat artifacts, normalizing immutable slots.
8. Appends the deployment to `deployments/monad-mainnet.json`.
9. Runs the existing manifest bytecode check before printing addresses.

Commit and merge the generated deployment record before the activation transaction. Do not point
the keeper, indexer or frontend at the queued stack.

## 5. Commit after 24 hours

After `pendingDrawManagerEffectiveAt`:

```bash
git fetch origin staging
git checkout staging
git pull --ff-only origin staging

export MONAD_MAINNET_RPC_URL="<paid archive RPC>"
read -s -p "Deployer private key: " PRIVATE_KEY
echo
export PRIVATE_KEY

HARDHAT_NETWORK=monadMainnet \
  HARDHAT_CONFIG=hardhat.v5-mainnet.config.js \
  node scripts/deploy-v5-mainnet.js --commit

COMMIT_EXIT=$?
unset PRIVATE_KEY
echo "Commit exit: $COMMIT_EXIT"
```

The commit path verifies the queued address and owner before sending, refuses an early commit, then
rechecks the complete wiring after `vault.drawManager()` changes. Commit the appended activation
record.

## 6. Managed keeper

Create the independent mainnet app and persistent cache once:

```bash
flyctl apps create everdraw-keeper-v5-mainnet
flyctl volumes create everdraw_keeper_v5_mainnet_cache \
  --app everdraw-keeper-v5-mainnet --region sjc --size 1
```

Set all runtime targets and secrets together:

```bash
flyctl secrets set -a everdraw-keeper-v5-mainnet \
  RPC_URL="<paid mainnet RPC>" \
  PRIVATE_KEY="<primary proposer key>" \
  DRAW_MANAGER_ADDRESS="<committed DrawManager>" \
  CLAIM_MANAGER_ADDRESS="<ClaimManager>" \
  V5_KEEPER_FROM_BLOCK="<fresh V5 deploy block>" \
  TELEGRAM_BOT_TOKEN="<operator token>" \
  TELEGRAM_CHAT_ID="<operator chat>" \
  KEEPER_HEALTHCHECK_FAIL_URL="<dead-man failure URL>"
```

Deploy from repository root:

```bash
flyctl deploy . -c scripts/keeper/fly.v5.mainnet.toml --ha=false
flyctl status -a everdraw-keeper-v5-mainnet
```

Force one machine restart and confirm it resumes from `/data/keeper-v5-event-cache.json`. Trigger
one low-balance warning and one repeated-exit alert before opening deposits.

## 7. Cutover gate

Only after the committed on-chain wiring, keeper restart/alerts, production indexer backfill,
V4.1-B dual-serving and production bundle verification may the frontend be pointed at V5.
