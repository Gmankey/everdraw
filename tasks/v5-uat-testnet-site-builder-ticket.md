# Builder ticket — V5 UAT testnet site (separate Vercel, do NOT touch production)

**Date:** 2026-06-30. **From:** PM. **For:** Builder. **Why:** the operator needs to test the full V5 product — including the **Degen pool** — through the real UI before mainnet. Until now V5 has only been driven on-chain via `cast`; there is no frontend to user-acceptance-test it. (PM oversight — fixing it.)

## Decision
Stand up a **separate, isolated testnet UAT site** for the V5 frontend, pointed at the V5 **testnet** contracts. **Hard constraint: do not overwrite, repoint, or modify anything in production** — not the prod Vercel project, not its env vars, not its domain. New Vercel project, new env, new preview URL.

## Build / deploy
1. **New Vercel project** (e.g. `everdraw-v5-uat`) from `web/`, separate from the prod `everdraw` project. Its own preview URL (no custom prod domain).
2. **Env points at V5 testnet** (current soak deploy):
   - chain id `10143`, RPC `https://testnet-rpc.monad.xyz`
   - DrawManager `0x58502275bE5d5e998fE8318eC6343a0bc2A81C7c`, PrizeVault `0x5dB2AA29ACf832baf43d10BAEd6ff53a23549f10`, TwabController `0x165A546828e122935DE6B96ec894Ef14705194d7`, ClaimManager `0x885b117Dd7268bc8F26F5800330900d2Fb3dD1ac`
   - (If you redeploy V5 for the Degen-pool soak, repoint UAT to the new addresses — never prod.)
3. **Frontend must surface the V5 surfaces** so the operator can actually test: deposit + withdraw (participant), the **Degen pool deposit/withdraw** (zero-odds, points), current draw / prize, claim. If the Degen-pool UI isn't built yet, flag it — that's part of UAT scope.
4. **Label it clearly as TESTNET/UAT** in the UI so it can never be confused with prod.

## Acceptance
- A working preview URL the operator can open and exercise the full flow on testnet.
- Production (`everdraw.xyz`, the prod Vercel project + envs) is provably untouched (working rule #6 — confirm the prod site still serves the prod build and addresses).
- Deliver as your own committed PR + the live UAT URL.

## Note
This is the UAT gate before any V5 mainnet launch. Real user-acceptance testing (deposit/withdraw/degen/claim through the UI) happens here first.
