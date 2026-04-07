# Everdraw — Nitro Accelerator Application Answers (v2)

---

One sentence of what this is?
Principal protected prize layer for DeFi yield

What are you building?
Everdraw is Monad's prize savings protocol — and its shared prize layer.

The core product: deposit MON, it stakes via ShMonad, the yield becomes a weekly prize pool. One depositor wins the pot. Everyone else gets their principal back. No one loses. "Win the pot or keep your lot."

But the larger bet is B2B2C. Protocols will spend millions on airdrops and points programs over the next 12 months. These incentive models whave a retention problem: 90%+ farmer churn, mercenary capital, and one-time engagement. Everdraw gives them an alternative. A protocol funds a prize campaignwith a simple treasury transfer. No contract changes on their side. No audit required. They get weekly engagement events and a dashboard showing retention lift, users keep coming back for the dopamine hit that betting markets are currently capitalizing on.



## 1. Why are you the right founder to build this?

I'm a full-stack technical founder who built the entire protocol solo. Solidity contracts, automated keeper infrastructure, and a live frontend in weeks. 39/39 tests passing, a keeper bot running on systemd with preflight safety checks and Telegram alerting, and a complete dApp with wallet connect, vault timers, ticket purchasing, and claim flows. All deployed and validated on Monad testnet and mainnet.

I'm also a Monad OG. I am a running hot Nad, Monvideo, localnads, Pipeline intern, and Keone's 1000 list. I'm not building on Monad because it's trendy. I'm building on Monad because I've been in this community from the start, stuck with it through the hard times and I want to see it win.

I am new to startups but I am hungry. Previously I submitted a project for Monad Moltiverse. I don't need to be convinced Monad is the right chain. I've already proven I can build fast, I understand the ecosystem, and I have a direct working relationship with many of the founders of Monad native dApps and have a partnership with Alex from ShMonad, the largest LST on Monad.

---

## 2. If selected, how do you plan to spend $500K?

$75K - Security audit - Comprehensive audit by a top-tier firm (e.g. Trail of Bits, OpenZeppelin, or a Monad-experienced auditor). Covers the prize vault contract, the CampaignManager infrastructure, and Phase 2 TWAB architecture. Non-negotiable for a protocol that holds user funds. 

$100k - Prize pool seeding - Bootstrap launch prize pools so early depositors see prizes worth winning from Day 1. Solves the cold-start problem. As protocol-funded campaigns scale, organic prize pools grow and seeding capital becomes recoverable. 

$200k - Team expansion - Hire a dedicated community/marketing lead and smart contract engineer. The engineer builds CampaignManager infrastructure and Phase 2 TWAB continuous deposits. The community lead runs Discord/Twitter buildout, KOL partnerships, Monad ecosystem events, and weekly winner content campaigns. Every draw cycle is a content event where winners sharing their wins is organic marketing. 6-9 month runway for focused building.

$75k - Partnerships & integrations - Ecosystem BD for protocol campaign partnerships. Includes co-funding the first "powered by Everdraw" pilot campaign with ShMonad, BD outreach to Monad-native protocols, building the partner analytics dashboard for campaign ROI tracking, and yield source integrations for multi-asset vaults (Curvance, Neverland, potential Aave on Monad).

$30k - Infrastructure & ops - RPC node costs, keeper bot hosting (redundant across regions), monitoring and alerting infrastructure, domain, frontend hosting, analytics.

$20k - Reserve - Buffer for unexpected costs, audit remediation, emergency response, gas costs during high-activity launches. 

The product is already built. The money is for accelerated launch-and-scale for both the B2C vault product and the B2B2C campaign infrastructure that turns Everdraw into Monad's prize layer. The audit, seeding and partnerships initiations are the difference between a testnet project and a build that protocols trust to run their user retention campaigns.

---

## 3. What problem are you solving and why does it matter?

DeFi has a retention problem.

1. Users are disengaged.
They're looking for higher yields and bigger airdrops. Betting markets like Polymarket are pulling users away because they offer excitement, but overtime they destroy capital. Users get even more disengaged long term.

