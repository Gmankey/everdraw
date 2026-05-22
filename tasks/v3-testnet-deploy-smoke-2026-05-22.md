# V3 Testnet Deploy + Smoke Ticket

## Address resolution

- Monad testnet chainId: 10143
- Pyth Entropy contract: 0x825c0390f379c631f3cf11a82a37d20bddf93c07
  - Source: Pyth Entropy testnet chain config endpoint, monad-testnet entry.
  - On-chain code was present on https://testnet-rpc.monad.xyz.
- Pyth default entropy provider: 0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344
  - Confirmed by calling getDefaultProvider() against the Entropy contract on Monad testnet.
- shMON testnet: unresolved / blocked.
  - shMonad frontend bundle includes a Monad testnet config value 0x15111Ed0B8399956b582F28BE1E42D4A5055BF76.
  - The same bundle's raw token list also includes 0x3a98250F98Dd388C211206983453837C8365BDc1.
  - On https://testnet-rpc.monad.xyz, both candidates currently return empty runtime code, so neither can be safely used as the shMON contract for this smoke test.

## Scripts added

- scripts/deploy-ticket-prize-pool-shmon-v3.js
- scripts/smoke-ticket-prize-pool-shmon-v3.js

## Intended testnet deploy command

~~~bash
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
export SHMON=<confirmed-testnet-shmon>
export ENTROPY=0x825c0390f379c631f3cf11a82a37d20bddf93c07
export ENTROPY_PROVIDER=0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344
export ROUND_DURATION_SEC=60
export YIELD_PERIOD_SEC=0
export TICKET_PRICE_MON=0.01

npm run deploy:testnet:v3
~~~

## Intended smoke command

~~~bash
export POOL_ADDRESS=<deployed-v3-pool>
export VRF_RESERVE_MON=0.1
export SMOKE_TICKET_COUNT=1

npm run smoke:testnet:v3
~~~

## Smoke path

The smoke runner cycles one full round:

1. depositVRFReserve
2. buyTicketsMON
3. wait until getCommitAfterTime(roundId)
4. commitDraw
5. poll until Pyth callback moves the round to RoundState.Drawn
6. finalizeDraw
7. claimPrize
8. withdrawPrincipal

## Current blocker

The deploy/smoke path is ready, but the actual testnet deployment is blocked until a live shMON testnet contract address is confirmed. The two shMonad-site candidates checked on-chain have no code at the current Monad testnet RPC state.
