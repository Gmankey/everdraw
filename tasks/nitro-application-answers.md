# Everdraw — Nitro Accelerator Application Answers

---

## 1. Why are you the right founder to build this?

I'm a full-stack technical founder who built the entire protocol solo — Solidity contracts, automated keeper infrastructure, and a live frontend — in weeks, not months. 39/39 tests passing, a keeper bot running on systemd with preflight safety checks and Telegram alerting, and a complete dApp with wallet connect, vault timers, ticket purchasing, and claim flows. All deployed and validated on Monad testnet. This isn't a pitch deck with promises. It's a working product built by one person.

I'm also a Monad OG. I run a hot Nad, I'm part of Monvideo, localnads, Pipeline intern, and Keone's 1000 list. I'm not building on Monad because it's trendy — I'm building on Monad because I've been in this community from the start and I want to see it win.

That combination matters: deep technical execution plus genuine community roots. I don't need to hire an engineer to ship. I don't need to be convinced Monad is the right chain. I've already proven I can build fast, I understand the ecosystem, and I have a direct working relationship with ShMonad, the largest LST on Monad. Most accelerator applicants bring a slide deck. I bring a live demo.

---

## 2. If selected, how do you plan to spend $500K?

| Category | Amount | Purpose |
|----------|--------|---------|
| Security audit | $75K | Comprehensive audit by a top-tier firm (e.g. Trail of Bits, OpenZeppelin, or a Monad-experienced auditor). Covers both the current contract and the Phase 2 TWAB architecture. Non-negotiable for a protocol that holds user funds. |
| Prize pool seeding | $125K | Bootstrap launch prize pools so early depositors see prizes worth winning from Day 1. This solves the cold-start problem — small pools produce tiny prizes that fail to motivate deposits. Seeding creates the critical mass that triggers organic growth. Seed capital is recoverable as the protocol scales and organic yield takes over. |
| Marketing & community | $100K | Community manager hire, Discord/Twitter buildout, KOL partnerships, Monad ecosystem events, weekly winner content campaigns. Every draw cycle is a content event — winners sharing their wins is organic marketing. This budget fuels the initial flywheel. |
| Team expansion | $100K | Hire a dedicated community/marketing lead and a part-time smart contract engineer for Phase 2 (TWAB continuous deposits). 6-9 month runway for focused building without distraction. |
| Partnerships & integrations | $50K | Ecosystem BD for yield source integrations — ShMonad deeper integration, Curvance, Neverland, potential Aave on Monad. Each new yield source enables a new vault type and expands the addressable market. |
| Infrastructure & ops | $30K | RPC node costs, keeper bot hosting (redundant across regions), monitoring and alerting infrastructure, domain, frontend hosting, analytics. |
| Reserve | $20K | Buffer for unexpected costs — audit remediation, emergency response, gas costs during high-activity launches. |

**Why $500K is the right number:** The product is already built — this isn't build money, it's launch-and-scale money. The largest line items (audit + seeding) are the difference between a testnet project and a real protocol people trust with their money. The seeding budget is particularly important: prize savings lives or dies on whether the prizes are exciting enough to drive deposits. $125K in seeding creates prizes large enough to generate social proof and viral sharing from Day 1.

---

## 3. What problem are you solving and why does it matter?

DeFi has a retention problem. Users chase yields, farm airdrops, and leave. Protocols spend millions on incentives that produce mercenary capital — TVL that disappears the moment rewards dry up. Meanwhile, betting markets like Polymarket are pulling users away from DeFi entirely. Betting creates engagement but destroys capital. Users end up poorer and more disengaged long-term.

Prize-linked savings solves both problems simultaneously. Users deposit assets and get a chance to win a much larger pot of yield, but they never lose their principal. It creates the dopamine hit of gambling with the financial outcome of saving. It's the most accessible DeFi product possible: "Deposit MON. Maybe win the pot. Always keep your lot."

This matters for three reasons:

**For users:** It's the only DeFi product where the worst-case outcome is "you saved money." No liquidation risk, no impermanent loss, no complex positions. The product you can explain to someone who's never touched DeFi.

**For Monad:** Every MON deposited into Everdraw gets staked via ShMonad. More users = more staked MON = stronger network security. The protocol and the chain are symbiotically aligned. Everdraw doesn't extract from Monad — it strengthens it.

**For the ecosystem:** Prize savings creates a weekly engagement loop. Unlike one-time DeFi interactions, users come back every week to check if they won. Weekly winners create shareable moments — every draw cycle is organic marketing. This is recurring, habitual on-chain activity, not one-and-done.

---

## 4. Who are your closest comparables and what do you understand that they don't?

**Closest comparable: PoolTogether.**