2. Protocols are wasting growth budgets.
Protocols will spend millions on airdrops, liquidity mining, and points programs over the next 12 months. These tools have a proven problem: airdrops produce 90%+ farmer churn, liquidity mining creates mercenary capital that leaves when incentives stop, and points programs face increasing fatigue. Protocols need better retention tools.

Prize-linked staking solves both. Users deposit assets, get a chance to win a much bigger pot of yield, and importantly, never lose their principal. The excitement of winning combined with the safety of staking makes this the most accessible DeFi product possible.

Everdraw's tagline "Win the pot or keep your lot" creates a recurring engagement loop that brings users back every week. And for protocols, Everdraw offers a new primitive: prize campaigns where the same growth budget creates long term weekly engagement moments instead of one-time token dumps.

This is beneficial for Monad too because every MON deposited gets staked via ShMonad, further securing the network. The protocol and the chain are symbiotically aligned.
---

## 4. Who are your closest comparables and what do you understand that they don't?

**Closest comparable: PoolTogether.**

PoolTogether pioneered no-loss prize savings and validated the concept with 88K+ wallets, $10M+ in prizes over 5+ years. We respect what they built. PoolTogether V5 made the right architectural bet, a permissionless prize vault, ERC-4626 compatibility, TWAB, and a vault factory that anyone can deploy to. But in practice, V5 sits at ~$5M TVL despite having all of this infrastructure across six chains. The protocol that proved the model also exposed areas of improvement. Here's what Everdraw understands differently:

**1. We eliminate the entire liquidation layer permanently.**

PT V5's liquidation layer converts yield from different vault types into one common prize token (WETH) via CGDA auctions run by MEV-extracting arbitrage bots. This accounts for ~40% of total system complexity, creates an operational dependency on bot operators, and means every vault needs a liquidation pair. If bot operators disappear, the protocol stops functioning.

Everdraw vaults are self-contained: deposit MON, yield accrues in MON, prize paid in MON. Future USDC vault: deposit USDC, yield in USDC, prize in USDC. No conversion auctions, no intermediary token, no arbitrage bots. We never need a liquidation layer because each vault's yield stays native to its deposit token. That's an entire category of infrastructure we permanently avoid.

**2. One permissionless function replaces three bot ecosystems.**

PT V5 requires three separate bot types: Liquidation Bots (convert yield via Dutch auctions), Draw Bots (trigger RNG), and Claimer Bots (claim prizes via VRGDA). Each has its own incentive mechanism, operator ecosystem, and failure mode. If any one stops, the protocol breaks.

Everdraw's entire round lifecycle advances through one public function: `executeNext()`. Anyone can call it. The keeper bot is a convenience for automation, not a dependency. Even at scale with multiple vaults, each vault has its own `executeNext()` that any wallet can trigger.

**3. We have a native yield floor they can never have.**

PoolTogether's yield comes entirely from third-party lending markets. When lending yields compress, prizes shrink, deposits leave, and the flywheel reverses. They have no structural yield guarantee.

Everdraw starts with ShMonad staking, native consensus yield that exists as long as Monad runs. Even if we expand to additional yield sources (lending, LP), ShMonad remains a permanent yield floor that never goes to zero. Even in a DeFi winter where every lending market compresses, our core MON vault keeps producing prizes backed by staking yield. PoolTogether has never had, and structurally cannot build this kind of baseline because Ethereum's staking yield doesn't route through their protocol.

**5. We're building campaign infrastructure, not just a permissionless factory.**

PoolTogether V5 built permissionless vault deployment. But in practice, Protocol integration still requires understanding ERC-4626, liquidation pairs, TWAB mechanics, and bot economics. Everything must go through yield-bearing assets → yield generation → liquidation → prizes. There's no way to fund prizes directly with tokens. There's no campaign branding. There's no ROI analytics for protocols to measure retention lift.

