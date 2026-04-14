# Phase 2 Builder Kickoff

**From:** PM
**To:** Builder
**Date:** 2026-04-08
**Status:** GO for Phase 2c

---

## What you're building

EverDraw Phase 2 — a new shMON-native lottery vault. Instead of the current behavior (contract unstakes shMON → returns MON at round end after 18-22hr wait), V2 **always returns shMON shares directly**. Users who want MON convert it themselves via a new UI.

Three deliverables, three specs, build in this order:

1. **Phase 2c — shMON unstake widget** (ships first, zero contract risk)
2. **Phase 2a — V2 contract + frontend + keeper** (new Vault C deployment)
3. **Phase 2b — test suite** (can start in parallel with 2a once contract spec is frozen)

## Start here: Phase 2c

Read in order:
1. `tasks/phase2-shmon-native-plan.md` — 10 min read, gets you the big picture
2. `tasks/phase2-builder-spec-c-shmon-widget.md` — your actual build spec

## Phase 2c task summary

Add a new **"shMON" tab** to everdraw.xyz that lets users manage their shMON balance directly:
- See balance + MON equivalent
- Instant unstake via `shmon.redeem()` (~0.975% fee)
- Scheduled unstake via `shmon.requestUnstake()` → wait ~18-22hr → `completeUnstake()` (free)
- Pending unstakes persist across page reloads

**No contract changes.** You're just a frontend wrapper around the existing shMON contract at `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`.

## Environment

- Repo: `/home/c/.openclaw/workspace/everdraw-clean`
- Frontend: `web/` (Vite + React, deployed to Vercel)
- Mainnet RPC: `https://rpc.monad.xyz` (rate-limited — don't poll too aggressively, 30s intervals recommended)
- Current live site: `https://everdraw.xyz`
- Deploy command: `cd web && npx vercel --prod` (from WSL)

## Critical context you should know

1. **Public Monad RPC is rate-limited (429s).** Don't do tight refresh loops. Current V1 refresh interval was just bumped from 15s → 30s. Stay at 30s or slower for polling.

2. **web3modal provider must be used, not just `window.ethereum`.** See `getWalletProvider()` in `App.jsx` — reuse this helper.

3. **Ethers v6 quirks:**
   - BigInt everywhere, never Number for wei amounts
   - Gas estimation errors surface cryptically (`value.nonce undefined`) — always pre-estimate with a try/catch and surface the real revert reason, as we just did for `buyTickets` in App.jsx
   - BrowserProvider wraps the wallet's EIP-1193 provider

4. **shMON has non-standard surface:**
   - `name()` and `totalSupply()` revert — don't call them
   - `convertToShares()` reverts — use `previewDeposit()` instead
   - `previewRedeem` includes the ~0.975% instant-redeem fee
   - `convertToAssets` does NOT include the fee (it's the mark-to-market rate)
   - All other ERC-4626 + ERC-20 calls work normally

5. **Do NOT modify these files during Phase 2c:**
   - Any Solidity contract
   - `scripts/keeper-execute-next.js`
   - `scripts/indexer/*`
   - Existing Vault A/B pool display code (just add the new tab, don't touch what works)

## Phase 2c discovery items (resolve as you start)

Before writing Flow 3 (scheduled unstake), you need to answer:

1. **How does shMON expose per-user pending unstake state?**
   - Try view functions in order: `pendingUnstake(address)`, `unstakeInfo(address)`, `unstakes(address)`, `pendingUnstakes(address)`
   - If none exist, fall back to scanning `UnstakeRequested` events filtered by user address
   - Tool: use a small `scripts/` node script to probe the contract via ethers

2. **Can a user have multiple simultaneous pending unstakes?**
   - Test: attempt a second `requestUnstake` while one is outstanding
   - On Monad testnet is fine; no need to spend mainnet MON on this
   - Determines UI: single-slot vs list

3. **Exact `UnstakeRequested` event signature** (for log filters if needed)

Document your findings in a short note in the PR description or a comment in `useShmon.js`.

## Phase 2c exit criteria (copy from spec)

- [ ] "shMON" tab visible in main nav, wallet-gated
- [ ] BalanceCard shows shMON balance + MON equivalent
- [ ] Instant unstake flow works end-to-end (MetaMask + WalletConnect)
- [ ] Scheduled unstake request → pending card → complete flow works
- [ ] Pending card persists across page reloads (localStorage + event reconciliation)
- [ ] All error states have clear user messaging (per spec section)
- [ ] No regressions on existing V1 vault pages
- [ ] Deployed to production via Vercel

## Testing requirements for 2c

**Manual smoke test on mainnet with a small amount** (per spec section "Testing checklist"):
1. Get ~0.5 MON in a test wallet
2. Deposit into shMON via shmonad.xyz OR by calling `shmon.deposit` directly
3. Run through all three flows from the live production URL
4. Verify WalletConnect path separately from MetaMask

**Don't ship to production until all three flows work on at least one real mainnet account.**

## When Phase 2c is done

Stop and check in with PM before starting Phase 2a. I'll review the UX pattern before we lock it into the V2 contract design.

After PM signoff on 2c, you'll:
1. Read `tasks/phase2-builder-spec-a-v2-contract.md`
2. Read `tasks/phase2-builder-spec-b-test-suite.md`
3. Build 2a and 2b in parallel (contract first, then frontend/keeper/tests)

## Reporting

Daily async update in a fresh doc: `tasks/phase2-status-YYYY-MM-DD.md` with:
- What you shipped
- What's blocked
- Discovery findings (especially for Phase 2c discovery items)
- Any spec ambiguities you hit

## Things you can decide unilaterally

- Component file structure (the spec names components but you can tweak)
- CSS approach (scoped CSS file vs extending App.css)
- Error message exact wording (must be clear but your phrasing is fine)
- Testing approach (manual smoke or quick vitest where it makes sense)

## Things you must check with PM before deciding

- Any change to contract state or events
- Any change to indexer schema
- Changing the order of phases (2c → 2a → 2b is locked)
- Any new environment variables or Vercel config
- Deprecating or removing V1 code
- Changing the shMON contract address or RPC URL

## One more thing

The RPC is flaky. Wrap all reads in try/catch. Cache what you can. When in doubt, call less frequently.

**Go. Start with reading the plan + spec-c. Ping PM with questions or when 2c is ready for review.**
