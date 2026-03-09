# Everdraw — Prize Savings Infrastructure for Monad

**Monad Nitro Accelerator Application**

---

## The Problem

DeFi has a retention problem. Now more than ever, users are looking for higher yields, and bigger airdrops. DeFi is slowly losing users to betting markets like polymarket. But we know betting products generate engagement but ultimately destroy capital. Users get even more disengaged long term.

Prize-linked savings solves both: users deposit assets, get a chance win a much bigger pot of yield, and at the same time never lose their principal. The excitement of winning combined with the safety of saving. It's the most accessible DeFi product possible "Win the pot or keep your lot" and it creates a recurring engagement loop that brings users back every week.

A similar vision has been validated on Ethereum with over $17M in TVL, 88K+ wallets, and $10M+ in prizes distributed across 5+ years. But it doesn't exist on Monad. Everdraw changes that.

---

## What Everdraw Is

Everdraw is a no-loss prize savings protocol built from the ground up natively on Monad. For the MVP, users deposit MON into prize vaults. Deposits are staked via ShMonad, generating yield. That yield collected by all the shMon becomes the prize pool. A winner is drawn that wins the entire pot. Everyone gets their principal back.

No one loses money. The chain gains staked MON. Users have a reason to come back next week.

**What's already built:**
- Smart contract with full lifecycle automation (commit → draw → settle), 39/39 tests passing
- Automated keeper bot with preflight safety checks, Telegram alerting, systemd service management
- Live frontend: vault-door UI with circular progress timer, wallet connect, ticket purchase, claim/withdraw flows
- On-chain lifecycle validated. Full round executed and settled on Monad testnet
- Native ShMonad integration. Deposits route directly to Monad's staking layer

This isn't a whitepaper. The product works today.

---

## Why Monad

Founder is a Monad OG and true believer. Running hot Nad, Monvideo, localnads, Pipeline intern, and part of Keone's 1000 list.  Wants to see Monad succeed.

Everdraw has a close working partnership with ShMonad, currently the largest LST on Monad.

Every MON deposited into Everdraw gets staked via ShMonad. More Everdraw users = more MON staked = stronger network security. The protocol and the chain are symbiotically aligned. Everdraw doesn't just run on Monad, it strengthens Monad with every deposit.

No other chain has this alignment. On Ethereum, prize savings protocols route yield through third-party lending markets. On Monad, the yield comes from the chain's own consensus mechanism. Everdraw couldn't exist in its current form anywhere else.

**Monad's technical strengths unlock better prize savings UX:**
- 10,000 TPS handles concurrent ticket purchases across multiple vaults without congestion
- Sub-second finality means instant deposits and prize claims. No waiting for confirmations
- Low gas costs make micro-entries viable. 1 MON ticket works economically, broadening access beyond whales

**Monad's ecosystem has a gap Everdraw fills:**
- ~90% of current TVL sits in ported protocols (Uniswap, Curve, Aave). These are necessary infrastructure, but they're not native to Monad.
- Everdraw is purpose-built for Monad's staking economics. It brings a new user demographic: casual users who won't use a DEX or lending protocol but will play a no-loss lottery.
- Prize savings creates habitual usage. Unlike one-time DeFi interactions, Everdraw generates a weekly engagement loop that drives sustained on-chain activity.

---

## Why People Will Use It

**Behavioral economics:**

Humans are irrational about money but that irrationality can work in their favor. Academic research shows that prize-linked savings accounts generate 30-40% higher deposit rates than standard interest-bearing accounts. People will save more when there's a chance to win, even when the expected value is identical.

Traditional lotteries exploit this instinct destructively and players lose their money. Everdraw redirects it toward savings. The prize comes from yield, not from other players' losses.

**The simplest DeFi product to explain:**
"Deposit MON. Maybe win the pot. Always keep your lot"

No liquidation risk. No impermanent loss. No complex positions. No knowledge required beyond "deposit" and "withdraw." This is the product you can explain to someone who's never used DeFi.

**Built-in virality:**
Weekly winners create shareable moments. "I just won 5000 MON on Everdraw" is a tweet, a Discord flex, a reason for someone else to try it. Every winner is organic marketing. Every draw cycle is a content event.

---

## Vision — Where Everdraw Goes

The arc: **Product → Continuous → Multi-Asset → Platform → Infrastructure**

Each phase solves a specific user problem that the previous phase exposed.

---

**Phase 1 — Launch (Now → Month 2)**

Ship the product. Staggered multi-vault system ensures there's always a vault open to buy into. Community launch across Discord and Twitter/X. First real winners, first real social proof.

This phase validates the core loop: do users deposit? Do winners share? Do people come back?