Everdraw's Campaign Deposit Model solves this. A Monad protocol calls `createCampaign()` on Everdraw's CampaignManager contract, specifying prize token, budget, draw frequency, and eligibility criteria. They fund it with a simple token transfer. No need modification to their own contracts, no audit required on their side, no yield source needed. Eligibility is verified on-chain via token balance snapshots or Merkle allowlists. Everdraw handles draw execution, winner selection, claim flows, and frontend integration.

The result: any Monad protocol with a growth budget can run branded prize campaigns ("ShMonad Weekly Draw," "Kuru Trader Jackpot") through Everdraw's audited infrastructure instead of building their own lottery from scratch. Protocols keep their user relationship and branding. Everdraw provides the trusted, neutral prize engine.

This creates a fundamentally different value proposition than PoolTogether. PT says "deploy a vault, we'll liquidate your yield into prizes." Everdraw says "fund a campaign, we'll turn it into a recurring engagement loop for your users, and here's the dashboard showing it worked."

**6. Cross-protocol prize events that no single protocol can create.**

Because Everdraw is a neutral prize layer, multiple Monad protocols can co-fund a single mega draw. Imagine a "Monad Season Prize" where ShMonad, Kuru, Curvance, and Neverland each contribute to one massive prize pool. Every user who staked, swapped, lent, or provided liquidity across any participating protocol is eligible. One draw. One massive winner. Every protocol gets attribution.

No single protocol can create this. You need a trusted neutral layer. Monad's ecosystem is tight-knit. Founders know each other, protocols are collaborative. This is a moat that only a shared prize layer can build, and it's a moat that strengthens with every new protocol partner.

**7. The real competitive landscape isn't other prize protocols — it's token incentive spend.**

Everdraw doesn't primarily compete with PoolTogether or Pendle. Pendle creates yield price discovery; Everdraw creates yield-driven retention campaigns. They're complementary layers. Our real competition is whatever protocols currently spend on user acquisition: airdrops (one-time, 90%+ farmer churn), liquidity mining (mercenary capital that leaves), and points programs (increasing fatigue). Prize campaigns offer the same budget deployed as recurring engagement instead of one-time extraction.

**The bottom line:** PoolTogether proved prize savings works and pioneered the infrastructure play. But even with permissionless vaults and a factory, V5 sits at ~$5M TVL across six chains — because the integration barrier is still too high and there's no campaign model for protocols. Everdraw isn't a cheaper version of the same idea. It's what prize infrastructure becomes when integration means "make a treasury transfer" instead of "hire a DeFi engineer," and when the underlying chain is fast enough for flash draws, cheap enough for social group vaults, and composable enough to become ecosystem-wide campaign infrastructure.


ALTERNATIVE ANSWER

Closest comparable: PoolTogether.

PoolTogether pioneered no-loss prize savings and validated the concept with 88K+ wallets, $10M+ in prizes over 5+ years. PT V5  sits at ~$5M TVL across six chains. The protocol that proved the model also exposed areas of improvement. Here's what Everdraw understands differently:

1. Liquidation layer
PT V5's liquidation layer accounts fo ~40% of total system complexit. Converting yield from different vault types into one common prize token (WETH) via CGDA auctions run by MEV-extracting arbitrage bots. Everdraw vaults are self-contained, simplifying nd eliminating conversion auctions, intermediary tokens, and arbitrage bots. 

2. 3 bot system
PT V5 requires three separate bot types: Liquidation Bots, Draw Bots, and Claimer Bots. Each has its own incentive mechanism, operator ecosystem, and failure mode. Everdraw's entire round lifecycle advances through one public function: `executeNext()`. The keeper bot is a convenience for automation, not a dependency. 

3. Yield floor
PT yield comes entirely from third-party lending markets. When lending yields compress, prizes can shrink, and worst, user's principal can decrease. They have no structural yield guarantee. Everdraw starts with ShMonad staking. Even if we expand to additional yield sources, or through Defi winter, ShMonad remains a permanent stable yield floor. PoolTogether has never had this kind of baseline because Ethereum's staking yield doesn't route through their protocol.

