# V5 Integration

## Resolve the active deployment

Read the canonical deployment manifest and select one complete tuple:

- PrizeVaultV5
- DrawManagerV5
- ClaimManagerV5
- EverdrawTwabController
- ShmonStrategy
- PythRandomnessOracle

Verify chain ID, runtime bytecode, and cross-contract wiring before submitting a write. Never combine addresses from different UAT or mainnet deployments.

## Read positions

Use PrizeVaultV5 for authoritative current principal and shMON strategy state. Use TwabController for time-weighted draw inputs. The indexer provides derived tranche, history, points, draw, participant, and health APIs, but it is not a custody source of truth.

Wallet endpoints support an active-vault filter. Consumers must scope tranches and position events to the selected vault so retired deployments do not appear as live positions.

## Submit deposits and withdrawals

Native MON and direct shMON deposits are supported. Withdrawals return shMON shares only. MON conversion occurs separately through shmonad.xyz and follows ShMonad's unstaking timing.

Patron deposits use the boost methods. They contribute yield and earn boosted EverDraw points but have zero draw entries.

## Observe draws and prizes

Ingest the complete lifecycle and ClaimManager events. A winner is established by the finalized root and valid leaf. A successful PrizeCompounded should correlate with the same-transaction vault Deposit by transaction, account, and log order; amounts can differ because the vault credits the strategy-reported asset delta.

## Merkl and third-party points

EverDraw exposes the integration surface intended for Merkl and shMonad campaigns. Third-party eligibility and award policy remain external decisions. Do not promise rewards until the third party has configured and activated the campaign.

## Failure handling

RPC, indexer, keeper, watcher, Pyth, and shMON failures have different trust implications. Integrations should retry transient reads, fail closed on mixed deployment configuration, avoid showing raw RPC errors, and keep withdrawals accessible whenever the contract permits them.