PoolTogether pioneered no-loss prize savings on Ethereum and validated the concept — 88K+ wallets, $10M+ in prizes distributed over 5+ years. But PoolTogether today sits at roughly $5M TVL. They have not grown. The protocol that proved the model also exposed its failure modes. Here's what Everdraw understands that PoolTogether doesn't:

**1. The yield source is everything, and theirs is broken.**

PoolTogether is entirely dependent on third-party lending yields (Aave, Compound). When DeFi yields compress — which they have for most of 2023-2025 — prizes become tiny and uninspiring. Small prizes kill deposits. Fewer deposits mean even smaller prizes. It's a death spiral they've never escaped.

Everdraw's yield comes from Monad's own consensus mechanism via ShMonad staking. This isn't parasitic yield from a lending market — it's native chain yield that exists as long as Monad exists. The yield source is structurally more reliable and directly aligned with the chain's security model. Every Everdraw deposit strengthens Monad. PoolTogether deposits strengthen Aave.

**2. Multi-chain fragmentation killed their network effects.**

PoolTogether V5 spread across Optimism, Base, Arbitrum, and Ethereum. Each deployment fragments liquidity, splits prize pools, and confuses users ("Which chain should I deposit on?"). Their complex cross-chain draw bot and liquidation bot infrastructure adds failure modes and centralization risk — prizes literally don't distribute if the bots go down.

Everdraw is Monad-native. One chain. One pool ecosystem. All liquidity concentrates into bigger prizes. No cross-chain complexity. No bot-dependency for basic functionality. Simpler architecture = fewer failure modes = more trust.

**3. They never solved the cold-start problem.**

Every new PoolTogether deployment starts with tiny prizes that fail to attract deposits. They've launched on chain after chain and hit the same wall each time. Everdraw is solving this with deliberate prize pool seeding and prize boost partnerships where ecosystem protocols sponsor additional prizes as a user acquisition channel. We're not hoping organic yield will be enough on Day 1 — we're engineering excitement from launch.

**4. Legacy architecture holds them back.**

PoolTogether has gone through V3, V4, and V5 — each a major rewrite with migration friction, fragmented liquidity, and accumulated smart contract risk. Their V5 TWAB system, while clever, adds storage costs and complexity that Ethereum's architecture makes expensive. Everdraw starts clean on a chain where high throughput and low gas costs make TWAB and continuous deposits economically viable at scale. We're building the architecture PoolTogether would build today if they could start over on a modern chain.

**5. They're not on Monad. We are.**

PoolTogether has shown no indication of deploying on Monad. Everdraw is purpose-built for Monad's staking economics — it couldn't exist in its current form on any other chain. First-mover advantage on a chain with this much momentum is rare. We intend to own it.

**The bottom line:** PoolTogether proved the model works. They also proved that the model fails when yield is unreliable, liquidity is fragmented, and there's no native chain alignment. Everdraw fixes all three.

---

## 5. What changed in the tech or market that makes this a good idea right now?

Three things converged:

**1. Monad's staking layer creates native, reliable yield.**

Before Monad and ShMonad, prize savings protocols had to source yield from lending markets — inherently cyclical and unreliable. ShMonad creates a native staking yield source tied to Monad's consensus mechanism. This is structural yield that exists as long as the chain runs. For the first time, a prize savings protocol can build on a yield source that isn't dependent on lending market conditions. This changes the fundamental economics.

**2. Monad's performance makes prize savings UX viable at scale.**

Previous attempts at prize savings on Ethereum were constrained by gas costs and slow finality. A $1 ticket doesn't work when gas costs $5. Weekly draws don't feel exciting when settlement takes minutes. Monad's 10,000 TPS, sub-second finality, and near-zero gas costs make micro-tickets economically viable, instant deposits delightful, and daily draws feasible. The UX that prize savings always needed — fast, cheap, accessible — is now technically possible.

**3. The market is starving for DeFi products that aren't extractive.**

Users are exhausted by yield farming, liquidation risks, and impermanent loss. Betting markets are growing because they offer excitement, but they destroy capital. The market is ready for a product that delivers engagement without risk — and prize savings is exactly that. The timing is right because the gap between "what users want" (excitement + safety) and "what DeFi offers" (complexity + risk) has never been wider.

---

## 6. Tell us about the target segment you're tapping into in the next 3-6 months.

**Primary: Monad-native community members who hold MON but aren't actively using it in DeFi.**

These are the holders — they bought MON, they believe in Monad, but they're not LPing, lending, or actively farming. Their MON sits in a wallet doing nothing. Everdraw gives them a reason to put it to work with zero downside risk. The pitch is dead simple: "Your MON is just sitting there. Deposit it, maybe win the pot, always get it back." No DeFi knowledge required.

**Secondary: Monad community degens looking for excitement without the losses.**