4.Simplify campaigns
PT V5 built permissionless vault deployment. But in practice, protocol integration still requires understanding ERC-4626, liquidation pairs, TWAB mechanics, and bot economics. Everdraw's Campaign Deposit Model solves this. A Monad protocol calls `createCampaign()` on Everdraw's CampaignManager contract, specifying prize token, budget, draw frequency, and eligibility criteria. They fund it with a simple token transfer. No need modification to their own contracts, no audit required on their side, no yield source needed. Eligibility is verified on-chain via token balance snapshots or Merkle allowlists. Everdraw handles draw execution, winner selection, claim flows, and frontend integration.

5. Retention engine
PT focuses on the lottery aspect. Everdraw is a yield-driven retention engine. We keep users coming back by providing an alternative for protocols currently spending on user acquisition: airdrops (one-time, 90%+ farmer churn), liquidity mining (mercenary capital that leaves), and points programs (increasing fatigue).
---

## 5. What changed in the tech or market that makes this a good idea right now?

Three things converged:

1. Monad gives prize savings a yield floor for the first time.
Previous prize savings protocols lived and died by lending market yields. When yields compressed, prizes shrank, users left, and the flywheel reversed. Monad's native staking layer (ShMonad) changes the equation: A prize savings protocol can have a baseline yield source tied to chain consensus that doesn't depend on market conditions. This doesn't mean we ignore other yield sources. We plan to integrate lending and LP yields as additional vault types, but having a structural floor means the core product always works, even in a DeFi winter.

2. The market is starving for more.
Users are exhausted by DeFi's current low yield, low rewards environment. Betting markets are growing because they offer excitement, and the opportunity to strike big. The market is ready for a product that delivers the same dopamine hit without risk. The gap between "what users want" (excitement and safety) and "what DeFi offers" (complexity and risk) has never been wider.

3. Protocol incentive models are exhausted.
Airdrops produce 90%+ farmer churn. Points programs face increasing fatigue and skepticism. Liquidity mining creates mercenary capital that exits the moment incentives stop. Protocols are actively looking for better retention tools and prize campaigns offer a fundamentally different model. Instead of one-time token distribution, Everdraw offers recurring engagement that brings users back weekly. In tradfi, prize-linked savings research shows 30-40% higher deposit rates than standard interest-bearing accounts. Everdraw arrives at the exact moment protocols need this alternative most.
---

## 6. Tell us about the target segment you're tapping into in the next 3-6 months.

1. Monad-native community members who hold MON but aren't actively using it in DeFi.
These are the holders who are not LPing, lending, or actively farming. Their MON sits in a wallet doing nothing. Everdraw gives them a reason to put it to work with zero downside risk. The pitch is dead simple: "Your MON is just sitting there. Deposit it, maybe win the pot, always get it back." No DeFi knowledge required.

2. Monad community degens looking for excitement without the losses.
The same users who bet on memecoins and prediction markets, they want the thrill but are tired of losing money. Everdraw is the product that gives them the excitement of a lottery with the financial outcome of a savings account. These users are the most vocal on Twitter and Discord when they win, they post about it. They're the viral engine.

3. Stakers who want upside on their staked position.
Users already staking MON are earning yield but could be earning yield + prize chances through Everdraw. The migration pitch is compelling: same staking, same yield backing, but now you might also win the entire pot (plus Shmonad points).

4. B2B Monad protocols seeking capital-efficient user retention.
Every Monad protocol with a growth budget is a potential Everdraw partner. Instead of running airdrops with 90%+ churn, protocols fund prize campaigns through Everdraw that create recurring engagement. A protocol with $50K in growth budget can either airdrop tokens (one-time, users dump and leave) or fund 12 weekly Everdraw campaigns that each generate a social moment and bring users back. We start with ShMonad as the first pilot partner, then expand to DEXes, lending protocols, and other ecosystem players.
Furthermore , we can get multiple Monad protocols to co-fund a single mega draw. Imagine a "Monad Season Prize" where ShMonad, Kuru, Curvance, Neverland, etc  each contribute to one massive prize pool. Every user who staked, swapped, lent, or provided liquidity across any participating protocol is eligible. One draw. Massive winners. Every protocol gets attribution.
---

