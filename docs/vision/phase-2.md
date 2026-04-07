# Phase 2 — Continuous Deposits + Campaign Infrastructure

**Timeline: Month 2–6**

Phase 2 delivers two major capabilities: continuous prize savings for users via TWAB, and campaign infrastructure for protocols via the CampaignManager.

---

## Continuous Deposits: TWAB

### The problem Phase 2 solves for users

Round-based mechanics have a fundamental UX flaw: if you arrive at the wrong time, you wait. Miss the window and you can't deposit. Buy in early and your MON is locked longer than necessary. The timing of your deposit affects the experience.

### The solution: Time-Weighted Average Balance

Instead of buying tickets for a specific round, users simply deposit MON. The protocol tracks each wallet's balance over time using a time-weighted average. Your probability of winning in any draw equals your TWAB divided by the total pool TWAB over the draw period.

Deposit Tuesday. Withdraw Friday. You earn chances proportional to every day your MON was in the vault. No windows to hit. No timing games.

**This changes everything:**
- No more "missed the window"
- No more "come back in 7 days"
- Timing attacks become impossible — depositing right before a draw is worthless because your average balance over the draw period is negligible
- Draws can run daily instead of weekly. More winners. More engagement.

### Automatic prize distribution

Winners no longer claim manually. An incentivised keeper network distributes prizes directly to winner wallets. Users wake up with MON they didn't expect — the most delightful UX in DeFi.

### The user experience in Phase 2

*Deposit MON. Forget about it. Check if you won.*

That's it.

---

## CampaignManager: Prize Infrastructure for Protocols

### The problem Phase 2 solves for protocols

Every Monad protocol with a growth budget faces the same challenge: acquiring users who actually stay. Airdrops produce one-time engagement. Points programs face fatigue. Liquidity mining creates mercenary capital. Protocols need a retention tool that creates recurring engagement — not a one-time dump.

### The solution: Branded prize campaigns

EverDraw's CampaignManager contract lets any protocol on Monad run a branded prize campaign with a single treasury transfer. No contract changes on the protocol's side. No audit required. No yield source needed.

**How it works:**

A protocol calls `createCampaign()` on EverDraw's CampaignManager, specifying:
- Prize token and budget
- Draw frequency (weekly, daily, custom)
- Eligibility criteria (token holders, stakers, LP providers, custom)

They fund the campaign with a token transfer. EverDraw handles everything else — draw execution, winner selection, claim flows, and frontend integration. Eligibility is verified on-chain via token balance snapshots or Merkle allowlists.

**The result:** Any Monad protocol can run branded prize campaigns through EverDraw's audited infrastructure instead of building their own mechanics from scratch. The protocol keeps its user relationship and branding. EverDraw provides the trusted, neutral prize engine.

### Why this is better than airdrops

An airdrop takes a growth budget and distributes it once. Users claim, sell, and leave. A prize campaign takes the same budget and distributes it as recurring weekly engagement events. Users participate for the chance to win, come back each week, and winners generate organic social content every single draw.

Same budget. Recurring engagement instead of one-time extraction.
