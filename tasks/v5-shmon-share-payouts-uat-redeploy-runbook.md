# V5 ADR-0045 UAT redeploy runbook

This deploys a fresh Monad testnet V5 stack with shMON-share-denominated prizes and share-only
withdrawals. It never targets production.

## A. Preconditions

- ADR-0045 PR and PR #230 are merged to staging.
- The operator has the deployer signer locally. Enter it only through read -s. Never paste it into
  chat, commit it, or store it as a standing environment variable.
- Builder and PM do not handle the key.

## B. Fresh full-stack deploy (operator signer required)

Run in a clean checkout of merged staging:

    git fetch origin staging
    git checkout staging
    git pull --ff-only origin staging
    git status
    git log -1 --oneline

    npm ci

    export MONAD_TESTNET_RPC_URL="https://testnet-rpc.monad.xyz"
    export GUARDIAN="0xd5cc1f1D7b78943bDF09541A2ace41B5c6D83431"
    export KEEPER="0x629Bd7f323fD29E3dF75855C9BC542889c6c1268"
    export TWAB_PERIOD_LENGTH_SEC=3600
    export DRAW_PERIOD_SEC=3600
    export FIRST_PERIOD_DELAY_SEC=0
    export DEPLOY_COMMIT="$(git rev-parse HEAD)"

    read -s -p "Deployer private key: " PRIVATE_KEY
    echo
    export PRIVATE_KEY
    npx hardhat compile
    npx hardhat run scripts/deploy-v5-testnet.js --network monadTestnet
    DEPLOY_EXIT=$?
    unset PRIVATE_KEY

    if [ "$DEPLOY_EXIT" -ne 0 ]; then
      echo "DEPLOY FAILED with exit code $DEPLOY_EXIT"
    else
      echo "DEPLOY COMPLETED"
    fi

Paste only non-secret output. It must report six addresses, the deploy block, pendingDrawManager,
and pendingDrawManagerEffectiveAt. The script verifies:

- vault.pendingDrawManager() == new DrawManager
- claimManager.compoundVaultFor(new DrawManager) == new vault
- vault.payoutToken() == shMON
- drawManager.payoutToken() == shMON

Do not re-point any service before the timelock commit.

## C. Commit after the 24-hour vault timelock (operator signer required)

After the printed effective time:

    cd /path/to/the/merged-staging-checkout
    export MONAD_TESTNET_RPC_URL="https://testnet-rpc.monad.xyz"

    read -s -p "Deployer private key: " PRIVATE_KEY
    echo
    export PRIVATE_KEY
    HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit
    COMMIT_EXIT=$?
    unset PRIVATE_KEY

    if [ "$COMMIT_EXIT" -ne 0 ]; then
      echo "COMMIT FAILED with exit code $COMMIT_EXIT"
    else
      echo "COMMIT COMPLETED"
    fi

The commit must verify vault.drawManager() == new DrawManager. Paste only that output.

## D. Re-point UAT services (no signer key)

Use the addresses and deploy block from Step B.

Keeper secrets:

    flyctl secrets set -a everdraw-keeper-v5       DRAW_MANAGER_ADDRESS=<DRAW_MANAGER>       CLAIM_MANAGER_ADDRESS=<CLAIM_MANAGER>       V5_KEEPER_FROM_BLOCK=<DEPLOY_BLOCK>

Indexer secrets:

    flyctl secrets set -a everdraw-indexer-uat       POOL_ADDRESSES=<PRIZE_VAULT>,<DRAW_MANAGER>,<CLAIM_MANAGER>       START_BLOCK=<DEPLOY_BLOCK>

The indexer scan cursor is scoped to the configured pool-address set. A new stack therefore starts
at START_BLOCK automatically while historical tables remain intact. Do not delete the persistent
database; frontend and API rows are scoped by vault.

Set these four variables on the existing everdraw-v5-uat Vercel project and redeploy that same
project:

    VITE_V5_PRIZE_VAULT_ADDRESS=<PRIZE_VAULT>
    VITE_V5_DRAW_MANAGER_ADDRESS=<DRAW_MANAGER>
    VITE_V5_CLAIM_MANAGER_ADDRESS=<CLAIM_MANAGER>
    VITE_V5_TWAB_CONTROLLER_ADDRESS=<TWAB_CONTROLLER>

Never update the production everdraw Vercel project or everdraw.xyz.

## E. Live acceptance

1. Verify keeper and indexer health, force-restart the keeper once, and confirm it resumes.
2. Deposit on UAT and verify History shows only participated draws.
3. Inject test yield into the UAT strategy using the approved testnet yield lever.
4. Observe startDraw: ClaimManager shMON balance increases and native balance does not.
5. Complete seed, root, finalize, and claim.
6. Verify PrizeCompounded credits a fresh vault tranche and transfers no native MON.
7. Both withdrawal choices must call withdrawShmon, or boostWithdrawShmon in Patron Pool. The
   convert choice must show exactly:
   You'll receive shMON now. Convert to MON on shmonad.xyz — unstaking takes ~18–22 hours.
   It must open shmonad.xyz after confirmation.
8. Re-verify PR #230 live: Stats, Leaderboard, and Your Points navigation; one unified Connect
   modal; friendly RPC retry behavior; History excludes draws with no active position.

The real-mainnet shMON fork suite requires an archive RPC. Public rpc.monad.xyz is not archive
capable and returns NotActivated for historical state.