The same users who bet on memecoins and prediction markets — they want the thrill but are tired of losing money. Everdraw is the product that gives them the excitement of a lottery with the financial outcome of a savings account. These users are the most vocal on Twitter and Discord — when they win, they post about it. They're the viral engine.

**Tertiary: ShMonad stakers who want upside on their staked position.**

Users already staking MON via ShMonad are earning yield but could be earning yield + prize chances through Everdraw. The migration pitch is compelling: same staking, same yield backing, but now you might also win the entire pot.

The 3-6 month strategy is deliberately focused on the Monad ecosystem. We're not trying to onboard normies or go cross-chain. We're going deep on one community, building social proof through real winners, and letting organic virality do the work. Every winner is a tweet. Every draw is a community event.

---

## 7. What is your wedge into the market?

**ShMonad integration + Monad community roots.**

Everdraw is the only prize savings protocol with a direct integration into Monad's native staking layer. Every deposit routes through ShMonad, which means every Everdraw user is simultaneously staking MON and securing the network. No other protocol has this alignment — it's not just a product feature, it's a narrative that resonates with the Monad Foundation, the ShMonad team, and the broader community.

The wedge is structural: as long as Monad has staking and ShMonad is the LST, Everdraw has a native yield source and a chain-aligned story that no competitor can replicate without the same integration. And because I'm embedded in the Monad community — not parachuting in from another ecosystem — the partnerships and distribution channels are already warm.

The wedge expands naturally: start with MON vaults backed by ShMonad staking yield, prove the model works, then expand to stablecoin vaults using yield from other Monad DeFi protocols (Curvance, Neverland, etc.). Each new vault type is a new wedge into a new user segment, all built on the same infrastructure.

---

## 8. What traction have you achieved so far?

- **Smart contract:** 39/39 tests passing. Full lifecycle (commit, draw, settle) validated on-chain with correct parameters.
- **Keeper bot:** Automated with preflight safety checks, Telegram alerting, and systemd service management. Runs autonomously — proven through a 24h+ burn-in test on Monad testnet with zero missed rounds.
- **Frontend:** Live dApp with wallet connect, circular vault timer, ticket purchasing, TVL/prize estimation, winner display, and claim/withdraw flows.
- **On-chain deployment:** Contract deployed on Monad testnet. Full round lifecycle (deposit, commit, draw, settle, claim) executed and verified.
- **ShMonad integration:** Native integration with Monad's largest LST. Deposits route directly to the staking layer — validated on testnet.
- **Operational hardening:** Keeper bot has preflight gates (blocks revert-bound transactions), error thresholds, Telegram alerting with timeout/retry/fallback, and has been validated through a structured Gate C burn-in process.
- **All built solo.** Full stack from Solidity to React to systemd — demonstrating extreme execution velocity and technical range.

This is not vaporware. There is a live, working protocol that can be demonstrated end-to-end on Monad testnet today.

---

## 9. What attracts you the most about Nitro?

The mentor access and the ecosystem proximity.

I'm a solo technical founder. I can build fast — the product proves that. What I can't do alone is navigate go-to-market strategy, community scaling, and ecosystem partnerships at the pace this opportunity demands. Nitro puts me in a room with founders who've built and scaled category-defining companies, and partners from Paradigm, Dragonfly, Electric Capital, and Castle Island who understand what it takes to go from "working product" to "protocol with real TVL."

The one month in NYC is particularly valuable. Face-to-face time with the Monad Foundation and ShMonad teams means I can align Everdraw's technical roadmap with Monad's staking infrastructure evolution in real-time. And in-person intros to other Monad-native protocols for yield source partnerships are worth more than months of cold outreach.

I also want to be honest: $500K in funding is meaningful, but what I value more is the signal. Being selected for Nitro tells the Monad ecosystem that Everdraw is a serious protocol backed by serious people. For a solo founder, that signal is the difference between "interesting side project" and "protocol worth depositing into."

---

## 10. Pick one mentor. What one question would you ask and to whom?

**TN from Pendle.**

"Pendle built an entirely new DeFi primitive — yield tokenization — that most people didn't understand at first. How did you navigate the gap between 'this is a genuinely better product' and 'users actually get it and deposit,' and what would you do differently if you were launching that category-creating product on a new chain like Monad today?"

I'm picking TN because Pendle is the closest parallel to what Everdraw is trying to do: take a financial concept that works in theory (yield splitting for Pendle, prize-linked savings for Everdraw), make it work on-chain, and then convince real users to trust it with real money. Pendle went from a niche idea to billions in TVL. They crossed the chasm from "technically interesting" to "essential DeFi infrastructure." That's the exact journey Everdraw needs to make, and TN has the scars and the playbook from having done it.
