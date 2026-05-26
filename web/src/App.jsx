import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import VaultAnimationTest from './components/VaultAnimationTest'
import './App.css'

// Vercel build-ignore guard markers for production deploys: points/preview, setMaxTickets.
const POOL_ABI = [
  'function currentRoundId() view returns (uint256)',
  'function getRoundInfo(uint256 rid) view returns (uint8 state,uint64 salesEndTime,uint32 totalTickets,uint256 totalPrincipalMON,uint256 totalShmonShares,uint256 targetBlockNumber,address winner,uint32 winningTicket,uint64 unstakeCompletionEpoch,uint256 monReceived,uint256 yieldMON,uint256 lossRatio,bool prizeClaimed)',
  'function nextExecutable() view returns (uint256 rid,uint8 action)',
  'function ticketPriceMON() view returns (uint96)',
  'function roundDurationSec() view returns (uint32)',
  'function shmon() view returns (address)',
  'function buyTickets(uint32 ticketCount) payable',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function principalMON(uint256 rid, address user) view returns (uint256)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)'
]

const POOL_V2_ABI = [
  'function currentRoundId() view returns (uint256)',
  'function getRoundInfo(uint256 rid) view returns (uint8 state,uint64 salesEndTime,uint64 targetBlockNumber,uint32 totalTickets,uint256 totalPrincipalMON,uint256 totalShmonShares,uint256 principalSharesAtSettle,uint256 prizeShares,uint256 shareRateAtSettle,address winner,uint32 winningTicket,bool prizeClaimed)',
  'function nextExecutable() view returns (uint256 rid,uint8 action)',
  'function ticketPriceMON() view returns (uint96)',
  'function roundDurationSec() view returns (uint32)',
  'function yieldPeriodSec() view returns (uint32)',
  'function getCommitAfterTime(uint256 rid) view returns (uint64)',
  'function shmon() view returns (address)',
  'function buyTicketsMON(uint32 ticketCount) payable',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function getUserPosition(uint256 rid, address user) view returns (uint128 principalMON, uint128 principalShmonShares)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)'
]

const ACTION_LABELS = ['None', 'Skip', 'Commit', 'Draw', 'Settle', 'Recommit']
const STATE_LABELS = ['Open', 'Committed', 'Finalizing', 'Settled']
const ACTION_LABELS_V2 = ['None', 'Commit', 'Claim / Redeem', 'Mark Skipped']
const STATE_LABELS_V2 = ['Deposit Open', 'Winner Revealed', 'Claim / Redeem', 'Skipped', 'Skipped']
const ACTION_LABELS_V3 = ['None', 'Skip', 'Commit', 'Finalize']
const STATE_LABELS_V3 = ['Deposit Open', 'Awaiting VRF', 'Winner Revealed', 'Claim / Redeem']

const SHMON_ABI = [
  'function getInternalEpoch() view returns (uint64)'
]

function parsePoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES, import.meta.env.VITE_POOL_ADDRESS)
}

function parseV2PoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES_V2, import.meta.env.VITE_POOL_ADDRESS_V2)
}

function parseV3PoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES_V3, import.meta.env.VITE_POOL_ADDRESS_V3)
}