This phase is about simplicity and building up big pots with as many users as possible. Multi-vault kept at 2 concurrent vaults only. First few big winners are celebrated immensely.

---

**Phase 2 — Continuous Deposits (Month 2-6)**

The biggest architectural leap. Everdraw moves from round-based mechanics to continuous prize savings, eliminating the timing problem entirely. When bootstrapping the protocol, engineering some wait times to build anticipation is an asset. But now, users would expect even more simplicity, flexibility and no more wait times.

**Time-Weighted Average Balance (TWAB):** Instead of buying tickets for a specific round, users simply deposit MON. The protocol tracks balances over time using a time-weighted average. Your chance to win in any draw = your TWAB / total pool TWAB. Deposit Tuesday, withdraw Friday. You earn chances for every day your MON was in the vault.

This changes everything:
- No more "missed the window." No more "come back in 7 days." Just deposit and you're in.
- Timing attacks become impossible — depositing right before a draw doesn't game the system, because your average balance over the draw period is negligible.
- Draws can happen daily instead of weekly. More draws = more winners = more engagement.

**Automatic prize distribution:** Winners no longer claim manually. On Monad we can build an incentivized bot network distributes prizes directly to winner wallets. Users wake up with MON they didn't expect — the most delightful UX in DeFi.

**Yield-to-prize liquidation:** ShMonad staking yield is continuously converted to prize tokens via automated auctions. No manual intervention. Yield flows to prizes autonomously.

The user experience becomes: *Deposit MON. Forget about it. Check if you won.* That's it.

---

**Phase 3 — Multi-Asset (Month 6-9)**

Prize savings isn't limited to one token. Any yield-bearing asset can fund prizes. This is where Everdraw stops being just "the MON prize pool" and opens itself up to the universal savings tokens, stablecoins

- **Stablecoin vaults (USDC/USDT)** — yield from other Defi protocols like Curvance, Neverland, Aave on Monad. Users deposit stables, earn yield + prize chances. Prizes paid in stables. Risk-averse users enter without holding volatile assets.

Each vault is an independent prize pool with its own asset, yield source, daily draw, and single winner.

**Prize boost campaigns:** Monad ecosystem protocols sponsor additional prizes on top of yield-generated prizes. e.g Neverland sponsors a 1,000 MON prize boost on the LST vault to attract stakers. Aave sponsors a USDC prize boost to drive deposits. This creates a new partnership model, protocols fund prizes as a user acquisition channel through Everdraw.

---

**Phase 4 — Platform (Month 9-18)**

Everdraw shifts from "we run prize pools" to "we ARE the prize pool infrastructure."

- **Permissionless vault creation** — any team, protocol, or DAO deploys a prize vault with one contract call via the Vault Factory. Choose your asset, yield source, and parameters.
- **ERC-4626 compatibility** — any yield source that follows the tokenized vault standard plugs in automatically. If it earns yield, it can power prizes.
- **Branded partner vaults** — Aave launches an "Aave Prize Vault." Kuru launches a "Kuru LP Prize Vault." Each protocol uses Everdraw's infrastructure but owns the user relationship and the narrative.
- **Vault discovery marketplace** — users browse all prize vaults on Monad by asset, yield rate, prize size, and depositor count.
- **Sustainable revenue via protocol fee** — Everdraw takes a small percentage of yield flowing through every vault. More vaults = more yield = more revenue. The protocol grows with the ecosystem without relying on token emissions or treasury drawdowns.
- **Sponsored deposits** — protocols deposit liquidity that doesn't earn prize chances but contributes yield to the prize pool, boosting prizes for real users. A new acquisition tool.

Network effects compound: more vaults → more TVL → bigger prizes → more users → more demand for vaults → more protocols launch vaults.

At this stage, Everdraw doesn't need to create every vault. The ecosystem creates them. Everdraw provides the rails.

---

**Phase 5 — Infrastructure (Year 1.5+)**

Everdraw becomes a composable building block — invisible infrastructure that other protocols integrate directly.

- **SDK and smart contract primitives** — any Monad dApp embeds prize savings into their product. A wallet app adds a "Save & Win" tab. A lending protocol offers "Prize Deposits." A DEX adds "Prize LP."
- **Institutional and treasury use** — DAOs park idle treasury funds in Everdraw vaults. Treasury management meets engagement.
- **Autonomous operation** — the protocol runs without admin intervention. Draws execute via incentivized bots. Yield liquidates via automated auctions. Prizes distribute automatically.
- **Cross-chain deposits TO Monad** — users on Ethereum, Arbitrum, and Base deposit into Monad prize vaults via bridge integrations. Prizes settle on Monad. This pulls liquidity and users into the Monad ecosystem.
- **Community governance** for protocol-level decisions — fee parameters, yield source standards, ecosystem grants. Strategic direction, not operations.

