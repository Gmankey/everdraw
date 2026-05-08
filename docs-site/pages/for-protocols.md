# For Protocols

EverDraw is more than a user product. It is prize campaign infrastructure that any Monad protocol can use to drive retention.

The Phase 1 product is a public MON prize vault. The CampaignManager (Phase 2) opens the rails to protocols.

---

## The problem with current incentive models

Most growth budgets go into one of three buckets:

- **Airdrops.** One shot distribution, 90% farmer churn, tokens dumped on day one.
- **Liquidity mining.** Mercenary capital that exits the moment incentives stop.

These produce one shot engagement. Users arrive for the reward and leave when it is claimed. The budget is gone. The users are gone.

---

## Prize campaigns: a better model

The CampaignManager turns the same growth budget into recurring weekly engagement.

Instead of distributing tokens linearly across thousands of wallets (where each gets a forgettable amount), the budget funds a prize pool. Users participate for the chance to win. They come back weekly. Winners post about it. The protocol gets organic content and measurable retention from users who return because they want to win, not because they are farming.

Same budget. Recurring engagement instead of one shot extraction.

---

## How it works

**1. Create.** Call `createCampaign()` on the CampaignManager. Specify prize token, total budget, draw frequency, eligibility, and duration.

**2. Fund.** Transfer tokens to the contract. No code changes on your side. No audit on your side. Your existing contracts are untouched.

**3. Run.** EverDraw handles draw execution, winner selection, claims, and frontend integration. Your campaign appears with your branding.

**4. Measure.** Track retention, repeat participation, and cost per retained user through the partner dashboard.

---

## Eligibility options

Campaigns can target any combination of:

- Token holders (snapshot or live)
- Active users (verified by on chain interaction with your contracts)
- Stakers and LPs
- Custom Merkle allowlists

Verification is on chain. No trust assumptions, no self reporting.

---

## What makes this different

**No engineering overhead.** Treasury transfer plus configuration. No smart contract work. No bot infrastructure to maintain.

**Recurring, not one shot.** A weekly draw brings users back 52 times a year. An airdrop brings them once.

**Organic virality.** Winners tend to post about it. Every draw has potential to spawn great content.

**Composable.** Multiple protocols can co fund one mega draw and create ecosystem wide events no single protocol could produce alone.

---

## Get started

The CampaignManager ships in Phase 2. To pre coordinate a campaign or get on the partner list, contact the EverDraw team.

[Contact](#)
