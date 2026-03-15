# Everdraw Testnet Frontend Safe Rollout (Option 1)

Date: 2026-03-15
Owner request: deploy a testnet frontend for real users **without touching** current GitHub/Vercel production (Nitro-judge-safe).

## Golden rule
Do **not** modify or redeploy the current production Vercel project.
Use a separate branch + separate Vercel project.

## Current deployed testnet pool
- Network: Monad Testnet (chainId `10143`)
- Contract: `0x80fBf53FB317819665e47E6Eae8ff866b0603cf2`
- Round duration set at deploy: `604800` seconds (7 days)

## Recommended rollout (safe)

### 1) Branch isolation
- Branch name: `testnet-frontend-safe-2026-03-15`
- Keep all testnet frontend changes on this branch only.
- Do **not** merge into `master` until judging period is over.

### 2) New Vercel project (separate from prod)
Create a new Vercel project, for example:
- Project name: `everdraw-testnet`
- Root directory: `monad-prize/web`
- Production branch for this project: `testnet-frontend-safe-2026-03-15`

This ensures production site stays exactly as-is.

### 3) Vercel env vars (testnet project only)
Set these in the new testnet project:

- `VITE_POOL_ADDRESSES=0x80fBf53FB317819665e47E6Eae8ff866b0603cf2`
- `VITE_POOL_ADDRESS=0x80fBf53FB317819665e47E6Eae8ff866b0603cf2`
- `VITE_RPC_URL=https://testnet-rpc.monad.xyz`
- `VITE_CHAIN_ID=10143`
- `VITE_ESTIMATED_APY_PERCENT=12`
- `VITE_POOL_DEPLOY_BLOCK=0`

Notes:
- `VITE_POOL_ADDRESSES` supports multi-vault switcher if more pools are added later.
- Keep prod project env vars untouched.

### 4) Access-sharing choices for testers
Pick one:
- Open link (fastest): share testnet URL directly.
- Password gate (safer): Vercel deployment protection/password.
- Wallet allowlist route (best control): app-level gating.

For immediate user testing, password-gated link is usually best.

### 5) Smoke checks before sharing
- Connect wallet works on testnet.
- Buy tickets works.
- Countdown/live states render.
- Winners view opens.
- No references to production/mainnet addresses.

### 6) Operational safety
- Never promote this testnet project/domain as canonical production.
- Keep Nitro-facing production domain unchanged.
- Use separate URL in all tester comms.

## Rollback
If anything looks wrong:
- Disable or delete the `everdraw-testnet` Vercel project.
- No impact on production project.

## Handover
When judging is done:
- Decide whether to cherry-pick selected frontend changes to `master`.
- Repoint final production deploy only after review.