At this stage, most users don't know they're using Everdraw. They interact with their favorite Monad app and prize savings is just there underneath — like AWS under a web app.

---

**The endgame:**

Every yield-bearing asset on Monad has a prize vault. Every protocol can offer "deposit and win" with one integration. Prize-linked savings becomes a Monad-native financial primitive — as expected and ubiquitous as swap routing or lending rates. And every MON that flows through ShMonad-backed vaults strengthens Monad's staking security. The protocol and the chain grow together.

---

## Budget — $300K

| Category | Amount | Purpose |
|----------|--------|---------|
| Security audit | $50K | Full contract audit by reputable firm. Non-negotiable for DeFi launch. |
| Prize pool seeding | $75K | Bootstrap initial prize pools so early users see meaningful prizes. Solves the cold-start problem (small pools = tiny prizes = no motivation to deposit). |
| Marketing & community | $60K | Discord, Twitter/X, KOL partnerships, Monad community events, weekly winner content creation. |
| Team expansion | $70K | Community/marketing lead hire. 6-month runway for focused building. |
| Partnerships & integrations | $25K | LST protocol integrations, Aave v3 integration, ecosystem BD. |
| Infrastructure & ops | $20K | RPC costs, keeper hosting, monitoring, domain, hosting. |

**Why $300K, not $500K:** The product is already built. This isn't vaporware asking for build money. The ask is focused on security, growth, and ecosystem integration. Leaves room for performance-based follow-up funding. I rather earn the next tranche than ask for everything upfront.

---

## Traction & Proof of Execution

- **Smart contract:** 39/39 tests passing. Full lifecycle (commit → draw → settle) validated on-chain.
- **Keeper bot:** Automated with preflight safety checks, Telegram alerting, systemd service. Runs autonomously.
- **Frontend:** Live dApp — wallet connect, vault timer with circular progress ring, ticket purchase, TVL/prize estimation, winner display, claim/withdraw flows.
- **Deployment:** Contract deployed on Monad testnet with correct parameters (0.1 MON tickets, 7-day rounds).
- **All built by a solo technical founder** — full stack from Solidity to React to systemd — demonstrating extreme execution velocity.
- **Live demo available** — full vault lifecycle (deposit → commit → draw → settle → claim) can be demonstrated on Monad testnet. This is a working product, not slides.

---

## What We're Looking For From Nitro

- **Security audit connections** — introductions to reputable auditors with Monad ecosystem experience
- **Ecosystem partnerships** — warm intros to protocols for yield source integrations
- **Go-to-market mentorship** — community building, launch strategy, and growth playbook for a Monad-native DeFi product
- **Monad Foundation alignment** — ensuring Everdraw's ShMonad integration roadmap stays aligned with Monad's staking infrastructure evolution

---

## How We'd Use the 12 Weeks

**Month 1 (NYC, on-site):**
- Security audit kickoff
- In-person meetings with Monad Foundation and ShMonad team
- Ecosystem BD — face-to-face intros with Monad-native protocols for Phase 3/4 partnerships
- Community strategy workshops with Nitro mentors

**Months 2-3 (Remote):**
- Audit remediation and mainnet hardening
- Launch Phase 1 (staggered multi-vault) with prize pool seeding
- Community buildout — Discord, Twitter/X, first weekly winners
- Begin Phase 2 architecture (TWAB continuous deposits)
- Demo Day preparation with live on-chain metrics

---

## Metrics We'll Track

| Metric | Month 1 Target | Month 6 Target |
|--------|----------------|----------------|
| TVL | $500K | $2M |
| Weekly active depositors | 500 | 5,000 |
| Total prizes distributed | $10K | $200K |
| User retention (return within 7 days) | 40% | 60% |
| ShMonad staking contribution | Track | Publish |

---

## Risk Mitigation

- **Smart contract risk:** Full audit before mainnet launch (budgeted). Conservative initial parameters.
- **Cold-start risk:** Prize pool seeding ensures Day 1 prizes are meaningful. Prize boost partnerships provide additional incentive.
- **Yield risk:** ~0.8% round-trip cost observed on ShMonad staking. Transparent UX communication. Multi-asset vaults diversify yield source risk.
- **Operational risk:** Keeper bot redundancy. Autonomous operation roadmap. Preflight safety checks prevent gas burn on failed transactions.
- **Regulatory risk:** Protocol is non-custodial. No house edge. All yield goes to prizes. Users can withdraw principal at any time.
