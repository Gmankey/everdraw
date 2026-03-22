# For Protocols

EverDraw isn't just a user-facing product. It's prize campaign infrastructure that any Monad protocol can use to drive user retention.

---

## The problem with current incentive models

Protocols spend significant budgets on user acquisition. The current toolkit:

- **Airdrops** — one-time distribution, 90%+ farmer churn, tokens get dumped on day one
- **Liquidity mining** — mercenary capital that exits the moment incentives stop
- **Points programs** — increasing fatigue, unclear value, users gaming the system

All of these produce one-time engagement. Users arrive for the reward and leave when it's claimed. The budget is spent. The users are gone.

---

## Prize campaigns: a better model

EverDraw's CampaignManager lets protocols convert the same growth budget into recurring weekly engagement.

Instead of distributing tokens linearly across thousands of wallets (where each user gets a forgettable amount), the budget funds a prize pool. Users participate for the chance to win the full pot. They come back weekly. Winners post about it on social media. The protocol gets organic content, measurable retention, and users who return voluntarily — not because they're farming, but because they want to win.

**Same budget. Recurring engagement instead of one-time extraction.**

---

## How it works

**Step 1 — Create a campaign**

Call `createCampaign()` on EverDraw's CampaignManager contract. Specify:
- Prize token and total budget
- Draw frequency (weekly, daily, or custom)
- Eligibility criteria (token holders, stakers, LP providers, or custom allowlist)
- Campaign duration

**Step 2 — Fund it**

Transfer tokens to the CampaignManager. That's it. No contract changes on your side. No audit required for your protocol. Your existing contracts and infrastructure are untouched.

**Step 3 — EverDraw handles the rest**

Draw execution, winner selection, claim flows, and frontend integration are all managed by EverDraw's audited infrastructure. Your campaign appears in the EverDraw UI with your branding.

**Step 4 — Measure results**

Track retention metrics, repeat participation rates, and campaign ROI through the partner dashboard.

---

## What makes this different

**No engineering overhead.** A protocol funds a campaign with a treasury transfer. No smart contract modifications. No audit on your side. No bot infrastructure to maintain.

**Recurring, not one-time.** A weekly prize draw brings users back 52 times a year. An airdrop brings them once.

**Organic virality.** Every winner posts about it. Every draw is a content event your protocol benefits from without paying for it.

**Measurable.** Unlike airdrops where you hope for retention, prize campaigns give you hard data on user return rates, repeat engagement, and cost per retained user.

**Composable.** Multiple protocols can co-fund a single mega draw — creating ecosystem-wide events that no single protocol could produce alone.

---

## Eligibility options

Campaigns can target specific user segments:
- **Token holders** — users holding your protocol's token
- **Active users** — users who have interacted with your contracts (verified via on-chain activity)
- **Stakers / LPs** — users with active positions in your protocol
- **Custom allowlists** — Merkle-based allowlists for any custom criteria

Eligibility is verified on-chain. No trust assumptions. No self-reporting.

---

## Get started

Reach out to the EverDraw team to discuss a campaign. We'll help you structure the prize pool, eligibility criteria, and draw schedule for maximum impact.

[Contact →](#)
