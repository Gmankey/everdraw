# Builder ticket — V5 UAT testnet site (REDO: must look/behave like production)

**Date:** 2026-06-30 (rev 2). **From:** PM. **For:** Builder. **Supersedes the first attempt (PR #170).**

## What went wrong (rev 1)
The first attempt built a **bespoke debug page** — raw hex address cards, a "Boost Deposit" button, and a "paste a ClaimManager leaf/proof JSON" box. **That is not UAT.** No real user ever sees raw addresses or pastes a merkle proof. UAT means a **user exercises the real product experience** to catch UX/visual/flow problems — so the UAT site must look and behave **like production**, just on testnet. My rev-1 ticket failed to say that. Fixing it here.

## What UAT must be
Deploy the **real production frontend** (`web/`, the same app behind `everdraw.xyz` — its design system, components, header, wallet-connect, styling, polish) to the isolated testnet Vercel project, presenting **V5's flows** in that production look. A user should not be able to tell it apart from the real product except for a small "testnet" banner.

- **Reuse the production app** (`web/src/App.jsx`, `App.css`, `Stats.jsx`, the existing components and visual identity). **Do NOT build a new standalone page.** V5 ≠ V4.1 functionally (continuous TWAB, no rounds), so build V5's flows *inside* the production design language — the result is effectively the future V5 production frontend, tested on testnet first.
- **Real user flows, production-styled (no dev-isms):**
  - Prize/pot, current draw, countdown — styled like prod, not raw cards.
  - **Deposit to play** (participant) — the real deposit UX.
  - **Withdraw** — real UX.
  - **Degen pool** — a polished product feature with plain-language copy ("add to the prize, earn points, no chance to win, withdraw anytime"), not a raw "Boost Deposit" button.
  - **Claim = ONE BUTTON.** The frontend must **auto-fetch the proof** from the indexer/keeper output and submit the claim. **Never** ask the user to paste JSON/leaves/proofs. If the proof source isn't wired, that's part of this ticket.
  - Wallet connect identical to prod.
- Raw addresses/chain debug info, if shown at all, belong in a small footer/diagnostics area — never the primary UI.

## Isolation (unchanged, keep it)
- Same separate Vercel project `everdraw-v5-uat` (already created) — **redeploy the corrected frontend to it**, don't make another.
- Points at V5 testnet (chain 10143, DrawManager `0x58502275…`, vault `0x5dB2AA…`, claim `0x885b11…`).
- **Production (`everdraw.xyz` + its Vercel project/envs/domain) must stay untouched** — verified rev 1, keep it that way.
- Small persistent "TESTNET / UAT" banner so it can't be mistaken for prod.

## Acceptance
- The UAT URL looks and feels like `everdraw.xyz` (same design system/components), with V5 flows a real user can complete: connect, deposit, withdraw, degen deposit/withdraw, see prize/draw, and **claim with a single click (no JSON paste)**.
- Prod confirmed untouched (working rule #6).
- Deliver as your own committed PR + the updated UAT URL.

## Note on the "match production" nuance
"Match production exactly" = match the **look, feel, polish, components, and UX patterns** of `everdraw.xyz`. It does **not** mean clone the V4.1 round UI (V5 has no rounds). Present V5's real flows with production-grade design so UAT reflects what users will actually experience at V5 launch.