## 7. What is your wedge into the market?

ShMonad integration, Monad community roots and B2B2C infrastructure.

Everdraw is the only prize savings protocol with a direct integration into Monad's native staking layer. Every deposit routes through ShMonad, which means every Everdraw user is simultaneously staking MON and securing the network. No other protocol has this alignment.

The wedge starts B2C and expands to B2B2C. First, we launch our own prize vaults and prove the model works — users deposit, winners share, people come back. Then we open the CampaignManager to protocol partners. ShMonad being the first is ideal. They fund a "ShMonad Prize Draw" campaign through Everdraw, their stakers get prize chances, and we measure the retention lift together.

The wedge compounds from there: more protocol partners , bigger prizes, equals more users across protocols, equals more protocols want in. Each new partner adds to the network effect. A solo vault can never create this. Everdraw Infrastructure can.

The wedge is structural: as long as Monad has staking and ShMonad is the LST, Everdraw has a native yield source and a chain-aligned story that no competitor can replicate without the same integration. And because I'm embedded in the Monad community and not parachuting in from another ecosystem, the partnerships and distribution channels are already warm.

---

## 8. What traction have you achieved so far?

- **Smart contract:** 39/39 tests passing. Full lifecycle (commit, draw, settle) validated on-chain with correct parameters.
- **Keeper bot:** Automated with preflight safety checks, Telegram alerting, and systemd service management. Runs autonomously. Proven through a 24h+ burn-in test on Monad testnet with zero missed rounds.
- **Frontend:** Live dApp with wallet connect, circular vault timer, ticket purchasing, TVL/prize estimation, winner display, and claim/withdraw flows.
- **On-chain deployment:** Contract deployed on Monad testnet. Full round lifecycle (deposit, commit, draw, settle, claim) executed and verified.
- **ShMonad integration:** Native integration with Monad's largest LST. Deposits route directly to the staking layer. Validated on testnet.
- **Operational hardening:** Keeper bot has preflight gates (blocks revert-bound transactions), error thresholds, Telegram alerting with timeout/retry/fallback, and has been validated through a structured Gate C burn-in process.
- **All built solo.** Full stack from Solidity to React to systemd, demonstrating extreme execution velocity and technical range.

---

## 9. What attracts you the most about Nitro?

The mentor access and the ecosystem proximity.

I'm a solo technical founder. What I can't do alone is navigate go-to-market strategy, community scaling, and ecosystem partnerships at the pace this opportunity demands. Nitro puts me in a room with founders who've built and scaled category-defining companies, and partners who understand what it takes to go from "working product" to "protocol with real TVL."

The one month in NYC is particularly valuable. Face-to-face time with the Monad Foundation and ShMonad teams means I can align Everdraw's technical roadmap with Monad's staking infrastructure evolution in real-time. And in-person intros to other Monad-native protocols for campaign partnerships are worth more than months of cold outreach.

I also want to be honest: being chosen here is a signal. Being selected for Nitro tells me the Monad ecosystem values what I am building and in turn it shows users that Everdraw is a serious protocol backed by serious people. For a solo founder, that signal is the difference between "interesting side project" and "protocol worth depositing into."
---

## 10. Pick one mentor. What one question would you ask and to whom?

TN from Pendle

Pendle built an entirely new DeFi primitive — yield tokenization — that most people didn't understand at first. Everdraw is doing the same thing with prize-linked savings: a concept that's proven in traditional finance but new to DeFi. How did you navigate the gap between 'this is a genuinely better product' and 'users actually get it and deposit,' and what would you do differently if you were launching that category-creating product on a new chain like Monad today?"


---

## How We'd Use the 12 Weeks

