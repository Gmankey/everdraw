# Phase 2: Continuous Deposits and Campaign Infrastructure

**Timeline: month 2 to 6.**

Phase 2 ships two major capabilities. Continuous prize savings for users via TWAB. Campaign infrastructure for protocols via the CampaignManager.

---

## Continuous Deposits: TWAB

### The problem

Round based mechanics have a UX cost. If you arrive at the wrong time, you wait. Miss the deposit window and you can't enter that round. Buy in early and your principal is locked longer than necessary. Timing affects experience.

### The solution: Time Weighted Average Balance

Instead of buying tickets for a specific round, you simply deposit MON. The protocol tracks each wallet's balance over time using a time weighted average. Your probability of winning in any draw equals your TWAB divided by the total pool TWAB across the draw period.

Deposit Tuesday. Withdraw Friday. You earn chances proportional to every day your MON was in the vault. No windows. No timing games.

This changes the experience materially:

- No more "missed the window."
- Timing attacks become impossible. Depositing right before a draw is worthless because your average balance over the period is negligible.
- Draws can run more flexibly instead of weekly.

### Automatic prize distribution

Winners no longer claim manually. An incentivised keeper network distributes prizes directly to winner wallets. You wake up with MON you didn't expect.

---

## CampaignManager: Prize Infrastructure for Protocols

### The problem

Every Monad protocol with a growth budget faces the same challenge. Acquire users who actually stay. Airdrops produce one shot engagement. Points programs face fatigue. Liquidity mining creates mercenary capital. Protocols need a tool that creates recurring engagement instead of a one shot dump.

### The solution: branded prize campaigns

The CampaignManager contract lets any Monad protocol run a branded prize campaign with a single treasury transfer. No contract changes on the protocol's side. No audit. No yield source needed.

A protocol calls `createCampaign()`, specifies prize token and budget, draw frequency, and eligibility criteria, then funds the campaign with a token transfer. EverDraw handles draw execution, winner selection, claim flows, and frontend integration. Eligibility is verified on chain via token snapshots or Merkle allowlists.

The protocol keeps its branding and user relationship. EverDraw provides the trusted neutral prize engine.

### Why this beats airdrops

An airdrop takes a budget and distributes it once. Users claim, sell, and leave. A prize campaign takes the same budget and spreads it across recurring weekly engagement events. Users participate to win, come back each week, and winners generate organic content every draw.

Same budget. Recurring engagement instead of one shot extraction.
