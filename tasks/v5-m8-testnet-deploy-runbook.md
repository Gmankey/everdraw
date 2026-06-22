# V5 M8 Testnet Deploy Runbook

**Status:** Draft for M8 execution.
**Network:** Monad testnet, chain id `10143`.
**Operator rule:** agents/builders must not create, hold, sweep, delete, or paste private keys. Operator-owned signing steps are marked explicitly.

## Inputs

- M8 branch/commit:
- Deployer address:
- Keeper address:
- Watcher host:
- Healthchecks:
- Testnet RPC:
- Frontend URL:

## Builder-Safe Preflight

```bash
npm run build
forge test --match-path 'test/v5/*.t.sol'
npm run draw:fuzz
npm run draw:load100k
npm --prefix web run build
```

Record command output in `tasks/v5-m8-testnet-soak-evidence-YYYY-MM-DD.md`.

## Operator-Only Deploy

Operator deploys from the approved M8 branch/commit and records:

- contract addresses
- deploy txs
- constructor/config values
- owner/guardian/keeper roles
- `depositCap`
- draw cadence and challenge window

## Post-Deploy Checks

- Runtime bytecode exists for every V5 contract.
- Owner/guardian/keeper roles match the intended wallets.
- `depositCap`, min deposit, fee recipients, winner config, strategy, and oracle config match the deploy notes.
- Frontend testnet config points only at the new V5 testnet addresses.
- `deployments/monad-testnet.json` is updated. Do not update `deployments/monad-mainnet.json`.

## Abort Conditions

- Wrong chain id.
- Wrong branch/commit.
- Any signer/key source is unclear.
- Keeper or watcher wallet controlled by an agent.
- Contract config disagrees with the M8 deploy sheet.
