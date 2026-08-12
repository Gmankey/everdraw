# V5 six-hour final-bytecode UAT activation runbook

**Decisions:** ADR-0036, ADR-0037, ADR-0042, ADR-0043, ADR-0045.

Use this only after the timelocked cadence-governance PR is merged to `staging`. The current
hourly UAT stack remains halted and must not be funded again. This flow deploys a fresh full stack
at six-hour cadence so the final soak starts from clean state and final bytecode.

## A. Fresh deploy and vault queue (operator signer required)

In a clean checkout of merged `staging`:

```bash
git fetch origin staging
git checkout staging
git pull --ff-only origin staging
git status
git log -1 --oneline
npm ci

export MONAD_TESTNET_RPC_URL="https://testnet-rpc.monad.xyz"
export SHMON="0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9"
export ENTROPY="0x825c0390f379c631f3cf11a82a37d20bddf93c07"
export ENTROPY_PROVIDER="0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344"
export PAUSER="0xd5cc1f1D7b78943bDF09541A2ace41B5c6D83431"
export GUARDIAN="0xd5cc1f1D7b78943bDF09541A2ace41B5c6D83431"
export KEEPER="0x629Bd7f323fD29E3dF75855C9BC542889c6c1268"
export TWAB_PERIOD_LENGTH_SEC=3600
export DRAW_PERIOD_SEC=21600
export FIRST_PERIOD_DELAY_SEC=0
export DEPLOY_COMMIT="$(git rev-parse HEAD)"

read -s -p "Deployer private key: " PRIVATE_KEY
echo
export PRIVATE_KEY
npx hardhat compile
npx hardhat run scripts/deploy-v5-testnet.js --network monadTestnet
DEPLOY_EXIT=$?
unset PRIVATE_KEY
echo "Deploy exit: $DEPLOY_EXIT"
```

The output must show six new addresses, the deploy block, and the vault's pending DrawManager
effective time. Verify before stopping:

- `drawPeriod() == 21600`;
- `oracle.consumer() == new DrawManager`;
- `vault.pendingDrawManager() == new DrawManager`;
- `drawManager.claimManager() == new ClaimManager`;
- `drawManager.randomnessOracle() == new oracle`;
- `claimManager.compoundVaultFor(new DrawManager) == new vault`;
- `claimManager.authorizedSource(new DrawManager) == true`.

Commit the generated `deployments/monad-testnet.json` record through a PR. Do not re-point any
service yet.

## B. Activate after the 24-hour vault timelock (operator signer required)

After the exact printed effective time:

```bash
read -s -p "Deployer private key: " PRIVATE_KEY
echo
export PRIVATE_KEY
HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit
COMMIT_EXIT=$?
unset PRIVATE_KEY
echo "Commit exit: $COMMIT_EXIT"
```

Require `vault.drawManager() == new DrawManager` before continuing.

## C. Re-point and fund once

Re-point the managed keeper, UAT indexer, independent watcher, and the existing
`everdraw-v5-uat` Vercel project to the new addresses and fresh deploy block. Re-enable
`KEEPER_HEALTHCHECK_URL`. Never touch the production Vercel project.

Calculate seven days of six-hour oracle fees and observed gas, then add at least 50% margin. Fund
the keeper once to that opening balance and record the transaction in the soak evidence. Populate
participant and Patron positions and inject enough approved test yield for at least 24 paying
draws.

The soak clock begins only after every precondition in
`tasks/v5-final-uat-soak-runbook.md` is verified.

