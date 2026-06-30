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
- `VITE_V5_CLAIM_PROOF_URL=` pending keeper/indexer proof endpoint

## Verification

- `npm run build` passed.
- `VITE_V5_UAT=true npm run build` passed.
- `npm run test:rpc-cache` passed.
- `npx eslint src/main.jsx src/App.jsx` still reports existing production-app lint debt in `App.jsx`; the prior UAT hook-order error from the standalone early-return approach is gone.
- Deployed bundle contains production-styled V5 UAT markers, the V5 DrawManager/Vault addresses, and `boostDeposit`.
- `https://everdraw.xyz` returned HTTP 200 after the UAT deploy.
- Browser visual/DOM pass on `https://everdraw-v5-uat.vercel.app` confirmed:
  - shell class `app-shell v5-uat-mode`
  - H1 `Win from the vault. Boost the prize.`
  - visible buttons `Deposit to Play`, `Add to Degen Pool`, `Claim Prize`
  - cards `Play the Draw`, `Degen Pool`, `Next V5 Draw`
  - no `Paste a ClaimManager leaf/proof JSON`, `Boost Deposit`, or `Claim Many`
  - no browser console errors

## Rev 2 UI Notes

- Removed the standalone debug page (`V5UatApp.jsx` / `V5UatApp.css`).
- V5 UAT is now selected from `main.jsx` but implemented inside `App.jsx`, using the production app shell, cards, stats, inputs, buttons, and `App.css`.
- The Degen Pool is presented as a product feature with plain-language copy and buttons labeled `Add to Degen Pool` / `Withdraw`, wired to `boostDeposit()` and `boostWithdraw()`.
- Participant flow is `Deposit to Play` / `Withdraw`, wired to `deposit()` and `withdraw()`.
- Claim is a single `Claim Prize` button. It auto-fetches proofs from `VITE_V5_CLAIM_PROOF_URL` and calls `claimMany`; there is no JSON paste box.
- The repo does not currently expose a frontend-consumable proof endpoint; the keeper has proof data internally for batch `claimMany`. If `VITE_V5_CLAIM_PROOF_URL` is not configured yet, the one-button claim flow shows a product message instead of asking the user for raw proofs.