**Weeks 1-4 (NYC, on-site):**
- Guarded mainnet launch: capped deposits, emergency pause enabled, rate-limited entry. Battle-tested on testnet, now validating on mainnet with guardrails before full ramp.
- Security audit kickoff with top-tier firm.
- In-person meetings with Monad Foundation and ShMonad team — align CampaignManager spec and pilot campaign parameters.
- Ecosystem BD: face-to-face intros with Monad-native protocols for future campaign partnerships.
- Community strategy workshops with Nitro mentors.

**Weeks 5-8 (Remote):**
- Build and deploy CampaignManager contract — the infrastructure that lets protocols fund prize campaigns through Everdraw.
- Integrate ShMonad as first campaign partner. ShMonad funds a pilot "ShMonad Prize Draw" campaign — no changes to ShMonad's contracts, just a treasury transfer to Everdraw's CampaignManager.
- Audit remediation and mainnet deposit cap increases as confidence grows.
- Community buildout — Discord, Twitter/X, first weekly winners generating content.

**Weeks 9-12 (Remote):**
- Run live pilot campaign with ShMonad. Collect hard data: D1/D7/D30 user retention, repeat deposit rates, TVL impact.
- Measure campaign ROI: cost per retained depositor vs. airdrop baseline.
- Publish pilot results — the proof point for the B2B2C thesis.
- Begin Phase 2 architecture (TWAB continuous deposits).
- Demo Day preparation with real on-chain metrics proving both B2C vault retention and B2B2C campaign effectiveness.

---

## Metrics We'll Track

| Metric | Month 1 Target | Month 6 Target |
|--------|----------------|----------------|
| TVL | $500K | $2M |
| Weekly active depositors | 500 | 5,000 |
| Total prizes distributed | $10K | $200K |
| D7 user return rate | 40% | 60% |
| D30 user return rate | 20% | 40% |
| Repeat deposit rate | 30% | 50% |
| Cost per retained depositor | Measure vs. airdrop baseline (~5-10% D30) | <50% of airdrop CAC |
| Protocol campaign partners | 1 (ShMonad pilot) | 3-5 |
| Campaign-funded TVL delta | Track pilot impact | Publish |
| ShMonad staking contribution | Track | Publish |

---

## Risk Mitigation

- **Smart contract risk:** Full audit before mainnet ramp (budgeted). Guarded launch with capped deposits and emergency pause — no wide-open custody launch without audit completion.
- **Cold-start risk:** Prize pool seeding ensures Day 1 prizes are meaningful. Protocol-funded campaigns add additional prize pools beyond yield-generated prizes. As organic TVL grows, seeding becomes recoverable.
- **Yield risk:** ~0.8% round-trip cost observed on ShMonad staking. Transparent UX communication. Multi-asset vaults diversify yield source risk.
- **Operational risk:** Keeper bot redundancy. Autonomous operation roadmap. Preflight safety checks prevent gas burn on failed transactions.
- **Integration risk:** Campaign Deposit Model isolates all risk to Everdraw's audited contracts. Partner protocols never modify their own code — they fund campaigns with a simple token transfer. No partner-side audit required.
- **Regulatory risk:** Not gambling — users never lose principal, prizes are funded by yield (not participant losses), there is no house edge. Prize-linked savings is legal and regulated in 33+ US states and the UK (Premium Bonds, £131B+ held by 24M+ people). Protocol is non-custodial. Users can withdraw principal at any time.

---

## What We're Looking For From Nitro

- **Security audit connections** — introductions to reputable auditors with Monad ecosystem experience
- **Ecosystem partnerships** — warm intros to protocols for campaign partnerships (the B2B2C thesis needs partners)
- **Go-to-market mentorship** — community building, launch strategy, and growth playbook for a Monad-native DeFi product
- **Monad Foundation alignment** — ensuring Everdraw's infrastructure roadmap stays aligned with Monad's staking and ecosystem evolution
- **Campaign pilot support** — help structuring and promoting the first "powered by Everdraw" campaign with ShMonad
