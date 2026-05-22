# V3 Testnet Deploy + Smoke Ticket

References: ADR-0014, ADR-0015

## Address Resolution

- Monad testnet chainId: `10143`
- Pyth Entropy contract: `0x825c0390f379c631f3cf11a82a37d20bddf93c07`
  - Source: Pyth Entropy testnet chain config endpoint, `monad-testnet` entry.
  - On-chain code was present on `https://testnet-rpc.monad.xyz`.
- Pyth default entropy provider: `0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344`
  - Confirmed by calling `getDefaultProvider()` against the Entropy contract on Monad testnet.
- shMON testnet: `0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9`
  - Confirmed on-chain on `https://testnet-rpc.monad.xyz`: runtime code present, `name() = ShMonad`, `symbol() = shMON`, and `previewDeposit(0.01 MON)` returns nonzero shares.

## Local .env

Do not commit `.env` or the deployer private key.

~~~bash
# V3 testnet deploy
SHMON=0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9
ENTROPY=0x825c0390f379c631f3cf11a82a37d20bddf93c07
ENTROPY_PROVIDER=0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344
TICKET_PRICE_MON=0.01
ROUND_DURATION_SEC=120
YIELD_PERIOD_SEC=300
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
PRIVATE_KEY=<deployer key>
~~~

Use short durations on testnet so the smoke test completes in minutes, not days. The V3 deploy script defaults to `ROUND_DURATION_SEC=120` and `YIELD_PERIOD_SEC=300` on `monadTestnet`; mainnet defaults remain production cadence.

## Deploy

~~~bash
npm run deploy:testnet:v3
~~~

Immediately seed VRF reserve (testnet Pyth fee is ~0.148 MON/request — seed 0.5 MON for headroom):

~~~bash
cast send <deployed_addr> "depositVRFReserve()" \
  --value 0.5ether \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $PRIVATE_KEY
~~~

Then ensure the deployer can drive the round:

~~~bash
cast send <deployed_addr> "setKeeper(address,bool)" <deployer_addr> true \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $PRIVATE_KEY
~~~

Record the testnet deployment in `deployments/monad-testnet.json`. Do not update `deployments/monad-mainnet.json` for a testnet deploy.

## Manual Smoke Test

Run each step and confirm the emitted event before proceeding.

Common args:

~~~bash
export ADDR=<deployed_addr>
export RPC_URL=https://testnet-rpc.monad.xyz
~~~

1. Buy one ticket.

~~~bash
cast send $ADDR "buyTickets(uint32)" 1 \
  --value 0.01ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
~~~

Expect `TicketsBought`.

2. Wait for `salesEndTime + yieldPeriodSec`, then commit.

~~~bash
cast send $ADDR "commitDraw(uint256)" 1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
~~~

Expect `VRFRequested`.

3. Wait for Pyth callback and poll until drawn.

~~~bash
cast call $ADDR "getRoundState(uint256)" 1 --rpc-url $RPC_URL
~~~

Expect `2` (`RoundState.Drawn`).

4. Finalize.

~~~bash
cast send $ADDR "finalizeDraw(uint256)" 1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
~~~

Expect `WinnerDrawn` and `RoundSettled`.

5. Claim prize. Deployer is the sole depositor, so deployer should also be the winner.

~~~bash
cast send $ADDR "claimPrize(uint256)" 1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
~~~

Expect `PrizeClaimed`.

6. Withdraw principal.

~~~bash
cast send $ADDR "withdrawPrincipal(uint256)" 1 \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
~~~

Expect `PrincipalWithdrawn`.

## Automated Smoke Runner

The manual cast sequence is the required smoke evidence. The repo also includes an automated runner for repeatability:

~~~bash
export POOL_ADDRESS=<deployed-v3-pool>
export VRF_RESERVE_MON=0.5
export SMOKE_TICKET_COUNT=1

npm run smoke:testnet:v3
~~~

The runner executes: `depositVRFReserve -> buyTicketsMON -> commitDraw -> wait for Drawn -> finalizeDraw -> claimPrize -> withdrawPrincipal`.

## Post-Deploy Verification

Run and attach the output:

~~~bash
cast call $ADDR "ticketPriceMON()(uint96)" --rpc-url $RPC_URL
cast call $ADDR "roundDurationSec()(uint32)" --rpc-url $RPC_URL
cast call $ADDR "yieldPeriodSec()(uint32)" --rpc-url $RPC_URL
cast call $ADDR "shmon()(address)" --rpc-url $RPC_URL
cast call $ADDR "entropy()(address)" --rpc-url $RPC_URL
cast call $ADDR "entropyProvider()(address)" --rpc-url $RPC_URL
cast call $ADDR "owner()(address)" --rpc-url $RPC_URL
~~~

Confirm all values match the intended deploy params.

## Close-Out Checklist

- [x] Testnet Pyth Entropy address confirmed and documented
- [x] Testnet shMON address confirmed and documented
- [x] `scripts/deploy-ticket-prize-pool-shmon-v3.js` committed
- [x] `deploy:testnet:v3` and `deploy:mainnet:v3` in `package.json`
- [ ] Testnet deploy address recorded in `deployments/monad-testnet.json`
- [ ] Full smoke test steps 1-6 completed with no errors
- [ ] `cast call` post-deploy verification output attached to ticket
- [x] `deployments/monad-mainnet.json` not updated for testnet

## Current Blocker

The deploy/smoke path is ready. Actual testnet deployment requires local `PRIVATE_KEY` and a funded deployer wallet.
