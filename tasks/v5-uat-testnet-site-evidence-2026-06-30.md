# V5 UAT Testnet Site Evidence

Date: 2026-06-30

## Live UAT URL

- https://everdraw-v5-uat.vercel.app

## Vercel Project

- Project: `everdraw-v5-uat`
- Project ID: `prj_nYcHAIlII0sN2VJkdxa5DG9ROvYg`
- Production EverDraw project left untouched: `everdraw` / `prj_41iuO5toVtvHCvfAGckpR2z9pqUI`

## Build Configuration

- `VITE_V5_UAT=true`
- `VITE_CHAIN_ID=10143`
- `VITE_RPC_URL=https://testnet-rpc.monad.xyz`
- `VITE_V5_DRAW_MANAGER_ADDRESS=0x58502275bE5d5e998fE8318eC6343a0bc2A81C7c`
- `VITE_V5_PRIZE_VAULT_ADDRESS=0x5dB2AA29ACf832baf43d10BAEd6ff53a23549f10`
- `VITE_V5_TWAB_CONTROLLER_ADDRESS=0x165A546828e122935DE6B96ec894Ef14705194d7`
- `VITE_V5_CLAIM_MANAGER_ADDRESS=0x885b117Dd7268bc8F26F5800330900d2Fb3dD1ac`

## Verification

- `npm run build` passed.
- `VITE_V5_UAT=true npm run build` passed.
- `npx eslint src/V5UatApp.jsx src/main.jsx` passed.
- `npm run test:rpc-cache` passed.
- Deployed bundle contains `V5 TESTNET UAT ONLY`, `EverDraw V5 UAT`, the V5 DrawManager/Vault addresses, and `boostDeposit`.
- `https://everdraw.xyz` returned HTTP 200 after the UAT deploy.

## Degen Pool UI Note

The UAT UI includes Degen Pool / Prize Booster deposit and withdraw controls wired to `boostDeposit()` and `boostWithdraw()`. The controls disable themselves and show a warning if the configured vault does not expose the ADR-0040 booster read/write surface, so testers get an explicit signal if the current address predates the booster redeploy.
