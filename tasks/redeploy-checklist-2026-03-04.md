# Redeploy Checklist — Correct PM Parameters (2026-03-04)

## Locked parameters (PM)
- `TICKET_PRICE_MON=1`
- `COMMIT_DELAY_BLOCKS=10`
- `ROUND_DURATION_SEC=604800`
- `SHMON=<mainnet shMON address>`

## Pre-deploy
- [ ] Confirm `SHMON` mainnet address
- [ ] Confirm deployer wallet funded
- [ ] Confirm keeper service stopped (avoid tx to old pool during switch)

```bash
sudo systemctl stop monad-prize-keeper
```

## Deploy
```bash
cd /home/c/.openclaw/workspace/monad-prize
export SHMON=0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c
export TICKET_PRICE_MON=1
export COMMIT_DELAY_BLOCKS=10
export ROUND_DURATION_SEC=604800
npm run deploy:mainnet
```

- [ ] Capture new `POOL_ADDRESS` from deploy output

## Post-deploy config switch
- [ ] Update `scripts/keeper.env` with new `POOL_ADDRESS`
- [ ] Keep `KEEPER_PREFLIGHT=true`
- [ ] Verify Telegram vars present and valid

## Bring keeper up + verify
```bash
sudo systemctl restart monad-prize-keeper
sudo systemctl status monad-prize-keeper --no-pager
cd /home/c/.openclaw/workspace/monad-prize
npm run keeper:health
bash scripts/keeper-alert-test.sh
```

- [ ] Confirm start log shows `preflight=true`
- [ ] Confirm no immediate error burst

## Documentation updates
- [ ] Mark old pool as test-only
- [ ] Update runbook + evidence docs with new address
- [ ] Start new Gate C evidence log with T+6h/T+12h/T+24h checkpoints