function parseAddressEnv(rawList, single) {
  const list = (rawList || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (list.length === 0 && single) list.push(single.trim())

  const seen = new Set()
  const out = []
  for (const addr of list) {
    if (!ethers.isAddress(addr)) continue
    const lc = addr.toLowerCase()
    if (seen.has(lc)) continue
    seen.add(lc)
    out.push(addr)
  }
  return out
}

function normalizeWalletAllowlist(entries) {
  const seen = new Set()
  const out = []
  for (const entry of entries) {
    const addr = String(entry || '').trim().toLowerCase()
    if (!ethers.isAddress(addr)) continue
    if (seen.has(addr)) continue
    seen.add(addr)
    out.push(addr)
  }
  return out
}

function parseWalletAllowlist() {
  const raw = import.meta.env.VITE_WALLET_ALLOWLIST || ''
  return normalizeWalletAllowlist(raw.split(','))
}

function hexChainIdToDec(hexId) {
  if (!hexId) return null
  return Number.parseInt(hexId, 16)
}

function shortAddr(addr) {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}


function getIndexerBaseUrl() {
  return String(import.meta.env.VITE_INDEXER_URL || 'https://everdraw-indexer.fly.dev').replace(/\/$/, '')
}

function buildParticipantRows(rawRows, totalTicketsRaw) {
  const totalTicketsNum = Number(totalTicketsRaw ?? 0)
  return (Array.isArray(rawRows) ? rawRows : [])
    .map((p) => {
      const wallet = p.wallet || p.buyer || p.address
      const tickets = Number(p.tickets ?? p.ticketCount ?? 0)
      const paidRaw = p.monPaid ?? p.depositedWei ?? p.deposited_mon_wei ?? 0
      if (!wallet || !ethers.isAddress(wallet) || tickets <= 0) return null
      return {
        wallet,
        walletShort: shortAddr(wallet),
        tickets,
        sharePct: totalTicketsNum > 0 ? ((tickets / totalTicketsNum) * 100).toFixed(2) : '0.00',
        depositedMon: Number(ethers.formatEther(BigInt(paidRaw))).toFixed(4),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.tickets - a.tickets)
}

function tierClass(tier) {
  return `tier-chip tier-${String(tier || 'Bronze').toLowerCase()}`
}

function PointsHeaderWidget({ account, points }) {
  const [open, setOpen] = useState(false)
  if (!account) return null
  const p = points || {}
  const lifetimePoints = Number(p.lifetime_points || 0)
  const streakWeeks = Number(p.current_streak_weeks || 0)
  return (
    <div className="points-header">
      <button className="points-pill" type="button" onClick={() => setOpen((v) => !v)} aria-label={`${lifetimePoints.toLocaleString()} points, ${streakWeeks} week streak`}>
        <span className="points-pill-stat points-pill-points" title="Points"><span aria-hidden="true">✦</span>{lifetimePoints.toLocaleString()}</span>
        <span className="points-pill-stat points-pill-streak" title="Weekly streak"><span aria-hidden="true">🔥</span>{streakWeeks}</span>
      </button>
      {open ? (
        <div className="points-popover points-popover-simple">
          <div className="points-popover-kicker">Total points balance</div>
          <div className="points-popover-total">{lifetimePoints.toLocaleString()}</div>
          <a href="#profile" className="points-profile-link">Show profile →</a>
        </div>
      ) : null}
    </div>
  )
}

function PointsBreakdown({ item }) {
  if (!item) return null
  const bonuses = item.bonuses_breakdown || {}
  const bonusText = Object.entries(bonuses).map(([k, v]) => `${k.replaceAll('_', ' ')} +${v}`).join(', ')
  return (
    <div className="points-earned-line">
      +{item.total_points} points earned
      <small>base {item.base_points}, streak ×{(item.multiplier_x100 / 100).toFixed(2)}{bonusText ? `, ${bonusText}` : ''}</small>
    </div>
  )
}

function ProfilePage({ account, points, history }) {
  if (!account) return <section className="participants-card points-page"><h2>Your Points</h2><p>Connect a wallet to view your EverDraw points profile.</p></section>
  const streakWeeks = Number(points?.current_streak_weeks || 0)
  const multiplierX100 = Number(points?.current_multiplier_x100 || 100)
  const dotCount = 52
  const litDots = Math.max(0, Math.min(dotCount, streakWeeks))
  const highestMilestoneAwarded = Number(points?.highest_streak_milestone_awarded || 0)
  const streakMilestones = [
    { weeks: 4, tooltip: '4 week streak +50' },
    { weeks: 13, tooltip: '13 week streak +200' },
    { weeks: 26, tooltip: '26 week streak +500' },
    { weeks: 52, tooltip: '52 week streak +1000' },
  ].map((m) => ({ ...m, claimed: highestMilestoneAwarded >= m.weeks || streakWeeks >= m.weeks }))
  const noWinWeeks = Number(points?.current_no_win_streak_weeks || points?.no_win_streak_weeks || 0)
  const firstDepositDone = Boolean(points?.first_deposit_completed || points?.has_deposited || Number(points?.deposit_count || 0) > 0)
  const firstWinDone = Boolean(points?.first_win_completed || points?.has_won || Number(points?.win_count || 0) > 0)
  const twoVaultsDone = Boolean(points?.two_vaults_completed || Number(points?.vault_count || points?.vaults_entered || 0) >= 2)
  const bonuses = [
    { key: 'first-deposit', label: 'First Deposit', unlocked: firstDepositDone, tooltip: 'A first time playing bonus +25' },
    { key: 'first-win', label: firstWinDone ? 'First Win' : 'Hidden', unlocked: firstWinDone, hidden: !firstWinDone, tooltip: 'Congrats on your first win! +100' },
    { key: 'one-two-double', label: twoVaultsDone ? 'One Two Double' : 'Hidden', unlocked: twoVaultsDone, hidden: !twoVaultsDone, tooltip: 'Active in both vaults +50' },
    { key: 'rising', label: noWinWeeks >= 10 ? 'Rising' : 'Hidden', unlocked: noWinWeeks >= 10, hidden: noWinWeeks < 10, tooltip: 'Hang in there +50' },
    { key: 'ascended', label: noWinWeeks >= 26 ? 'Ascended' : 'Hidden', unlocked: noWinWeeks >= 26, hidden: noWinWeeks < 26, tooltip: 'Virtuous patience must be rewarded +200' },
    { key: 'transcended', label: noWinWeeks >= 52 ? 'Transcended' : 'Hidden', unlocked: noWinWeeks >= 52, hidden: noWinWeeks < 52, tooltip: 'Few have reached this level of transcendence +500' },
  ]
  const ensName = points?.ens && !ethers.isAddress(points.ens) && points.ens.toLowerCase() !== account.toLowerCase() ? points.ens : ''
  const recentRounds = (history || []).slice(0, 12)
  return (
    <section className="participants-card points-page">
      <div className="points-page-head">
        <div>
          <h2>{ensName || 'Your Points'}</h2>
          <span>{shortAddr(account)}</span>
        </div>
      </div>
      <div className="points-profile-layout points-profile-layout-rewards">
        <div className="points-profile-summary points-profile-main-card rewards-main-card">
          <div className="points-popover-kicker rewards-kicker">Total points balance</div>
          <div className="points-profile-total rewards-total">{Number(points?.lifetime_points || 0).toLocaleString()}</div>
          <div className="rewards-pill-row">
            <div className="points-multiplier-pill rewards-multiplier-pill"><span>Active multiplier</span><strong>{(multiplierX100 / 100).toFixed(2)}x</strong></div>
            <div className={`${tierClass(points?.current_tier)} rewards-tier-pill`}>{points?.current_tier || 'Bronze'}</div>
          </div>

          <div className="points-streak-mini rewards-streak-block">
            <div>
              <span className="points-popover-kicker">Weekly participation</span>
              <strong>{streakWeeks} Week Streak</strong>
            </div>
            <div className="points-streak-dots points-streak-dots-52" aria-label={`${litDots} of ${dotCount} weeks active`}>
              {Array.from({ length: dotCount }).map((_, i) => {
                const week = i + 1
                const milestone = streakMilestones.find((m) => m.weeks === week)
                return <span key={week} title={milestone?.tooltip || `Week ${week}`} className={`${i < litDots ? 'lit' : ''} ${milestone ? 'milestone-dot' : ''} ${milestone?.claimed ? 'claimed' : ''}`} />
              })}
            </div>
          </div>
        </div>

        <aside className="points-profile-side rewards-side-card">
          <div className="points-milestones-panel rewards-milestones-panel rewards-bonuses-panel">
            <h3>Bonuses</h3>
            <div className="points-milestone-list rewards-bonus-list">
              {bonuses.map((bonus) => (
                <div className={`points-milestone-row rewards-bonus-row ${bonus.unlocked ? 'claimed' : 'locked'} ${bonus.hidden ? 'hidden-bonus' : ''}`} key={bonus.key} title={bonus.tooltip}>
                  <span className="points-milestone-icon" aria-hidden="true">{bonus.unlocked ? '✓' : bonus.hidden ? '?' : ''}</span>
                  <div>
                    <strong>{bonus.label}</strong>
                    <small>{bonus.hidden ? 'Reveal by playing' : bonus.unlocked ? 'Unlocked' : 'Available bonus'}</small>
                  </div>
                  <span className="points-milestone-status">{bonus.unlocked ? 'Unlocked' : bonus.hidden ? 'Hidden' : 'Lock'}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="points-recent-rounds">
        <h3>Recent rounds</h3>
        <div className="participants-table">
          <div className="participants-row participants-header points-rounds-row"><span>Round</span><span>Base</span><span>Multiplier</span><span>Total</span></div>
          {recentRounds.length === 0 ? (
            <div className="points-empty-state">No rounds yet. Buy a ticket to start earning.</div>
          ) : recentRounds.map((h) => (
            <div className="participants-row points-rounds-row" key={`${h.pool_address}:${h.round_id}`}><span>#{h.round_id}</span><span>{h.base_points}</span><span>×{(h.multiplier_x100 / 100).toFixed(2)}</span><span>+{h.total_points}</span></div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LeaderboardPage({ account }) {
  const [period, setPeriod] = useState('all')
  const [rows, setRows] = useState([])
  useEffect(() => {
    fetch(`${getIndexerBaseUrl()}/api/leaderboard?limit=100&period=${period}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
  }, [period])
  const currentRow = account ? rows.find((r) => r.wallet?.toLowerCase() === account.toLowerCase()) : null
  return (
    <section className="participants-card points-page">
      <div className="points-page-head"><h2>Leaderboard</h2><div><button className="max-btn" onClick={() => setPeriod('all')}>All time</button><button className="max-btn" onClick={() => setPeriod('month')}>This month</button></div></div>
      <div className="participants-table leaderboard-table">
        <div className="participants-row participants-header"><span>#</span><span>Wallet</span><span>Tier</span><span>Streak</span><span>Points</span></div>
        {rows.map((r, i) => <div className="participants-row" key={r.wallet}><span>{i + 1}</span><span>{r.ens || shortAddr(r.wallet)}</span><span><span className={tierClass(r.current_tier)}>{r.current_tier}</span></span><span>🔥 {r.current_streak_weeks}w</span><span>{Number(period === 'month' ? r.month_points : r.lifetime_points).toLocaleString()}</span></div>)}
      </div>
      {account && !currentRow ? <div className="leaderboard-sticky">Your wallet is currently outside the top 100. Keep cooking, boss.</div> : null}
    </section>
  )
}

function formatCountdown(seconds) {
  if (seconds <= 0) return '0:00:00:00'
  const d = Math.floor(seconds / 86400)
  const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return `${d}:${h}:${m}:${s}`
}

async function getReadProvider() {
  if (import.meta.env.VITE_RPC_URL) {
    return new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL)
  }
  if (window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum)
  }
  throw new Error('Missing VITE_RPC_URL and no wallet found')
}

function normalizeError(e) {
  const msg = e?.reason || e?.shortMessage || e?.message || 'Unknown error'
  const low = String(msg).toLowerCase()
  if (msg.includes('network does not support ENS') || msg.includes('getEnsAddress')) {
    return 'Config error: VITE_POOL_ADDRESSES/VITE_POOL_ADDRESS must be hex contract address(es) (0x...), not names.'
  }
  if (low.includes('rejected') || low.includes('user denied') || e?.code === 4001) {
    return ''
  }
  return msg
}

function FounderLaunchArticle() {
  return (
    <main className="article-page">
      <a href="/" className="back-link article-back">← Back to EverDraw</a>
      <article className="founder-article">
        <header className="article-hero">
          <div className="article-hero-glow" aria-hidden="true" />
          <div className="article-kicker">Founder Note</div>
          <h1>Drawn Back to DeFi: Why I Built EverDraw</h1>
          <div className="article-meta">By Gman · May 13, 2026</div>
          <div className="article-hero-tags" aria-label="EverDraw themes">
            <span>Principal protected</span>
            <span>Monad native</span>
            <span>Yield-funded prizes</span>
          </div>
        </header>

        <section>
          <h2>When DeFi Felt Alive</h2>
          <p>I came into DeFi through the same door as most. The yield farming, LP positions, ridiculous APYs, new communities, that was where crypto first felt alive to me. Back then, it almost felt like you could close your eyes, throw a dart at a new chain, and somehow still find a net profit. Ethereum, Polygon, Fantom, Avalanche; each ecosystem felt like another frontier, and if you were early enough, curious enough, and stubborn enough to learn, there was real opportunity waiting somewhere. Who still remembers the era of the “rebasing” token? Those were the days.</p>
          <p>Now there are more protocols than ever, but the rewards often feel smaller, more fragmented, and less worth the effort required to chase them. Users are not only spreading their liquidity across too many places; they are spreading their time and attention too.</p>
        </section>

        <section>
          <h2>The Feeling Prediction Markets Found</h2>
          <p>I think that is why prediction markets found so much oxygen. Prediction markets did not beat DeFi on fundamentals. They beat it on feeling. They gave people back that dopamine hit and, more importantly, they gave people a shot at something that could feel meaningful very quickly. In this economy, a lot of people are desperate to get at least one foot out of the meat grinder.</p>
          <p>I do not say that as an attack on prediction markets. Their success is a signal. People have not stopped wanting upside or excitement. What they have lost is the sense that DeFi is still the place that gives them that feeling.</p>
          <p>The irony is that this version of hope often ends the same way... users get wrecked. To gain the upside, users are asked to accept ruin as the price of admission.</p>
          <blockquote className="article-pullquote">People still want to dream. But they should not have to sleep on a bed of dynamite to do so.</blockquote>
          <p>That is why I built EverDraw.</p>
        </section>

        <section>
          <h2>What EverDraw Is</h2>
          <p>EverDraw is a principal-protected prize layer for Monad. Users deposit MON. The deposit is held as shMON and earns staking yield. All yield accumulated that round is pooled into one prize. At the end of the round, one winner takes the entire pool. But the best part is everyone else gets their entire principal back.</p>
          <figure className="article-flow-figure">
            <img src="/everdraw-round-flow.png" alt="EverDraw round flow: deposits open, staked as shMON, vault locked, winner revealed, vault unlocks, redeem shMON, and new vault starts" />
          </figure>
          <p>That is the product in its simplest form. No liquidations. No impermanent loss. No active position management. No complicated strategy. You enter the draw, the yield does its work, and either you win the pot or you get back your original deposit.</p>
          <p>EverDraw keeps the thing people still want — a shot at meaningful upside — while removing the part that usually makes that shot destructive.</p>
        </section>

        <section>
          <h2>The Everdraw Edge</h2>
          <p>I also want to be honest about what EverDraw is and is not. Principal-protected prize savings is not a brand-new idea, and I am not interested in pretending otherwise. Versions of this concept have existed before, both in traditional finance and in crypto. The difference is in the specific combination EverDraw is building around: Monad staking yield through shMON, and a long-term vision where draws become engagement infrastructure rather than just a standalone vault. Let’s talk about both.</p>
          <p>First, the yield source. Most prize-savings products have to send user deposits into lending markets to generate yield. That can work, but it also means the prize is tied to lending demand, utilisation, borrow rates, and the risk assumptions of another protocol. EverDraw’s first version works differently because it is built on Monad staking yield through shMON. The deposited MON becomes productive through staking, and that staking yield becomes the prize. This is one of the reasons EverDraw makes sense on Monad specifically: the chain gives us a native yield source that can be turned into a shared prize without depending on a third-party lending market or inflationary incentives that disappear when a campaign ends.</p>
          <p>Second, the vision. A simple prize-savings product is useful, but on its own it is still just a product. EverDraw starts with a simple user-facing vault because that is the cleanest way to prove the loop, but the larger idea is to turn the draw mechanic into an engagement layer for Monad. That means more assets, more draw formats, protocol campaigns, sponsored prize pools, and eventually tools that let other projects use recurring prize mechanics to distribute rewards.</p>
        </section>

        <section>
          <h2>From Vault to Engagement Layer</h2>
          <p>This matters because DeFi does not just have a liquidity problem. It has a retention problem. Airdrops create a single burst of attention. Liquidity mining often attracts mercenary capital that leaves as soon as rewards dry up. Protocols keep paying users to show up once, then struggle to make them stay.</p>
          <p>EverDraw provides an alternative model: recurring participation built around anticipation rather than obligation. If a protocol has yield, it can turn that yield into a reason for users to return. If a community wants a shared weekly moment, it can create one. If an ecosystem wants activity that feels less extractive and more fun, prize savings can become a useful primitive.</p>
          <p>That is the part that excites me most. EverDraw starts as a simple user product, but the long-term vision is an engagement layer where yield becomes something people can feel, not just something displayed as a small percentage on a dashboard.</p>
        </section>

        <section>
          <h2>Why Monad</h2>
          <p>Monad is the right home for that vision. I have been in Monad since the early days, creating, participating, learning, and believing alongside the ecosystem before EverDraw existed. I was not looking for a hot chain to attach a product to. I wanted to build something that made sense for the community I was already part of.</p>
          <p>The alignment is also practical. EverDraw deposits become shMON exposure. The prize comes from Monad staking yield. Instead of being another app that fragments attention and pulls capital away from the ecosystem, EverDraw is designed to draw capital back into Monad and make that capital productive inside the network.</p>
        </section>

        <section>
          <h2>For Everyone Still Drawn to the Dream</h2>
          <p>EverDraw is designed to make anticipation feel sustainable. You can care about the outcome without needing to put your whole stack at risk. You can miss the prize and still remain intact. You can return for the next draw not because you were trapped, liquidated, or diluted into staying, but because the product gives you a clean reason to try again.</p>
          <p>The first EverDraw vault is coming very soon. Follow <a href="https://x.com/everdrawing" target="_blank" rel="noopener noreferrer">@everdrawing</a> and stay tuned for the launch.</p>
          <p>With EverDraw I am not promising guaranteed riches, I am promising a chance to say WAGMI again.</p>
          <p>For everyone still drawn to the dream.</p>
        </section>

        <footer className="article-cta article-cta-feature">
          <div className="article-cta-copy">
            <span>The first vault is coming soon</span>
            <strong>Follow EverDraw for launch updates.</strong>
            <p>Win the pot. Or keep your lot.</p>
          </div>
          <div className="article-cta-links">
            <a href="/">Open app</a>
            <a href="https://docs.everdraw.xyz" target="_blank" rel="noopener noreferrer">Docs</a>
            <a href="https://x.com/everdrawing" target="_blank" rel="noopener noreferrer">Follow @everdrawing</a>
          </div>
        </footer>
      </article>
    </main>
  )
}

function Header({ account, onConnect, currentPage, points }) {
  return (
    <header>
      <div className="logo">EverDraw</div>
      <nav className="nav-links">
        <a href="#vault" className={`nav-link ${currentPage === 'vault' ? 'active' : ''}`}>Vault</a>
        <a href="#profile" className={`nav-link ${currentPage === 'profile' ? 'active' : ''}`}>Profile</a>
        <a href="#leaderboard" className={`nav-link ${currentPage === 'leaderboard' ? 'active' : ''}`}>Leaderboard</a>
        <a href="/articles/drawn-back-to-defi" className={`nav-link ${currentPage === 'article' ? 'active' : ''}`}>Articles</a>
        <a href="https://docs.everdraw.xyz" target="_blank" rel="noopener noreferrer" className="nav-link">Docs</a>
      </nav>
      <PointsHeaderWidget account={account} points={points} />
      <button className="btn" onClick={onConnect}>
        {account ? shortAddr(account) : 'Connect Wallet'}
      </button>
    </header>
  )
}

function StatCard({ label, value, sub, icon }) {
  return (
    <div className="stat-card">
      <div className="card-header">
        <div className="stat-label">{label}</div>
        <div className="card-icon icon-primary" aria-hidden="true">{icon}</div>
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-sub">{sub}</div>
      </div>
    </div>
  )
}

function VaultDoorBackground({ progressPct, salesOpen }) {
  const clamped = Math.max(0, Math.min(100, Number(progressPct) || 0))
  const r = 142
  const c = 2 * Math.PI * r
  const offset = c * (1 - clamped / 100)
  const progressColor = salesOpen ? '#22c55e' : '#9B6DFF'

  return (
    <svg viewBox="0 0 320 320" className="vault-door" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <mask id="armAccentMask">
          <rect x="0" y="0" width="320" height="320" fill="white" />
          <circle cx="160" cy="160" r="66" fill="black" />
        </mask>
      </defs>

      <rect x="0" y="0" width="320" height="320" fill="#141026" />

      <circle cx="160" cy="160" r="155" fill="none" stroke="#1D1836" strokeWidth="0.5" strokeDasharray="1 3" />
      <circle cx="160" cy="160" r="150" fill="none" stroke="#1D1836" strokeWidth="0.5" strokeDasharray="1 2" />

      <circle cx="160" cy="160" r="142" fill="none" stroke="#251F45" strokeWidth="12" />
      <circle cx="160" cy="160" r="136" fill="none" stroke="#3D2E6B" strokeWidth="2" />

      {/* Original arm geometry (unchanged) */}
      <g stroke="#3D2E6B" strokeWidth="1" fill="#1C1533">
        <rect x="145" y="20" width="30" height="80" rx="2" />
        <rect x="153" y="20" width="14" height="80" fill="#251C42" />
        <rect x="145" y="220" width="30" height="80" rx="2" />
        <rect x="153" y="220" width="14" height="80" fill="#251C42" />
        <rect x="20" y="145" width="80" height="30" rx="2" />
        <rect x="20" y="153" width="80" height="14" fill="#251C42" />
        <rect x="220" y="145" width="80" height="30" rx="2" />
        <rect x="220" y="153" width="80" height="14" fill="#251C42" />
        <rect x="75" y="75" width="30" height="50" rx="2" transform="rotate(-45 90 100)" />
        <rect x="215" y="75" width="30" height="50" rx="2" transform="rotate(45 230 100)" />
        <rect x="75" y="195" width="30" height="50" rx="2" transform="rotate(45 90 220)" />
        <rect x="215" y="195" width="30" height="50" rx="2" transform="rotate(-45 230 220)" />
      </g>

      {/* Subtle green border overlay only during sales-open; no geometry changes */}
      {salesOpen ? (
        <g
          fill="none"
          stroke="rgba(34, 197, 94, 0.58)"
          strokeWidth="0.9"
          mask="url(#armAccentMask)"
          style={{ filter: 'drop-shadow(0 0 2px rgba(34, 197, 94, 0.14))' }}
        >
          <rect x="145" y="20" width="30" height="80" rx="2" />
          <rect x="145" y="220" width="30" height="80" rx="2" />
          <rect x="20" y="145" width="80" height="30" rx="2" />
          <rect x="220" y="145" width="80" height="30" rx="2" />
          <rect x="75" y="75" width="30" height="50" rx="2" transform="rotate(-45 90 100)" />
          <rect x="215" y="75" width="30" height="50" rx="2" transform="rotate(45 230 100)" />
          <rect x="75" y="195" width="30" height="50" rx="2" transform="rotate(45 90 220)" />
          <rect x="215" y="195" width="30" height="50" rx="2" transform="rotate(-45 230 220)" />
        </g>
      ) : null}

      <g opacity="0.15">
        <line x1="100" y1="100" x2="220" y2="100" stroke="#9B6DFF" strokeWidth="0.5" />
        <line x1="100" y1="105" x2="220" y2="105" stroke="#9B6DFF" strokeWidth="0.5" />
        <line x1="100" y1="215" x2="220" y2="215" stroke="#9B6DFF" strokeWidth="0.5" />
        <line x1="100" y1="220" x2="220" y2="220" stroke="#9B6DFF" strokeWidth="0.5" />
      </g>

      <circle cx="160" cy="160" r="65" fill="#120E22" stroke="#3D2E6B" strokeWidth="4" />
      <circle cx="160" cy="160" r="58" fill="none" stroke={salesOpen ? 'rgba(74, 222, 128, 0.45)' : '#9B6DFF'} strokeWidth="1.5" opacity="0.3" />

      <circle cx="160" cy="160" r="142" fill="none" stroke={salesOpen ? 'rgba(34, 197, 94, 0.22)' : 'rgba(61, 46, 107, 0.4)'} strokeWidth="8" strokeDasharray="8 4" />
      <circle
        cx="160"
        cy="160"
        r="142"
        fill="none"
        stroke={progressColor}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 160 160)"
        style={{ filter: salesOpen ? 'drop-shadow(0 0 10px rgba(34, 197, 94, 0.16))' : 'drop-shadow(0 0 20px rgba(155, 109, 255, 0.4))' }}
      />

      <text x="160" y="278" textAnchor="middle" fontSize="10" fontWeight="500" fill={salesOpen ? 'rgba(74, 222, 128, 0.45)' : 'rgba(155, 109, 255, 0.45)'} fontFamily="'Outfit', sans-serif" letterSpacing="2">PROGRESS</text>
      <text x="160" y="293" textAnchor="middle" fontSize="14" fontWeight="700" fill={salesOpen ? 'rgba(134, 239, 172, 0.82)' : 'rgba(155, 109, 255, 0.7)'} fontFamily="'Outfit', sans-serif">{Math.round(clamped)}%</text>

      <rect x="12" y="125" width="18" height="90" rx="9" fill="#0A0812" />
      <rect x="14" y="127" width="14" height="86" rx="7" fill="#0D0B16" stroke="#1D1836" strokeWidth="1" />
      <rect x="15" y="128" width="12" height="84" rx="6" fill="none" stroke="rgba(155, 109, 255, 0.05)" strokeWidth="1" />
      <rect x="19" y="137" width="4" height="66" rx="2" fill="#251C42" stroke="rgba(155, 109, 255, 0.4)" strokeWidth="1" />
      <line x1="21" y1="140" x2="21" y2="200" stroke={progressColor} strokeWidth="0.5" opacity="0.3" />
    </svg>
  )
}

function WinnersView({ onBack, winner, winnerAddress, prize, participants, participantCount, winnerTickets, totalTickets, roundNumber, winningTicket, participantDataStale, canRedeem, settlementLabel, settlementCountdown, onRedeem, actionBusy, actionStatus, actionError }) {
  const winnerTicketText = typeof winnerTickets === 'number' ? winnerTickets.toLocaleString() : winnerTickets
  const totalTicketText = Number(totalTickets || 0).toLocaleString()

  return (
    <div className="winners-view-page">
      <div className="winners-back-wrap">
        <button className="back-link" onClick={onBack}>← Back to Vault</button>
      </div>

      <div className="winners-hero winners-hero-receipt">
        <span className="winners-eyebrow">Round {roundNumber || '—'} Result</span>
        <h2>Winner Confirmed</h2>
        {settlementLabel ? <p>{settlementLabel}</p> : null}
      </div>

      <div className="winner-spotlight-card">
        <div className="winner-badge">Winner</div>
        <div className="winner-address">{winner}</div>
        <div className="winner-receipt-grid">
          <div>
            <span>Prize</span>
            <strong>{prize}</strong>
          </div>
          <div>
            <span>Winner Tickets</span>
            <strong>{winnerTicketText}</strong>
          </div>
          <div>
            <span>Total Tickets</span>
            <strong>{totalTicketText}</strong>
          </div>
          <div>
            <span>Winning Ticket</span>
            <strong>#{Number(winningTicket || 0).toLocaleString()}</strong>
          </div>
        </div>
        {participantDataStale ? (
          <div className="winner-data-warning">Participant index is syncing; using on-chain round totals and winner data.</div>
        ) : null}
      </div>

      <div className="participants-card">
        <div className="participants-head">
          <span>All Participants</span>
          <span>{participantCount.toLocaleString()} Wallets</span>
        </div>
        <div className="participants-table">
          <div className="participants-row participants-header">
            <span>#</span><span>Wallet</span><span>Tickets</span><span>Share</span><span>Deposited</span>
          </div>
          {participants.length === 0 ? (
            <div className="participants-row">
              <span>—</span><span>{participantDataStale ? 'Participant data syncing' : 'No participants indexed yet'}</span><span>—</span><span>—</span><span>—</span>
            </div>
          ) : participants.map((p, i) => {
            const isWinnerRow = winnerAddress && p.wallet.toLowerCase() === winnerAddress.toLowerCase()
            return (
              <div className={`participants-row${isWinnerRow ? ' winner-row' : ''}`} key={`${p.wallet}-${i}`}>
                <span>{i + 1}</span><span>{p.walletShort}{isWinnerRow ? ' [Winner]' : ''}</span><span>{p.tickets.toLocaleString()}</span><span>{p.sharePct}%</span><span>{p.depositedMon} MON</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="winners-actions-grid">
        <button className="btn ghost-btn" onClick={onRedeem} disabled={actionBusy || !canRedeem}>
          {canRedeem ? 'Redeem' : `Redeem (${settlementCountdown})`}
        </button>
      </div>

      {actionStatus ? <p className="deposit-caption">{actionStatus}</p> : null}
      {actionError ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{actionError}</p> : null}
    </div>
  )
}

export default function App() {
  const [currentPage, setCurrentPage] = useState(() => {
    if (window.location.pathname === '/blog/drawn-back-to-defi' || window.location.pathname === '/articles/drawn-back-to-defi') return 'article'
    if (window.location.hash === '#profile') return 'profile'
    if (window.location.hash === '#leaderboard') return 'leaderboard'
    return 'vault'
  })
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.pathname === '/blog/drawn-back-to-defi' || window.location.pathname === '/articles/drawn-back-to-defi') setCurrentPage('article')
      else if (window.location.hash === '#profile') setCurrentPage('profile')
      else if (window.location.hash === '#leaderboard') setCurrentPage('leaderboard')
      else setCurrentPage('vault')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const legacyPoolAddresses = useMemo(() => parsePoolAddresses(), [])
  const poolAddressesV2 = useMemo(() => parseV2PoolAddresses(), [])
  const poolAddressesV3 = useMemo(() => parseV3PoolAddresses(), [])
  const poolAddresses = useMemo(
    () => {
      const combined = [...poolAddressesV2, ...poolAddressesV3, ...legacyPoolAddresses]
      const seen = new Set()
      return combined.filter((addr) => {
        const key = addr.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
    [legacyPoolAddresses, poolAddressesV2, poolAddressesV3]
  )
  const envWalletAllowlist = useMemo(() => parseWalletAllowlist(), [])
  const [walletAllowlist, setWalletAllowlist] = useState(envWalletAllowlist)
  const [allowlistManagedBy, setAllowlistManagedBy] = useState(envWalletAllowlist.length > 0 ? 'env' : 'none')
  const [allowlistEnabled, setAllowlistEnabled] = useState(envWalletAllowlist.length > 0)
  const [selectedPoolAddress, setSelectedPoolAddress] = useState(poolAddresses[0] || '')
  const poolAddress = selectedPoolAddress
  const isV2Pool = poolAddressesV2.some((addr) => addr.toLowerCase() === String(poolAddress).toLowerCase())
  const isV3Pool = poolAddressesV3.some((addr) => addr.toLowerCase() === String(poolAddress).toLowerCase())
  const usesMonTicketEntry = isV2Pool || isV3Pool
  const activePoolAbi = usesMonTicketEntry ? POOL_V2_ABI : POOL_ABI
  const getPoolAbi = useCallback((addr) => (
    poolAddressesV2.some((v2Addr) => v2Addr.toLowerCase() === String(addr).toLowerCase()) ||
    poolAddressesV3.some((v3Addr) => v3Addr.toLowerCase() === String(addr).toLowerCase())
      ? POOL_V2_ABI
      : POOL_ABI
  ), [poolAddressesV2, poolAddressesV3])

  const expectedChainId = import.meta.env.VITE_CHAIN_ID ? Number(import.meta.env.VITE_CHAIN_ID) : null
  const estimatedApyPercent = import.meta.env.VITE_ESTIMATED_APY_PERCENT ? Number(import.meta.env.VITE_ESTIMATED_APY_PERCENT) : 12
  const poolDeployBlock = import.meta.env.VITE_POOL_DEPLOY_BLOCK ? Number(import.meta.env.VITE_POOL_DEPLOY_BLOCK) : 0

  const [account, setAccount] = useState('')
  const [balance, setBalance] = useState('0')
  const [ticketCountInput, setTicketCountInput] = useState('1')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [connectedChainId, setConnectedChainId] = useState(null)

  const [roundId, setRoundId] = useState('0')
  const [roundInfo, setRoundInfo] = useState(null)
  const [nextAction, setNextAction] = useState(0)
  const [ticketPrice, setTicketPrice] = useState(0n)
  const [roundDuration, setRoundDuration] = useState(0)
  const [yieldPeriod, setYieldPeriod] = useState(0)
  const [commitAfterTime, setCommitAfterTime] = useState(0)
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  const [showWinnersView, setShowWinnersView] = useState(false)
  const [winnersTransitioning, setWinnersTransitioning] = useState(false)
  const [mainView, setMainView] = useState('current')
  const [participants, setParticipants] = useState([])
  const [previousRoundId, setPreviousRoundId] = useState('0')
  const [previousRoundInfo, setPreviousRoundInfo] = useState(null)
  const [previousParticipants, setPreviousParticipants] = useState([])
  const [winnersUserPrincipalWei, setWinnersUserPrincipalWei] = useState(0n)
  const [actionBusy, setActionBusy] = useState(false)
  const [busyRids, setBusyRids] = useState(() => new Set())
  const [actionStatus, setActionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const [myRounds, setMyRounds] = useState([])
  const [vaultSummaries, setVaultSummaries] = useState([])
  const [latestBlockNumber, setLatestBlockNumber] = useState(0)
  const [currentInternalEpoch, setCurrentInternalEpoch] = useState(0)
  const [pointsProfile, setPointsProfile] = useState(null)
  const [pointsHistory, setPointsHistory] = useState([])
  const [pointsPreview, setPointsPreview] = useState(null)
  const [pointsBanner, setPointsBanner] = useState(null)
  const unlockAudioRef = useRef(null)
  const doorAudioRef = useRef(null)

  const previousRoundPoints = useMemo(() => {
    if (!previousRoundId || !poolAddress) return null
    return pointsHistory.find((item) => Number(item.round_id) === Number(previousRoundId) && String(item.pool_address).toLowerCase() === String(poolAddress).toLowerCase()) || null
  }, [pointsHistory, previousRoundId, poolAddress])

  useEffect(() => {
    if (!account) {
      setPointsProfile(null)
      setPointsHistory([])
      return
    }
    let cancelled = false
    Promise.all([
      fetch(`${getIndexerBaseUrl()}/api/points/${account}`).then((r) => r.ok ? r.json() : null),
      fetch(`${getIndexerBaseUrl()}/api/points/${account}/history?limit=12`).then((r) => r.ok ? r.json() : []),
    ]).then(([profile, history]) => {
      if (cancelled) return
      setPointsProfile(profile)
      setPointsHistory(Array.isArray(history) ? history : [])
    }).catch(() => {
      if (!cancelled) setPointsHistory([])
    })
    return () => { cancelled = true }
  }, [account])

  useEffect(() => {
    const n = Number(ticketCountInput)
    if (!account || !poolAddress || !Number.isFinite(n) || n <= 0) {
      setPointsPreview(null)
      return
    }
    const timer = setTimeout(() => {
      const url = new URL(`${getIndexerBaseUrl()}/api/points/preview`)
      url.searchParams.set('wallet', account)
      url.searchParams.set('pool', poolAddress)
      url.searchParams.set('tickets', String(Math.floor(n)))
      fetch(url.toString()).then((r) => r.ok ? r.json() : null).then(setPointsPreview).catch(() => setPointsPreview(null))
    }, 180)
    return () => clearTimeout(timer)
  }, [account, poolAddress, ticketCountInput])

  useEffect(() => {
    if (!account || !pointsProfile) return
    const streak = Number(pointsProfile.current_streak_weeks || 0)
    const tier = pointsProfile.current_tier || 'Bronze'
    if ([4, 13, 26, 52].includes(streak)) {
      const key = `everdraw:points:milestone:${account.toLowerCase()}:${streak}`
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        setPointsBanner(`🔥 ${streak}-week streak milestone hit. Bonus points awarded.`)
        return
      }
    }
    const tierKey = `everdraw:points:tier:${account.toLowerCase()}:${tier}`
    if (tier !== 'Bronze' && !localStorage.getItem(tierKey)) {
      localStorage.setItem(tierKey, '1')
      setPointsBanner(`Tier upgraded to ${tier}. Multiplier looking healthier now.`)
    }
  }, [account, pointsProfile])

  useEffect(() => {
    if (!poolAddresses.length) {
      setSelectedPoolAddress('')
      return
    }
    if (!selectedPoolAddress || !poolAddresses.some((a) => a.toLowerCase() === selectedPoolAddress.toLowerCase())) {
      setSelectedPoolAddress(poolAddresses[0])
    }
  }, [poolAddresses, selectedPoolAddress])

  useEffect(() => {
    let cancelled = false
    const loadRuntimeAllowlist = async () => {
      try {
        const res = await fetch('/api/allowlist', { cache: 'no-store' })
        if (!res.ok) throw new Error(`allowlist endpoint ${res.status}`)
        const payload = await res.json()
        if (!payload || payload.configured !== true) return

        const enabled = payload.enabled !== false
        const wallets = normalizeWalletAllowlist(payload.wallets || [])
        if (cancelled) return
        setAllowlistEnabled(enabled)
        setWalletAllowlist(wallets)
        setAllowlistManagedBy('edge-config')
      } catch {
        // Keep env fallback when Edge Config endpoint is not available.
      }
    }
    loadRuntimeAllowlist()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // Load user-provided vault SFX from public/sfx
    const unlock = new Audio('/sfx/vault_unlock.WAV')
    unlock.preload = 'auto'
    unlock.volume = 0.85

    const door = new Audio('/sfx/VAULT_DOOR_heaavy.WAV')
    door.preload = 'auto'
    door.volume = 0.95

    unlockAudioRef.current = unlock
    doorAudioRef.current = door

    return () => {
      unlock.pause()
      door.pause()
      unlockAudioRef.current = null
      doorAudioRef.current = null
    }
  }, [])

  const refreshVaultSummaries = useCallback(async () => {
    if (!poolAddresses.length) {
      setVaultSummaries([])
      return
    }
    const provider = await getReadProvider()
    const summaries = await Promise.all(poolAddresses.map(async (addr) => {
      try {
        const addrIsV2 = poolAddressesV2.some((v2Addr) => v2Addr.toLowerCase() === addr.toLowerCase())
        const addrIsV3 = poolAddressesV3.some((v3Addr) => v3Addr.toLowerCase() === addr.toLowerCase())
        const pool = new ethers.Contract(addr, getPoolAbi(addr), provider)
        const rid = await pool.currentRoundId()
        const info = await pool.getRoundInfo(rid)
        const state = Number(info.state)
        const salesEndTime = Number(info.salesEndTime)
        const secs = Math.max(0, salesEndTime - Math.floor(Date.now() / 1000))
        return {
          poolAddress: addr,
          label: addrIsV2 ? `Vault ${String.fromCharCode(65 + poolAddressesV2.findIndex((v2Addr) => v2Addr.toLowerCase() === addr.toLowerCase()))}` : addrIsV3 ? 'V3 Vault' : shortAddr(addr),
          roundId: rid.toString(),
          state,
          stateLabel: (addrIsV3 ? STATE_LABELS_V3 : addrIsV2 ? STATE_LABELS_V2 : STATE_LABELS)[state] ?? 'Unknown',
          isNowOpen: state === 0 && secs > 0,
          timeRemainingSec: secs,
          totalTickets: Number(info.totalTickets ?? 0),
          tvlMon: Number(ethers.formatEther(info.totalPrincipalMON ?? 0n)).toFixed(4),
        }
      } catch {
        return {
          poolAddress: addr,
          roundId: '-',
          state: -1,
          stateLabel: 'Unavailable',
          isNowOpen: false,
          timeRemainingSec: 0,
          totalTickets: 0,
          tvlMon: '0.0000',
        }
      }
    }))

    const score = (v) => {
      if (v.isNowOpen) return 0
      if (v.state === 1 || v.state === 2) return 1
      if (v.state === 3) return 2
      return 3
    }

    summaries.sort((a, b) => {
      const s = score(a) - score(b)
      if (s !== 0) return s
      const t = a.timeRemainingSec - b.timeRemainingSec
      if (t !== 0) return t
      return a.poolAddress.localeCompare(b.poolAddress)
    })

    setVaultSummaries(summaries)
  }, [poolAddresses, poolAddressesV2, poolAddressesV3, getPoolAbi])

  const refresh = useCallback(async () => {
    if (!poolAddress) return
    if (!ethers.isAddress(poolAddress)) {
      throw new Error('Invalid VITE_POOL_ADDRESS. Use a 0x... contract address.')
    }
    const provider = await getReadProvider()
    const pool = new ethers.Contract(poolAddress, activePoolAbi, provider)

    const rid = await pool.currentRoundId()
    const info = await pool.getRoundInfo(rid)
    const [, action] = await pool.nextExecutable()
    const price = await pool.ticketPriceMON()
    const duration = await pool.roundDurationSec()
    const yp = usesMonTicketEntry ? await pool.yieldPeriodSec().catch(() => 0) : 0
    const commitAfter = usesMonTicketEntry ? await pool.getCommitAfterTime(rid).catch(() => 0) : 0

    setRoundId(rid.toString())
    setRoundInfo(info)
    setNextAction(Number(action))
    setTicketPrice(price)
    setRoundDuration(Number(duration))
    setYieldPeriod(Number(yp))
    setCommitAfterTime(Number(commitAfter))

    const latestBlock = await provider.getBlockNumber()
    setLatestBlockNumber(Number(latestBlock))

    try {
      const shmonAddr = await pool.shmon()
      if (ethers.isAddress(shmonAddr) && shmonAddr !== ethers.ZeroAddress) {
        const shmon = new ethers.Contract(shmonAddr, SHMON_ABI, provider)
        const ep = await shmon.getInternalEpoch()
        setCurrentInternalEpoch(Number(ep))
      }
    } catch {
      // Keep fallback timers if epoch endpoint is unavailable.
    }

    const startBlock = Math.max(0, Number(poolDeployBlock || latestBlock - 100))
    const step = 100

    const buildParticipantsForRound = async (roundNumber, totalTicketsRaw) => {
      try {
        const url = new URL(`${getIndexerBaseUrl()}/api/rounds/${roundNumber}/participants`)
        url.searchParams.set('pool', poolAddress)
        const res = await fetch(url.toString())
        if (res.ok) {
          const indexed = buildParticipantRows(await res.json(), totalTicketsRaw)
          if (indexed.length > 0) return indexed
        }
      } catch {
        // Fall back to on-chain event logs below.
      }

      const byWallet = new Map()
      for (let from = startBlock; from <= latestBlock; from += step) {
        const to = Math.min(latestBlock, from + step - 1)
        let chunk = []
        try {
          chunk = await pool.queryFilter(pool.filters.TicketsBought(BigInt(roundNumber)), from, to)
        } catch {
          continue
        }

        for (const log of chunk) {
          const buyer = log?.args?.buyer
          const t = Number(log?.args?.ticketCount ?? 0)
          const paidWei = BigInt(log?.args?.monPaid ?? 0n)
          if (!buyer || t <= 0) continue
          const key = buyer.toLowerCase()
          if (!byWallet.has(key)) byWallet.set(key, { wallet: buyer, tickets: 0, depositedWei: 0n })
          const row = byWallet.get(key)
          row.tickets += t
          row.depositedWei += paidWei
        }
      }

      return buildParticipantRows([...byWallet.values()], totalTicketsRaw)
    }

    const built = await buildParticipantsForRound(Number(rid), info.totalTickets)
    setParticipants(built)

    if (Number(rid) > 0) {
      const prevRid = Number(rid) - 1
      const prevInfo = await pool.getRoundInfo(BigInt(prevRid))
      setPreviousRoundId(String(prevRid))
      setPreviousRoundInfo(prevInfo)
      const prevBuilt = await buildParticipantsForRound(prevRid, prevInfo.totalTickets)
      setPreviousParticipants(prevBuilt)
    } else {
      setPreviousRoundId('0')
      setPreviousRoundInfo(null)
      setPreviousParticipants([])
    }

    const network = await provider.getNetwork()
    setConnectedChainId(Number(network.chainId))

    if (account) {
      const bal = await provider.getBalance(account)
      setBalance(ethers.formatEther(bal))
    }
  }, [account, poolAddress, poolDeployBlock, activePoolAbi, usesMonTicketEntry])

  useEffect(() => {
    if (!poolAddress) return
    refresh().catch((e) => setError(normalizeError(e) || 'Failed to load round data'))
    refreshVaultSummaries().catch(() => {})

    const clockTick = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)

    const dataRefresh = setInterval(() => {
      refresh().catch(() => {})
      refreshVaultSummaries().catch(() => {})
    }, 15000)

    return () => {
      clearInterval(clockTick)
      clearInterval(dataRefresh)
    }
  }, [poolAddress, refresh, refreshVaultSummaries])

  const connectWallet = useCallback(async () => {
    try {
      if (!window.ethereum) throw new Error('No wallet found. Install MetaMask/Rabby.')
      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const addr = await signer.getAddress()
      setAccount(addr)
      const bal = await provider.getBalance(addr)
      setBalance(ethers.formatEther(bal))
      const network = await provider.getNetwork()
      setConnectedChainId(Number(network.chainId))
      setError('')
    } catch (e) {
      setError(normalizeError(e) || 'Wallet connection failed')
    }
  }, [])

  useEffect(() => {
    if (!window.ethereum) return

    const onAccountsChanged = (accounts) => {
      setAccount(accounts?.[0] ?? '')
    }

    const onChainChanged = (chainHex) => {
      setConnectedChainId(hexChainIdToDec(chainHex))
    }

    window.ethereum.on('accountsChanged', onAccountsChanged)
    window.ethereum.on('chainChanged', onChainChanged)

    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged)
      window.ethereum.removeListener('chainChanged', onChainChanged)
    }
  }, [])

  const walletAllowed = !allowlistEnabled || (!!account && walletAllowlist.includes(account.toLowerCase()))

  const buyTickets = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setStatus('Preparing transaction...')

      if (!poolAddress) throw new Error('Missing VITE_POOL_ADDRESS in web/.env')
      if (!window.ethereum) throw new Error('Wallet required for buyTickets')

      const n = Number(ticketCountInput)
      if (!Number.isInteger(n) || n <= 0) throw new Error('Ticket count must be a positive integer')

      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const network = await provider.getNetwork()
      if (expectedChainId && Number(network.chainId) !== expectedChainId) {
        throw new Error(`Wrong network: connected ${Number(network.chainId)}, expected ${expectedChainId}`)
      }
      const signer = await provider.getSigner()
      const signerAddr = (await signer.getAddress()).toLowerCase()
      if (allowlistEnabled && !walletAllowlist.includes(signerAddr)) {
        throw new Error('This wallet is not allowlisted for this testnet frontend')
      }
      const pool = new ethers.Contract(poolAddress, activePoolAbi, signer)

      const value = ticketPrice * BigInt(n)
      const tx = usesMonTicketEntry
        ? await pool.buyTicketsMON(n, { value })
        : await pool.buyTickets(n, { value })
      setStatus(`Submitted: ${tx.hash.slice(0, 10)}... waiting for confirmation...`)

      await tx.wait()
      setStatus('Buy successful ✅')
      // Unblock button immediately so user can buy again without waiting on extra reads.
      setLoading(false)
      refresh().catch(() => {})
      return
    } catch (e) {
      setStatus('')
      setError(normalizeError(e) || 'buyTickets failed')
    } finally {
      setLoading(false)
    }
  }, [allowlistEnabled, walletAllowlist, expectedChainId, poolAddress, refresh, ticketCountInput, ticketPrice, activePoolAbi, usesMonTicketEntry])

  const secondsRemaining = useMemo(() => {
    if (!roundInfo) return 0
    return Math.max(0, Number(roundInfo.salesEndTime) - now)
  }, [now, roundInfo])

  const progressPct = useMemo(() => {
    if (!roundDuration || !roundInfo) return 0
    const elapsed = Math.max(0, roundDuration - secondsRemaining)
    return Math.min(100, Math.round((elapsed / roundDuration) * 100))
  }, [roundDuration, secondsRemaining, roundInfo])

  const currentState = roundInfo ? Number(roundInfo.state) : null
  const isOpenState = currentState === 0
  const wrongNetwork = expectedChainId && connectedChainId && expectedChainId !== connectedChainId
  const salesOpen = isOpenState && secondsRemaining > 0
  const canBuyTx = !!account && walletAllowed && !wrongNetwork && salesOpen && !loading

  const buyDisabledReason = useMemo(() => {
    if (loading) return 'Transaction in progress'
    if (!salesOpen) {
      if (!isOpenState) return 'Sales not open in current round state'
      return 'Sales window closed; waiting for keeper processing'
    }
    if (!account) return 'Connect wallet to deposit'
    if (!walletAllowed) return 'This wallet is not allowlisted for this testnet frontend'
    if (wrongNetwork) return `Wrong network (need ${expectedChainId})`
    return ''
  }, [loading, salesOpen, isOpenState, account, walletAllowed, wrongNetwork, expectedChainId])

  const settlementSecondsRemaining = useMemo(() => {
    if (!roundInfo) return 0
    const state = Number(roundInfo.state ?? -1)

    // Committed phase: waiting for draw/execute-next after commit target block
    if (state === 1) {
      const targetBlock = Number(roundInfo.targetBlockNumber ?? 0)
      if (!targetBlock || !latestBlockNumber) return 0
      const blocksLeft = Math.max(0, targetBlock - latestBlockNumber)
      const BLOCK_TIME_SEC = 0.4
      return Math.ceil(blocksLeft * BLOCK_TIME_SEC)
    }

    // Finalizing phase: waiting for shMON unstake completion
    if (state !== 2) return 0

    // Preferred: epoch-derived countdown (matches shMON unstake timing model)
    const completionEpoch = Number(roundInfo.unstakeCompletionEpoch ?? 0)
    if (completionEpoch > 0 && currentInternalEpoch > 0 && latestBlockNumber > 0) {
      const EPOCH_LENGTH = 50_000
      const BLOCK_TIME_SEC = 0.4
      const epochsLeft = completionEpoch - currentInternalEpoch
      if (epochsLeft <= 0) return 0

      const blocksIntoEpoch = latestBlockNumber % EPOCH_LENGTH
      const blocksRemaining =
        (EPOCH_LENGTH - blocksIntoEpoch) + (epochsLeft - 1) * EPOCH_LENGTH

      return Math.max(0, Math.ceil(blocksRemaining * BLOCK_TIME_SEC))
    }

    // Fallback: block-target countdown from draw commit window
    const targetBlock = Number(roundInfo.targetBlockNumber ?? 0)
    if (!targetBlock || !latestBlockNumber) return 0
    const blocksLeft = Math.max(0, targetBlock - latestBlockNumber)
    const BLOCK_TIME_SEC = 0.4
    return Math.ceil(blocksLeft * BLOCK_TIME_SEC)
  }, [roundInfo, latestBlockNumber, currentInternalEpoch])

  const timerCard = useMemo(() => {
    if (isV3Pool) {
      const commitSecsRemaining = Math.max(0, Number(commitAfterTime || 0) - now)
      if (currentState === 0 && secondsRemaining > 0) {
        return {
          heading: 'Deposits Open',
          value: formatCountdown(secondsRemaining),
          sub: 'Deposits close in',
          metaLabel: 'Progress',
          metaValue: `${progressPct}%`
        }
      }

      if (currentState === 0 && commitSecsRemaining > 0) {
        return {
          heading: 'Vault Closed',
          value: formatCountdown(commitSecsRemaining),
          sub: 'Yield accruing - deposits no longer accepted',
          metaLabel: 'Next phase',
          metaValue: 'Commit'
        }
      }

      if (currentState === 0) {
        const hasEntries = Number(roundInfo?.totalTickets ?? 0) > 0
        return {
          heading: hasEntries ? 'VRF Commit Queued' : 'Round Skipped',
          value: hasEntries ? 'Ready' : 'Skipped',
          sub: hasEntries ? 'Keeper will request Pyth VRF' : 'No entries in this round',
          metaLabel: 'Next action',
          metaValue: ACTION_LABELS_V3[nextAction] ?? 'Commit'
        }
      }

      if (currentState === 1) {
        return {
          heading: 'Awaiting VRF',
          value: 'Drawing...',
          sub: 'Pyth callback pending',
          metaLabel: 'Vault status',
          metaValue: STATE_LABELS_V3[currentState]
        }
      }

      if (currentState === 2) {
        return {
          heading: 'Finalize Queued',
          value: 'Ready',
          sub: 'VRF returned; keeper will finalize the winner',
          metaLabel: 'Next action',
          metaValue: ACTION_LABELS_V3[nextAction] ?? 'Finalize'
        }
      }

      if (currentState === 3) {
        return {
          heading: 'Round Complete',
          value: 'Complete',
          sub: roundInfo?.winner ? `Winner: ${shortAddr(roundInfo.winner)}` : 'Winner and prize are available',
          metaLabel: 'Vault status',
          metaValue: 'Claim / Redeem'
        }
      }
    }

    if (isV2Pool) {
      if (currentState === 0 && secondsRemaining > 0) {
        return {
          heading: 'Deposits Open',
          value: formatCountdown(secondsRemaining),
          sub: 'Deposits close in',
          metaLabel: 'Progress',
          metaValue: `${progressPct}%`
        }
      }

      const commitSecsRemaining = Math.max(0, Number(commitAfterTime || 0) - now)
      if (currentState === 0 && commitSecsRemaining > 0) {
        return {
          heading: 'Vault Closed',
          value: formatCountdown(commitSecsRemaining),
          sub: 'Yield accruing - deposits no longer accepted',
          metaLabel: 'Next phase',
          metaValue: 'Drawing'
        }
      }

      if (currentState === 0) {
        const hasEntries = Number(roundInfo?.totalTickets ?? 0) > 0
        return {
          heading: hasEntries ? 'Drawing Queued' : 'Round Skipped',
          value: hasEntries ? 'Processing...' : 'Skipped',
          sub: hasEntries ? 'Yield complete - awaiting winner reveal' : 'No entries in this round',
          metaLabel: 'Next action',
          metaValue: ACTION_LABELS_V2[nextAction] ?? 'Commit'
        }
      }

      if (currentState === 1) {
        return {
          heading: 'Drawing...',
          value: settlementSecondsRemaining > 0 ? formatCountdown(settlementSecondsRemaining) : 'Processing...',
          sub: 'Winner reveal in progress',
          metaLabel: 'Vault status',
          metaValue: 'Drawing'
        }
      }

      if (currentState === 2) {
        return {
          heading: 'Round Complete',
          value: 'Complete',
          sub: roundInfo?.winner ? `Winner: ${shortAddr(roundInfo.winner)}` : 'Winner and prize are available',
          metaLabel: 'Vault status',
          metaValue: 'Claim / Redeem'
        }
      }

      if (currentState === 3 || currentState === 4) {
        return {
          heading: 'Round Skipped',
          value: 'Skipped',
          sub: currentState === 3 ? 'No entries in this round' : 'No draw was completed for this round',
          metaLabel: 'Vault status',
          metaValue: 'Skipped'
        }
      }
    }

    if (currentState === 0) {
      if (secondsRemaining > 0) {
        return {
          heading: 'Vault Accepting Deposits',
          value: formatCountdown(secondsRemaining),
          sub: 'Deposit window closes in',
          metaLabel: 'Progress',
          metaValue: `${progressPct}%`
        }
      }

      const emptyRound = Number(roundInfo.totalTickets ?? 0) === 0 || BigInt(roundInfo.totalPrincipalMON ?? 0n) === 0n
      if (emptyRound) {
        return {
          heading: 'Round Closed - Awaiting Keeper Skip',
          value: '00:00:00',
          sub: 'No tickets sold. Keeper will advance to next round.',
          metaLabel: 'Next action',
          metaValue: ACTION_LABELS[nextAction] ?? 'Skip'
        }
      }

      return {
        heading: 'Winner Drawn - Vault Awaiting Settlement',
        value: '00:00:00',
        sub: 'Keeper is progressing settlement',
        metaLabel: 'Next action',
        metaValue: ACTION_LABELS[nextAction] ?? 'Processing'
      }
    }

    if (currentState === 1) {
      const targetBlock = roundInfo ? Number(roundInfo.targetBlockNumber ?? 0) : 0
      if (settlementSecondsRemaining > 0) {
        return {
          heading: 'Winner Drawn - Vault Awaiting Settlement',
          value: formatCountdown(settlementSecondsRemaining),
          sub: `Draw unlock at block ${targetBlock.toLocaleString()}`,
          metaLabel: 'Next action',
          metaValue: ACTION_LABELS[nextAction] ?? 'Draw'
        }
      }

      return {
        heading: 'Winner Drawn - Vault Awaiting Settlement',
        value: 'Awaiting Settle',
        sub: targetBlock > 0 ? `Waiting for draw at block ${targetBlock.toLocaleString()}` : 'Keeper is progressing settlement',
        metaLabel: 'Next action',
        metaValue: ACTION_LABELS[nextAction] ?? 'Settle'
      }
    }

    if (currentState === 2) {
      const targetBlock = roundInfo ? Number(roundInfo.targetBlockNumber ?? 0) : 0
      const completionEpoch = roundInfo ? Number(roundInfo.unstakeCompletionEpoch ?? 0) : 0
      const epochBased = completionEpoch > 0 && currentInternalEpoch > 0

      if (settlementSecondsRemaining > 0) {
        return {
          heading: 'Winner Drawn - Vault Awaiting Settlement',
          value: formatCountdown(settlementSecondsRemaining),
          sub: epochBased
            ? `Unstake epoch ${currentInternalEpoch}/${completionEpoch}`
            : `Estimated settle at block ${targetBlock.toLocaleString()}`,
          metaLabel: 'Next action',
          metaValue: ACTION_LABELS[nextAction] ?? 'Settle'
        }
      }

      return {
        heading: 'Winner Drawn - Vault Awaiting Settlement',
        value: 'Finalizing…',
        sub: epochBased
          ? `Unstake epoch ${currentInternalEpoch}/${completionEpoch}`
          : (targetBlock > 0 ? `Target block ${targetBlock.toLocaleString()}` : 'Unstake requested, waiting for settlement'),
        metaLabel: 'Next action',
        metaValue: ACTION_LABELS[nextAction] ?? 'Settle'
      }
    }

    if (currentState === 3) {
      return {
        heading: 'Settled — Withdraw Available',
        value: 'Settled',
        sub: 'Winner claim and principal withdraw are now available',
        metaLabel: 'Vault status',
        metaValue: 'Complete'
      }
    }

    return {
      heading: 'Vault Status',
      value: '--:--:--',
      sub: 'Loading...',
      metaLabel: 'Progress',
      metaValue: '0%'
    }
  }, [isV2Pool, isV3Pool, currentState, nextAction, progressPct, secondsRemaining, roundInfo, settlementSecondsRemaining, currentInternalEpoch, commitAfterTime, now])

  const timerProgressPct = currentState === 0 ? progressPct : (isV2Pool ? currentState >= 2 : currentState === 3) ? 100 : 50
  const timerIsClock = /^\d+:\d{2}:\d{2}:\d{2}$/.test(timerCard.value)
  const drawFinished = (isV2Pool ? currentState >= 2 : currentState === 3) || (currentState >= 2 && !!roundInfo && roundInfo.winner !== ethers.ZeroAddress)
  const previousRoundVisible = previousRoundInfo && Number(previousRoundInfo.totalTickets) > 0 && (isV2Pool ? Number(previousRoundInfo.state) >= 2 : Number(previousRoundInfo.state) === 3)
  const activeRoundInfo = mainView === 'previous' && previousRoundInfo ? previousRoundInfo : roundInfo
  const activeRoundId = mainView === 'previous' && previousRoundInfo ? previousRoundId : roundId

  useEffect(() => {
    if (!drawFinished && !previousRoundVisible) setShowWinnersView(false)
  }, [drawFinished, previousRoundVisible])

  const tvlMON = roundInfo ? Number(ethers.formatEther(roundInfo.totalPrincipalMON)).toFixed(4) : '...'
  const currentPrizePool = useMemo(() => {
    if (!roundInfo) return { value: '...', sub: 'Loading...' }

    const settled = isV2Pool ? Number(roundInfo.state) === 2 : Number(roundInfo.state) === 3
    if (settled) {
      return {
        value: `${Number(ethers.formatEther(roundInfo.yieldMON ?? roundInfo.prizeShares ?? 0n)).toFixed(4)} MON`,
        sub: 'Final settled yield'
      }
    }

    const principal = Number(ethers.formatEther(roundInfo.totalPrincipalMON))
    const durationSec = isV2Pool ? (yieldPeriod || roundDuration || 0) : (roundDuration || 0)
    const yearSec = 365 * 24 * 60 * 60
    const apy = (Number.isFinite(estimatedApyPercent) ? estimatedApyPercent : 0) / 100
    const est = principal * apy * (durationSec / yearSec)

    return {
      value: `~${est.toFixed(4)} MON`,
      sub: `Estimated final yield @ ${estimatedApyPercent}% APY`
    }
  }, [estimatedApyPercent, roundDuration, roundInfo, isV2Pool, yieldPeriod])

  const winnersSource = useMemo(() => (
    mainView === 'previous' && previousRoundInfo
      ? { rid: previousRoundId, info: previousRoundInfo, participants: previousParticipants }
      : drawFinished
        ? { rid: roundId, info: roundInfo, participants }
        : previousRoundVisible
          ? { rid: previousRoundId, info: previousRoundInfo, participants: previousParticipants }
          : { rid: roundId, info: roundInfo, participants }
  ), [drawFinished, mainView, participants, previousParticipants, previousRoundId, previousRoundInfo, previousRoundVisible, roundId, roundInfo])

  const winnerParticipant = useMemo(() => {
    if (!winnersSource.info?.winner) return null
    return winnersSource.participants.find((p) => p.wallet.toLowerCase() === String(winnersSource.info.winner).toLowerCase()) || null
  }, [winnersSource])

  const previousSettlementCountdown = useMemo(() => {
    if (!previousRoundInfo) return '—'
    const st = Number(previousRoundInfo.state)
    if (st === 3) return '00:00:00:00'
    if (salesOpen && secondsRemaining > 0) return formatCountdown(secondsRemaining)
    return 'Awaiting settlement'
  }, [previousRoundInfo, salesOpen, secondsRemaining])

  const winnersRoundId = winnersSource?.rid || roundId
  const winnersYieldWei = winnersSource?.info?.yieldMON || winnersSource?.info?.prizeShares ? BigInt(winnersSource.info.yieldMON ?? winnersSource.info.prizeShares) : 0n
  const isWinnerWallet = !!account && !!winnersSource?.info?.winner && account.toLowerCase() === String(winnersSource.info.winner).toLowerCase()
  const winnersSettled = isV2Pool ? Number(winnersSource?.info?.state ?? -1) === 2 : Number(winnersSource?.info?.state ?? -1) === 3
  const canClaimPrize = isWinnerWallet && winnersYieldWei > 0n && winnersSettled && !Boolean(winnersSource?.info?.prizeClaimed)
  const canWithdrawPrincipal = !!account && winnersUserPrincipalWei > 0n && winnersSettled
  const canRedeemWinnersRound = canClaimPrize || canWithdrawPrincipal

  const winnerTicketsDisplay = winnerParticipant
    ? winnerParticipant.tickets
    : Number(winnersSource?.info?.totalTickets ?? 0) > 0
      ? '—'
      : 0
  const winnersTotalTickets = Number(winnersSource?.info?.totalTickets ?? 0)
  const winnersParticipantTickets = winnersSource.participants.reduce((sum, p) => sum + Number(p.tickets || 0), 0)
  const participantDataStale = winnersTotalTickets > 0 && winnersParticipantTickets !== winnersTotalTickets

  useEffect(() => {
    let cancelled = false
    const loadPrincipal = async () => {
      if (!account || !poolAddress || !winnersRoundId) {
        if (!cancelled) setWinnersUserPrincipalWei(0n)
        return
      }
      try {
        const provider = await getReadProvider()
        const pool = new ethers.Contract(poolAddress, activePoolAbi, provider)
        const v = isV2Pool
          ? (await pool.getUserPosition(BigInt(winnersRoundId), account))[0]
          : await pool.principalMON(BigInt(winnersRoundId), account)
        if (!cancelled) setWinnersUserPrincipalWei(BigInt(v))
      } catch {
        if (!cancelled) setWinnersUserPrincipalWei(0n)
      }
    }
    loadPrincipal()
    return () => { cancelled = true }
  }, [account, poolAddress, winnersRoundId, activePoolAbi, isV2Pool])

  useEffect(() => {
    let cancelled = false
    const loadMyRounds = async () => {
      if (!account || !poolAddresses.length) {
        if (!cancelled) setMyRounds([])
        return
      }
      try {
        const provider = await getReadProvider()
        const rows = []

        for (const addr of poolAddresses) {
          if (!ethers.isAddress(addr)) continue
          const addrIsV2 = poolAddressesV2.some((v2Addr) => v2Addr.toLowerCase() === addr.toLowerCase())
          const addrIsV3 = poolAddressesV3.some((v3Addr) => v3Addr.toLowerCase() === addr.toLowerCase())
          const pool = new ethers.Contract(addr, getPoolAbi(addr), provider)

          let cur = 0
          try {
            cur = Number(await pool.currentRoundId())
          } catch {
            continue
          }

          const rids = []
          for (let rid = Math.max(1, cur - 10); rid <= cur; rid++) rids.push(rid)

          const [infos, principals, duration] = await Promise.all([
            Promise.all(rids.map((rid) =>
              pool.getRoundInfo(BigInt(rid)).catch(() => null)
            )),
            Promise.all(rids.map((rid) =>
              addrIsV2 || addrIsV3
                ? pool.getUserPosition(BigInt(rid), account).then((pos) => pos[0]).catch(() => 0n)
                : pool.principalMON(BigInt(rid), account).catch(() => 0n)
            )),
            pool.roundDurationSec().catch(() => 0)
          ])

          rids.forEach((rid, i) => {
            const info = infos[i]
            const principal = principals[i] ?? 0n
            if (!info) return
            const state = Number(info.state)
            const salesEndTime = Number(info.salesEndTime || 0)
            const isWinner = account.toLowerCase() === String(info.winner || '').toLowerCase()
            const commitAfterTime = state === 0 && salesEndTime > 0 && Number(duration || 0) > 0
              ? salesEndTime + Number(duration || 0)
              : 0
            if (principal > 0n || isWinner) {
              rows.push({
                rid,
                poolAddr: addr,
                state,
                salesEndTime,
                commitAfterTime,
                isWinner,
                prizeClaimed: Boolean(info.prizeClaimed),
                principalWei: principal,
                principalMon: Number(ethers.formatEther(principal)).toFixed(4),
                isV2: addrIsV2,
                isV3: addrIsV3,
                yieldWei: BigInt(info.yieldMON ?? info.prizeShares ?? 0n),
                canClaimPrize: isWinner && BigInt(info.yieldMON ?? info.prizeShares ?? 0n) > 0n && !Boolean(info.prizeClaimed) && (addrIsV2 ? state === 2 : state === 3),
                canWithdraw: (addrIsV2 ? state === 2 : state === 3) && principal > 0n,
              })
            }
          })
        }

        rows.sort((a, b) => b.rid !== a.rid ? b.rid - a.rid : a.poolAddr.localeCompare(b.poolAddr))
        if (!cancelled) setMyRounds(rows)
      } catch {
        if (!cancelled) setMyRounds([])
      }
    }
    loadMyRounds()
    return () => { cancelled = true }
  }, [account, poolAddresses, poolAddressesV2, poolAddressesV3, getPoolAbi])

  const myRoundsStats = useMemo(() => {
    const lockedWei = myRounds
      .filter((r) => r.state !== 3)
      .reduce((acc, r) => acc + (r.principalWei || 0n), 0n)

    const claimableWei = myRounds
      .filter((r) => r.state === 3)
      .reduce((acc, r) => acc + (r.principalWei || 0n), 0n)

    const winningsWei = myRounds
      .filter((r) => r.isWinner && r.state === 3)
      .reduce((acc, r) => acc + (r.yieldWei || 0n), 0n)

    return {
      lockedMon: Number(ethers.formatEther(lockedWei)).toFixed(4),
      claimableMon: Number(ethers.formatEther(claimableWei)).toFixed(4),
      winningsMon: Number(ethers.formatEther(winningsWei)).toFixed(4),
      gamesPlayed: myRounds.length,
    }
  }, [myRounds])

  const runSignedAction = useCallback(async (label, fn, targetPoolAddress = poolAddress) => {
    try {
      setActionBusy(true)
      setActionError('')
      setActionStatus(`${label}: preparing...`)

      if (!window.ethereum) throw new Error('Wallet required')
      if (!targetPoolAddress) throw new Error('Missing pool address')

      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const network = await provider.getNetwork()
      if (expectedChainId && Number(network.chainId) !== expectedChainId) {
        throw new Error(`Wrong network: connected ${Number(network.chainId)}, expected ${expectedChainId}`)
      }
      const signer = await provider.getSigner()
      const signerAddr = (await signer.getAddress()).toLowerCase()
      if (allowlistEnabled && !walletAllowlist.includes(signerAddr)) {
        throw new Error('This wallet is not allowlisted for this testnet frontend')
      }
      const pool = new ethers.Contract(targetPoolAddress, getPoolAbi(targetPoolAddress), signer)
      await fn(pool)
      await refresh()
      setActionStatus(`${label}: success ✅`)
    } catch (e) {
      setActionStatus('')
      setActionError(normalizeError(e) || `${label} failed`)
    } finally {
      setActionBusy(false)
    }
  }, [allowlistEnabled, walletAllowlist, expectedChainId, poolAddress, refresh, getPoolAbi])

  const handleRedeemRound = useCallback(async ({ rid, poolAddr = poolAddress, claimPrize = false, withdrawPrincipal = false, label = `Redeem (Round #${rid})` }) => {
    if (!rid || (!claimPrize && !withdrawPrincipal)) return
    await runSignedAction(label, async (pool) => {
      if (claimPrize) {
        const claimTx = await pool.claimPrize(BigInt(rid))
        setActionStatus(`${label}: prize submitted ${claimTx.hash.slice(0, 10)}...`)
        await claimTx.wait()
      }
      if (withdrawPrincipal) {
        const withdrawTx = await pool.withdrawPrincipal(BigInt(rid))
        setActionStatus(`${label}: principal submitted ${withdrawTx.hash.slice(0, 10)}...`)
        await withdrawTx.wait()
      }
    }, poolAddr)
  }, [poolAddress, runSignedAction])

  const handleWinnersRedeem = useCallback(async () => {
    await handleRedeemRound({
      rid: winnersRoundId,
      claimPrize: canClaimPrize,
      withdrawPrincipal: canWithdrawPrincipal,
      label: `Redeem (Round #${winnersRoundId})`,
    })
  }, [winnersRoundId, canClaimPrize, canWithdrawPrincipal, handleRedeemRound])

  const handleMyRoundsWithdraw = useCallback(async (r) => {
    setBusyRids(prev => new Set(prev).add(r.rid))
    try {
      await handleRedeemRound({
        rid: r.rid,
        poolAddr: r.poolAddr,
        claimPrize: r.canClaimPrize,
        withdrawPrincipal: r.canWithdraw,
        label: `Redeem (Round #${r.rid})`,
      })
    } finally {
      setBusyRids(prev => { const s = new Set(prev); s.delete(r.rid); return s })
    }
  }, [handleRedeemRound])

  const openWinnersWithTransition = useCallback(() => {
    if (winnersTransitioning) return

    const unlock = unlockAudioRef.current
    const door = doorAudioRef.current

    if (unlock) {
      unlock.currentTime = 0
      unlock.play().catch(() => {})
    }

    setTimeout(() => {
      if (!door) return
      door.currentTime = 0
      door.play().catch(() => {})
    }, 330)

    setWinnersTransitioning(true)
    setTimeout(() => {
      setShowWinnersView(true)
      setWinnersTransitioning(false)
    }, 1800)
  }, [winnersTransitioning])

  if (!poolAddress) {
    return (
      <div className="app-shell">
        <div className="app-container">
          <h1>Missing configuration</h1>
          <p className="deposit-caption">Set VITE_POOL_ADDRESSES (or VITE_POOL_ADDRESS) and ideally VITE_RPC_URL in web/.env</p>
        </div>
      </div>
    )
  }

  if (showWinnersView) {
    return (
      <div className="app-shell">
        <div className="app-container">
          <WinnersView
            onBack={() => setShowWinnersView(false)}
            winner={winnersSource.info ? shortAddr(winnersSource.info.winner) : '—'}
            winnerAddress={winnersSource.info?.winner}
            prize={winnersSource.info ? `${Number(ethers.formatEther(winnersSource.info.yieldMON ?? winnersSource.info.prizeShares ?? 0n)).toFixed(4)} MON` : currentPrizePool.value}
            participants={winnersSource.participants}
            participantCount={winnersSource.participants.length}
            winnerTickets={winnerTicketsDisplay}
            totalTickets={winnersTotalTickets}
            roundNumber={Number(winnersRoundId || 0)}
            winningTicket={winnersSource.info?.winningTicket}
            participantDataStale={participantDataStale}
            canRedeem={canRedeemWinnersRound}
            settlementLabel={winnersSettled ? 'Settled — Withdraw Available' : 'Winner Drawn - Vault Awaiting Settlement'}
            settlementCountdown={previousSettlementCountdown}
            onRedeem={handleWinnersRedeem}
            actionBusy={actionBusy}
            actionStatus={actionStatus}
            actionError={actionError}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        <Header account={account} onConnect={connectWallet} currentPage={currentPage} points={pointsProfile} />

        {pointsBanner ? <div className="points-banner"><span>{pointsBanner}</span><button type="button" onClick={() => setPointsBanner(null)}>×</button></div> : null}

        {currentPage === 'profile' ? <ProfilePage account={account} points={pointsProfile} history={pointsHistory} /> : null}
        {currentPage === 'leaderboard' ? <LeaderboardPage account={account} /> : null}
        {currentPage === 'article' ? <FounderLaunchArticle /> : null}

        {currentPage === 'vault' ? (<>

        {allowlistEnabled ? (
          <p className="deposit-caption" style={{ color: walletAllowed || !account ? '#9fa5c0' : '#ff8ea1' }}>
            Testnet allowlist is enabled via {allowlistManagedBy === 'edge-config' ? 'Edge Config' : 'env fallback'} ({walletAllowlist.length} wallet{walletAllowlist.length === 1 ? '' : 's'}).
            {account ? (walletAllowed ? ' Connected wallet is approved.' : ' Connected wallet is NOT approved.') : ' Connect an approved wallet to transact.'}
          </p>
        ) : null}

        {vaultSummaries.length > 1 ? (
          <section className="vault-switcher">
            {vaultSummaries.map((v) => (
              <button
                key={v.poolAddress}
                className={`vault-switch-card ${v.poolAddress.toLowerCase() === poolAddress.toLowerCase() ? 'active' : ''}`}
                onClick={() => setSelectedPoolAddress(v.poolAddress)}
              >
              <div className="vault-switch-title">
                  <span>{v.label || shortAddr(v.poolAddress)}</span>
                  {v.isNowOpen ? <span className="open-badge">Now Open</span> : null}
                </div>
                <div className="vault-switch-sub">Round #{v.roundId} · {v.stateLabel}</div>
                <div className="vault-switch-meta">Tickets: {v.totalTickets.toLocaleString()} · TVL: {v.tvlMon} MON</div>
                <div className="vault-switch-meta">
                  {v.isNowOpen ? `Closes in ${formatCountdown(v.timeRemainingSec)}` : `Status: ${v.stateLabel}`}
                </div>
              </button>
            ))}
          </section>
        ) : null}

        <h1>
          Win the Pot.
          <br />
          Or keep your lot.
        </h1>

        <section className="round-toggle">
          <button className={`toggle-btn ${mainView === 'current' ? 'active' : ''}`} onClick={() => setMainView('current')}>Current Vault</button>
          <button className={`toggle-btn ${mainView === 'previous' ? 'active' : ''}`} onClick={() => setMainView('previous')} disabled={!previousRoundInfo}>Previous Vault</button>
          <button className={`toggle-btn ${mainView === 'myrounds' ? 'active' : ''}`} onClick={() => setMainView('myrounds')}>My Rounds</button>
        </section>

        {mainView === 'myrounds' ? (
          <section className="participants-card">
            <div className="participants-head">
              <span>My Rounds</span>
              <span>{myRounds.length} Records</span>
            </div>
            <div className="participants-table">
              <div className="participants-row participants-header">
                <span>#</span><span>Round / Status</span><span>Result</span><span>Principal</span><span>Action</span>
              </div>
              {myRounds.length === 0 ? (
                <div className="participants-row">
                  <span>—</span><span>No prior rounds found for this wallet</span><span>—</span><span>0.0000 MON</span><span>—</span>
                </div>
              ) : myRounds.map((r) => {
                const roundStatus = r.state === 0
                  ? (r.salesEndTime > now
                      ? 'Open / Deposits Live'
                      : r.commitAfterTime > now
                        ? 'Open / Yield Accruing'
                        : 'Open / Awaiting Draw')
                  : ((r.isV3 ? STATE_LABELS_V3 : r.isV2 ? STATE_LABELS_V2 : STATE_LABELS)[r.state] || 'Unknown')

                return (
                  <div className="participants-row" key={r.rid}>
                    <span>{r.rid}</span>
                    <span>Round #{r.rid} · {roundStatus}</span>
                    <span>{r.isWinner ? 'Winner' : 'Participant'}</span>
                    <span>{r.principalMon} MON</span>
                    <span>
                      {r.canWithdraw ? (
                        <button
                          className="max-btn"
                          onClick={() => handleMyRoundsWithdraw(r)}
                          disabled={busyRids.has(r.rid)}
                        >
                          {busyRids.has(r.rid) ? 'Redeeming...' : 'Redeem'}
                        </button>
                      ) : r.state === 3 && r.principalWei === 0n
                        ? <span style={{color:'#6ee7b7'}}>✓ Done</span>
                        : 'Waiting'}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="main-grid">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Buy Tickets</div>
              </div>

              <div className="deposit-area">
                <div className="input-group">
                  <div className="input-wrapper">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={ticketCountInput}
                      onChange={(e) => setTicketCountInput(e.target.value)}
                      disabled={mainView !== 'current'}
                    />
                    <span className="currency-label">tickets</span>
                  </div>
                  <div className="balance-info">
                    <span>Wallet: {Number(balance).toFixed(4)} MON</span>
                    <button className="max-btn" onClick={() => setTicketCountInput('1')}>Reset</button>
                  </div>
                </div>

                <div className="balance-info">
                  <span>Price / ticket</span>
                  <span>{ethers.formatEther(ticketPrice || 0n)} MON</span>
                </div>

                <div className="deposit-cta-wrap">
                  <button
                    className="btn deposit-btn"
                    disabled={mainView !== 'current' || loading || wrongNetwork || !salesOpen || !walletAllowed}
                    onClick={account ? buyTickets : connectWallet}
                  >
                    {mainView !== 'current'
                      ? 'Switch to Current Vault'
                      : loading
                        ? 'Submitting...'
                        : !salesOpen
                          ? 'Buy Unavailable'
                          : !account
                            ? 'Connect Wallet to Deposit'
                            : !walletAllowed
                              ? 'Wallet Not Approved'
                              : wrongNetwork
                                ? `Wrong network (need ${expectedChainId})`
                                : canBuyTx
                                  ? 'Buy Tickets'
                                  : 'Buy Unavailable'}
                  </button>
                  {(loading || wrongNetwork || !salesOpen || !account || !walletAllowed || mainView !== 'current') && buyDisabledReason ? <p className="deposit-caption">{buyDisabledReason}</p> : null}
                  {pointsPreview && mainView === 'current' ? (
                    <p className="deposit-caption points-preview">You'll earn approximately {Number(pointsPreview.estimated_total || 0).toLocaleString()} points this round.</p>
                  ) : null}
                </div>

                {status ? <p className="deposit-caption">{status}</p> : null}
                {error ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{error}</p> : null}
              </div>
            </div>

            {(mainView === 'previous' || drawFinished) ? (
              <VaultAnimationTest onComplete={openWinnersWithTransition} />
            ) : (
              <div className={`card filled vault-card ${winnersTransitioning ? 'to-winners' : ''}`} id="vault-card">
                <VaultDoorBackground progressPct={mainView === 'previous' ? 100 : timerProgressPct} salesOpen={mainView === 'current' ? salesOpen : false} />

                <div className="card-header vault-layer">
                  <div className="card-title">{timerCard.heading}</div>
                  <div className="card-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2" fill="none" />
                      <circle cx="12" cy="12" r="3" fill="white" />
                    </svg>
                  </div>
                </div>

                <div className="countdown-center vault-layer vault-center">
                  <div className="countdown-value" style={{ fontSize: timerIsClock ? undefined : '2.4rem' }}>{timerCard.value}</div>
                  <div className="countdown-sub">{timerCard.sub}</div>
                </div>

                <div className="progress-container vault-layer vault-progress-hidden" />
              </div>
            )}
          </section>
        )}

        {mainView === 'previous' && previousRoundPoints ? (
          <section className="participants-card settlement-points-card">
            <div className="participants-head"><span>Points settlement</span><span>Round #{previousRoundPoints.round_id}</span></div>
            <PointsBreakdown item={previousRoundPoints} />
          </section>
        ) : null}

        <section className="stats-grid two-col">
          {mainView === 'myrounds' ? (
            <>
              <StatCard
                label="Total Locked (Active Rounds)"
                value={`${myRoundsStats.lockedMon} MON`}
                sub="Principal in non-settled rounds"
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M17 9h-1V7a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V7z"/></svg>
                )}
              />
              <StatCard
                label="Total Principal Claimable"
                value={`${myRoundsStats.claimableMon} MON`}
                sub="Settled rounds ready to withdraw"
                icon={(
                  <svg viewBox="0 0 24 24"><path d="M12 2v10m0 0l-4-4m4 4l4-4M5 14v5h14v-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              />
              <StatCard
                label="Total Winnings To Date"
                value={`${myRoundsStats.winningsMon} MON`}
                sub="Yield from settled wins"
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                )}
              />
              <StatCard
                label="Total Games Played"
                value={String(myRoundsStats.gamesPlayed)}
                sub="Rounds where this wallet participated"
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2a2 2 0 0 0 0 4v2a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2a2 2 0 0 0 0-4V7z"/></svg>
                )}
              />
            </>
          ) : (
            <>
              <StatCard
                label="Total Tickets"
                value={activeRoundInfo ? Number(activeRoundInfo.totalTickets).toLocaleString() : '...'}
                sub={`Vault #${activeRoundId}`}
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2a2 2 0 0 0 0 4v2a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2a2 2 0 0 0 0-4V7z"/></svg>
                )}
              />
              <StatCard
                label="Total TVL"
                value={`${tvlMON} MON`}
                sub="SHMON Deposited"
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                )}
              />
              <StatCard
                label="Winner"
                value={activeRoundInfo ? shortAddr(activeRoundInfo.winner) : '...'}
                sub={activeRoundInfo ? `Winning ticket: ${activeRoundInfo.winningTicket}` : ''}
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h12v3a4 4 0 0 1-4 4h-1v2.08A4 4 0 0 1 16 17v2H8v-2a4 4 0 0 1 3-3.87V11h-1a4 4 0 0 1-4-4V4z"/></svg>
                )}
              />
              <StatCard
                label="Current Prize Pool"
                value={activeRoundInfo && (isV2Pool ? Number(activeRoundInfo.state) === 2 : Number(activeRoundInfo.state) === 3) ? `${Number(ethers.formatEther(activeRoundInfo.yieldMON ?? activeRoundInfo.prizeShares ?? 0n)).toFixed(4)} MON` : currentPrizePool.value}
                sub={activeRoundInfo && (isV2Pool ? Number(activeRoundInfo.state) === 2 : Number(activeRoundInfo.state) === 3) ? 'Final settled yield' : currentPrizePool.sub}
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17h2.59l3.7-3.71 3 3L17.59 11H20v2h-1.59l-6.12 6.12-3-3L7 18.41V21H3v-4zM14 3h7v7h-2V6.41l-5.29 5.3-1.42-1.42 5.3-5.29H14V3z"/></svg>
                )}
              />
            </>
          )}
        </section>
        </>) : null}
      </div>
    </div>
  )
}
