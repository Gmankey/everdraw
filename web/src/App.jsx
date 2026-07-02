import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ethers } from 'ethers'
import VaultAnimationTest from './components/VaultAnimationTest'
import ShmonPanel from './ShmonPanel'
import { StatsPage } from './Stats.jsx'
import { modal } from './walletModal.ts'
import monIcon from './assets/MON.png'
import shmonIcon from './assets/shmon.png'
import { _cached, assertNotAborted, getCachedRoundInfo, isAbortError, withAbort } from './rpcCache.js'
import './App.css'
import './shmon.css'

// Vercel build-ignore guard markers for production deploys: points/preview, setMaxTickets.

function getWalletProvider() {
  return modal.getWalletProvider() || window.ethereum || null
}

function getInjectedWalletProviders() {
  const injected = window.ethereum
  if (!injected) return []
  const providers = Array.isArray(injected.providers) ? injected.providers : [injected]
  return providers
    .filter((provider) => provider && typeof provider.request === 'function')
    .sort((a, b) => Number(Boolean(b.isMetaMask)) - Number(Boolean(a.isMetaMask)))
}

async function getProviderAccounts(provider) {
  try {
    const accounts = await provider.request({ method: 'eth_accounts' })
    return Array.isArray(accounts) ? accounts.map((addr) => String(addr).toLowerCase()) : []
  } catch {
    return []
  }
}

async function getDepositWalletProvider(connectedAccount) {
  const lcAccount = String(connectedAccount || '').toLowerCase()
  for (const provider of getInjectedWalletProviders()) {
    const accounts = await getProviderAccounts(provider)
    if (!lcAccount || accounts.includes(lcAccount)) return provider
  }
  return getWalletProvider()
}

const POOL_ABI = [
  'function currentRoundId() view returns (uint256)',
  'function getRoundInfo(uint256 rid) view returns (uint8 state,uint64 salesEndTime,uint32 totalTickets,uint256 totalPrincipalMON,uint256 totalShmonShares,uint256 targetBlockNumber,address winner,uint32 winningTicket,uint64 unstakeCompletionEpoch,uint256 monReceived,uint256 yieldMON,uint256 lossRatio,bool prizeClaimed)',
  'function nextExecutable() view returns (uint256 rid,uint8 action)',
  'function ticketPriceMON() view returns (uint96)',
  'function depositPeriodSec() view returns (uint32)',
  'function yieldPeriodSec() view returns (uint32)',
  'function getCommitAfterTime(uint256) view returns (uint64)',
  'function shmon() view returns (address)',
  'function buyTickets(uint32 ticketCount) payable',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function principalMON(uint256 rid, address user) view returns (uint256)',
  'event RoundStarted(uint256 indexed roundId, uint64 salesEndTime)',
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
  'function getWithdrawableShares(uint256 rid, address user) view returns (uint256)',
  'function shmon() view returns (address)',
  'function buyTickets(uint32 ticketCount) payable',
  'function buyTicketsMON(uint32 ticketCount) payable',
  'function buyTicketsShmon(uint32 ticketCount)',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function principalMON(uint256 rid, address user) view returns (uint256)',
  'function getUserPosition(uint256 rid, address user) view returns (uint128 principalMONOut, uint128 principalShmonSharesOut)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)'
]

const POOL_V3_ABI = [
  'function getRoundInfo(uint256 rid) view returns (uint8 state,uint64 salesEndTime,uint64 vrfSequenceNumber,uint32 totalTickets,uint256 totalPrincipalMON,uint256 totalShmonShares,uint256 principalSharesAtSettle,uint256 prizeShares,uint256 shareRateAtSettle,address winner,uint32 winningTicket,bool prizeClaimed)',
  'function getUserPosition(uint256 rid, address user) view returns (uint128 principalMONOut, uint128 principalShmonSharesOut)',
]

const POOL_V4_ABI = [
  'function currentRoundId() view returns (uint256)',
  'function getRoundInfo(uint256 rid) view returns (uint8 state,uint64 salesEndTime,uint64 requestId,uint32 totalTickets,uint256 totalPrincipalAsset,uint256 totalPrincipalShares,uint256 principalSharesAtSettle,uint256 totalPrizeShares,uint16 forfeitBps,bool wasSkipped)',
  'function nextExecutable() view returns (uint256 rid,uint8 action)',
  'function ticketPriceAsset() view returns (uint256)',
  'function roundDurationSec() view returns (uint32)',
  'function yieldPeriodSec() view returns (uint32)',
  'function getCommitAfterTime(uint256 rid) view returns (uint64)',
  'function yieldVault() view returns (address)',
  'function asset() view returns (address)',
  'function assetSymbol() view returns (string)',
  'function depositMode() view returns (uint8)',
  'function paused() view returns (bool)',
  'function stoppedAt() view returns (uint64)',
  'function buyTickets(uint32 ticketCount) payable',
  'function buyTicketsShmon(uint32 ticketCount)',
  'function sponsor(uint256 rid, string memo) payable',
  'function sponsorERC20(uint256 rid, uint256 amount, string memo)',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function getUserPosition(uint256 rid, address user) view returns (uint128 principalAssetOut, uint128 principalSharesOut)',
  'function hasPendingClaims(address user) view returns (bool)',
  'function balanceOf(address user) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 assetPaid)',
  'event WinnersDrawn(uint256 indexed roundId, address[] winners, uint32[] winningTickets, uint256[] prizeShares)',
  'event RandomnessRequested(uint256 indexed roundId, uint64 indexed requestId, uint128 fee)',
  'event RandomnessFulfilled(uint256 indexed roundId, uint64 indexed requestId, bytes32 randomNumber)',
  'event Deposit(address indexed recipient, uint256 amount)',
  'event Withdraw(address indexed recipient, uint256 amount)'
]

const SHMON_READ_ABI = [
  'function getInternalEpoch() view returns (uint64)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256 assets)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function previewWithdraw(uint256 assets) view returns (uint256 shares)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]

const ACTION_LABELS = ['None', 'Skip', 'Commit', 'Draw', 'Claim / Redeem', 'Recommit']
const ACTION_LABELS_V2 = ['None', 'Commit', 'Claim / Redeem', 'Mark Skipped']
const STATE_LABELS = ['Deposit Open', 'Yield Accruing', 'Winner Revealed', 'Claim / Redeem']
const STATE_LABELS_V2 = ['Deposit Open', 'Winner Revealed', 'Claim / Redeem', 'Skipped', 'Skipped']
const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'https://everdraw-indexer.fly.dev'

function isSettledState(state, isV2 = false) {
  const n = Number(state)
  return isV2 ? n === 2 : n === 3
}

function isTerminalRound(state, isV2 = false) {
  const n = Number(state)
  return isV2 ? n >= 2 : n === 3
}

function isFailedRound(state, isV2 = false) {
  return isV2 && Number(state) === 4
}

const WAD = 10n ** 18n

function roundYieldWei(info, usesSharePrizeAccounting = false) {
  if (!info) return 0n
  if (info.totalPrizeShares != null) return BigInt(info.totalPrizeShares ?? 0n)
  if (!usesSharePrizeAccounting) return BigInt(info.yieldMON ?? 0n)

  const prizeShares = BigInt(info.prizeShares ?? 0n)
  const shareRateAtSettle = BigInt(info.shareRateAtSettle ?? 0n)
  if (prizeShares === 0n) return 0n

  // V2/V3 settle prizes in shMON shares. Display them as MON using the
  // settlement share rate, with a fallback for old compat data.
  return shareRateAtSettle > 0n ? (prizeShares * shareRateAtSettle) / WAD : prizeShares
}

const SHMON_ABI = [
  'function getInternalEpoch() view returns (uint64)',
  'function previewRedeem(uint256 shares) view returns (uint256 assets)',
]
const SHMON_ADDRESS = import.meta.env.VITE_SHMON_ADDRESS || '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
const FRONTEND_TICKET_CAP = 25000
const ACTIVE_POOL_REPLACEMENTS = {
  // V4.1 supersedes V4. Keep retired addresses in known-pool scans below
  // so old-round participants can still find redeemable positions.
  '0x9263d84a141172d9618f4b08839f595ee03bc7e8': '0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA',
  '0x08bdd3710abb0616cc29f388867f5625106b2a3e': '0x1886f329e486e934c76028B15a580850e74d404C',
}

function formatMon(value, digits = 4) {
  try {
    return Number(ethers.formatEther(value || 0n)).toFixed(digits)
  } catch {
    return '0.0000'
  }
}

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString()
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatDepositMon(wei) {
  const formatted = ethers.formatEther(BigInt(wei || 0n))
  const [whole, decimals = ''] = formatted.split('.')
  const trimmed = decimals.slice(0, 4).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function trackEvent(name, params = {}) {
  if (typeof window === 'undefined') return
  if (typeof window.gtag === 'function') window.gtag('event', name, params)
  if (window.posthog && typeof window.posthog.capture === 'function') window.posthog.capture(name, params)
}

function initPosthog() {
  if (typeof window === 'undefined' || window.__everdrawPosthogInitialized) return
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return
  const host = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
  window.__everdrawPosthogInitialized = true
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split('.');2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement('script')).type='text/javascript',p.crossOrigin='anonymous',p.async=!0,p.src=s.api_host.replace('.i.posthog.com','-assets.i.posthog.com')+'/static/array.js',(r=t.getElementsByTagName('script')[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',u.people=u.people||[],u.toString=function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),t||(e+=' (stub)'),e},u.people.toString=function(){return u.toString(1)+'.people (stub)'},o='init capture identify reset get_distinct_id get_session_id captureException debug'.split(' '),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  window.posthog.init(key, {
    api_host: host,
    capture_pageview: false,
    autocapture: true,
    person_profiles: 'identified_only',
  })
}

function trackPageView(pagePath, pageTitle = document.title) {
  trackEvent('$pageview', {
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
    page_title: pageTitle,
  })
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

function applyActivePoolReplacements(addresses) {
  const active = []
  const retired = []
  const seen = new Set()
  const push = (addr, bucket = active) => {
    const lc = String(addr || '').toLowerCase()
    if (!ethers.isAddress(addr) || seen.has(lc)) return
    seen.add(lc)
    bucket.push(addr)
  }

  for (const addr of addresses) {
    const replacement = ACTIVE_POOL_REPLACEMENTS[String(addr).toLowerCase()]
    if (replacement) {
      push(replacement)
      retired.push(addr)
    } else {
      push(addr)
    }
  }

  for (const addr of retired) push(addr, active)
  return active
}

function parsePoolAddresses() {
  return applyActivePoolReplacements(parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES, import.meta.env.VITE_POOL_ADDRESS))
}

function parseV2PoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES_V2, import.meta.env.VITE_POOL_ADDRESS_V2)
}

function parseV3PoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES_V3, import.meta.env.VITE_POOL_ADDRESS_V3)
}

function parseV4PoolAddresses() {
  return applyActivePoolReplacements(parseAddressEnv(
    [
      import.meta.env.VITE_POOL_ADDRESSES_V4,
      import.meta.env.VITE_POOL_ADDRESS_V4,
      import.meta.env.VITE_V4_A_ADDRESS,
      import.meta.env.VITE_V4_B_ADDRESS,
    ].filter(Boolean).join(','),
    ''
  ))
}

function roundPrincipalWei(info) {
  return BigInt(info?.totalPrincipalAsset ?? info?.totalPrincipalMON ?? 0n)
}

function hexChainIdToDec(hexId) {
  if (!hexId) return null
  return Number.parseInt(hexId, 16)
}

function shortAddr(addr) {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function labelLetter(index) {
  return String.fromCharCode(65 + Math.max(0, Number(index) || 0))
}

function isActiveV2PoolIndex(index) {
  // Product UI currently has two public live vaults: Vault A and Vault B.
  // Older V2 deployments can still contain redeemable user positions, but
  // should not be presented as a mysterious live "Vault 3".
  return index >= 0 && index < 2
}


function getIndexerBaseUrl() {
  return String(import.meta.env.VITE_INDEXER_URL || INDEXER_URL || 'https://everdraw-indexer.fly.dev').replace(/\/$/, '')
}

function tierClass(tier) {
  return `tier-chip tier-${String(tier || 'Bronze').toLowerCase()}`
}

function bonusLabel(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .trim()
    .toLowerCase()
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
  const historyRows = Array.isArray(history) ? history : []
  const hasHistoryBonus = (targetLabel) => historyRows.some((row) =>
    Object.entries(row?.bonuses_breakdown || {}).some(([key, value]) =>
      Number(value) > 0 && bonusLabel(key) === targetLabel
    )
  )
  const streakWeeks = Number(points?.current_streak_weeks || 0)
  const multiplierX100 = Number(points?.current_multiplier_x100 || 100)
  const dotCount = 52
  const litDots = Math.max(0, Math.min(dotCount, streakWeeks))
  const highestMilestoneAwarded = Number(points?.highest_streak_milestone_awarded || 0)
  const streakMilestones = [
    { weeks: 2, label: 'Germination Streak', points: 10, visible: true },
    { weeks: 4, label: 'Sprout Streak', points: 50 },
    { weeks: 13, label: 'Seedling Streak', points: 200 },
    { weeks: 26, label: 'Flourishing Streak', points: 500 },
    { weeks: 52, label: 'Evergreen Streak', points: 1000 },
  ].map((m) => ({ ...m, claimed: highestMilestoneAwarded >= m.weeks || streakWeeks >= m.weeks }))
  const noWinWeeks = Number(points?.consecutive_non_wins || points?.current_no_win_streak_weeks || points?.no_win_streak_weeks || 0)
  const highestLossAwarded = Number(points?.highest_loss_streak_bonus_awarded || 0)
  const firstDepositDone = Boolean(Number(points?.has_received_first_deposit_bonus || 0) || points?.first_deposit_completed || points?.has_deposited || Number(points?.deposit_count || 0) > 0)
  const comebackKingDone = Boolean(Number(points?.has_received_comeback_king_bonus || points?.has_received_first_win_bonus || 0) || points?.first_win_completed || points?.has_won || Number(points?.win_count || 0) > 0)
  const winDone = Boolean(points?.has_won || Number(points?.win_count || 0) > 0 || hasHistoryBonus('win'))
  const twoVaultsDone = Boolean(Number(points?.has_received_on_the_double_bonus || 0) || points?.two_vaults_completed || Number(points?.vault_count || points?.vaults_entered || 0) >= 2)
  const bonuses = [
    { key: 'first-deposit', label: 'First Deposit', unlocked: firstDepositDone, visible: true, tooltip: 'A first time playing bonus +25' },
    { key: 'win', label: 'Win', unlocked: winDone, hidden: !winDone, tooltip: 'Winning a round +25' },
    ...streakMilestones.map((m) => ({
      key: `streak-${m.weeks}`,
      label: m.claimed || m.visible ? m.label : '???',
      unlocked: m.claimed,
      hidden: !m.claimed && !m.visible,
      visible: Boolean(m.visible),
      tooltip: `${m.weeks} week streak +${m.points}`,
    })),
    { key: 'first-win', label: comebackKingDone ? 'First Win' : '???', unlocked: comebackKingDone, hidden: !comebackKingDone, tooltip: 'Congrats on your first win! +100' },
    { key: 'one-two-double', label: twoVaultsDone ? 'One Two Double' : '???', unlocked: twoVaultsDone, hidden: !twoVaultsDone, tooltip: 'Active in both vaults +50' },
    { key: 'rising', label: highestLossAwarded >= 10 || noWinWeeks >= 10 ? 'Rising' : '???', unlocked: highestLossAwarded >= 10 || noWinWeeks >= 10, hidden: highestLossAwarded < 10 && noWinWeeks < 10, tooltip: 'Hang in there +50' },
    { key: 'ascended', label: highestLossAwarded >= 26 || noWinWeeks >= 26 ? 'Ascended' : '???', unlocked: highestLossAwarded >= 26 || noWinWeeks >= 26, hidden: highestLossAwarded < 26 && noWinWeeks < 26, tooltip: 'Virtuous patience must be rewarded +200' },
    { key: 'transcended', label: highestLossAwarded >= 52 || noWinWeeks >= 52 ? 'Transcended' : '???', unlocked: highestLossAwarded >= 52 || noWinWeeks >= 52, hidden: highestLossAwarded < 52 && noWinWeeks < 52, tooltip: 'Few have reached this level of transcendence +500' },
  ].sort((a, b) => Number(b.unlocked) - Number(a.unlocked))
  const ensName = points?.ens && !ethers.isAddress(points.ens) && points.ens.toLowerCase() !== account.toLowerCase() ? points.ens : ''
  const recentRounds = historyRows.slice(0, 12)
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
              <span className="points-popover-kicker">Weekly streak</span>
              <strong>{streakWeeks} Week Streak</strong>
            </div>
            <div className="points-streak-dots points-streak-dots-52" aria-label={`${litDots} of ${dotCount} weeks active`}>
              {Array.from({ length: dotCount }).map((_, i) => {
                const week = i + 1
                const milestone = streakMilestones.find((m) => m.weeks === week)
                return <span key={week} className={`${i < litDots ? 'lit' : ''} ${milestone ? 'milestone-dot' : ''} ${milestone?.claimed ? 'claimed' : ''}`} />
              })}
            </div>
          </div>
        </div>

        <aside className="points-profile-side rewards-side-card">
          <div className="points-milestones-panel rewards-milestones-panel rewards-bonuses-panel">
            <h3>Bonuses🔷</h3>
            <div className="points-milestone-list rewards-bonus-list">
              {bonuses.map((bonus) => (
                <div className={`points-milestone-row rewards-bonus-row ${bonus.unlocked ? 'claimed' : 'locked'} ${bonus.hidden ? 'hidden-bonus' : ''}`} key={bonus.key} title={bonus.tooltip}>
                  <span className="points-milestone-icon" aria-hidden="true">{bonus.unlocked ? '✓' : bonus.hidden ? '?' : ''}</span>
                  <div>
                    <strong>{bonus.label}</strong>
                    <small>{bonus.hidden ? '' : bonus.unlocked ? 'Unlocked' : bonus.tooltip}</small>
                  </div>
                  <span className="points-milestone-status">{bonus.unlocked ? 'UNLOCKED' : bonus.hidden ? '' : 'Locked'}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="points-recent-rounds">
        <h3>Recent rounds</h3>
        <div className="participants-table">
          <div className="participants-row participants-header points-rounds-row"><span>Round</span><span>Tickets Bought</span><span>Multiplier</span><span>Bonus</span><span>Total</span></div>
          {recentRounds.length === 0 ? (
            <div className="points-empty-state">No rounds yet. Buy a ticket to start earning.</div>
          ) : recentRounds.map((h) => {
            const bonusEntries = Object.entries(h.bonuses_breakdown || {}).filter(([, value]) => Number(value) > 0)
            return (
              <div className="participants-row points-rounds-row" key={`${h.pool_address}:${h.round_id}`}>
                <span>#{h.round_id}</span>
                <span>{h.base_points}</span>
                <span>×{(h.multiplier_x100 / 100).toFixed(2)}</span>
                <span className="round-bonus-pills">
                  {bonusEntries.map(([key]) => <span className="round-bonus-pill" key={key}>{bonusLabel(key)}</span>)}
                </span>
                <span>+{h.total_points}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function LeaderboardPage({ account }) {
  const [period, setPeriod] = useState('all')
  const [rows, setRows] = useState([])
  useEffect(() => {
    const ac = new AbortController()
    fetch(`${getIndexerBaseUrl()}/api/leaderboard?limit=100&period=${period}`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { assertNotAborted(ac.signal); setRows(Array.isArray(data) ? data : []) })
      .catch((err) => { if (!isAbortError(err)) setRows([]) })
    return () => ac.abort()
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
  if (seconds <= 0) return '0m'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)

  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

let _readProvider = null
async function getReadProvider() {
  if (!_readProvider) {
    if (import.meta.env.VITE_RPC_URL) {
      _readProvider = new ethers.JsonRpcProvider(import.meta.env.VITE_RPC_URL)
      const _origSend = _readProvider.send.bind(_readProvider)
      _readProvider.send = async function(method, params) {
        if (method === 'eth_call' && params?.[0]?.gas !== undefined) {
          const [tx, ...rest] = params
          const { gas, ...txNoGas } = tx
          return _origSend(method, [txNoGas, ...rest])
        }
        return _origSend(method, params)
      }
    } else if (window.ethereum) {
      _readProvider = new ethers.BrowserProvider(window.ethereum)
    } else {
      throw new Error('Missing VITE_RPC_URL and no wallet found')
    }
  }
  return _readProvider
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

// Nonce fetch with retry — rpc.monad.xyz occasionally 429s during heavy polling.
// Ethers' internal nonce fetch silently returns undefined on 429 → BigInt(undefined) throws.
// We fetch it ourselves with exponential backoff so one rate-limit blip doesn't kill the tx.
async function fetchNonceWithRetry(account, maxRetries = 6) {
  const BASE_MS = 250
  let lastErr
  for (let i = 0; i < maxRetries; i++) {
    try {
      const provider = await getReadProvider()
      const nonce = await provider.getTransactionCount(account, 'pending')
      if (typeof nonce === 'number' && Number.isFinite(nonce)) return nonce
    } catch (e) {
      lastErr = e
    }
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, BASE_MS * (i + 1)))
  }
  throw lastErr || new Error('Failed to fetch nonce after retries')
}
// because ethers v6 BrowserProvider routes through EIP-1193 request(), not send().

const MONAD_TESTNET_CHAIN_PARAMS = {
  chainId: '0x279F',
  chainName: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: ['https://testnet-rpc.monad.xyz'],
  blockExplorerUrls: ['https://testnet.monadexplorer.com'],
}

async function ensureCorrectNetwork(provider, expectedChainId) {
  if (!expectedChainId) return

  const network = await provider.getNetwork()
  if (Number(network.chainId) === expectedChainId) return

  const hexChainId = `0x${expectedChainId.toString(16).toUpperCase()}`

  try {
    await provider.send('wallet_switchEthereumChain', [{ chainId: hexChainId }])
  } catch (switchErr) {
    if (switchErr?.code === 4902 || switchErr?.code === -32603) {
      const chainParams = expectedChainId === 10143
        ? MONAD_TESTNET_CHAIN_PARAMS
        : { chainId: hexChainId }
      await provider.send('wallet_addEthereumChain', [chainParams])
      await provider.send('wallet_switchEthereumChain', [{ chainId: hexChainId }])
    } else {
      throw switchErr
    }
  }
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

function Header({ account, onConnect, currentPage, points, showDegen = false, onDegenClick, onVaultClick, onProfileClick }) {
  return (
    <header>
      <div className="logo">
        <img src="/favicon.png" alt="EverDraw" className="logo-img" />
        EverDraw
      </div>
      <nav className="nav-links">
        <a href="/#vault" className={`nav-link ${currentPage === 'vault' ? 'active' : ''}`} onClick={onVaultClick}>Vault</a>
        {showDegen ? <a href="#patron" className={`nav-link ${currentPage === 'degen' ? 'active' : ''}`} onClick={onDegenClick}>Patron</a> : null}
        <a href="/#stats" className={`nav-link ${currentPage === 'stats' ? 'active' : ''}`}>Stats</a>
        <a href="/#profile" className={`nav-link ${currentPage === 'profile' ? 'active' : ''}`} onClick={onProfileClick}>Profile</a>
        <a href="/#leaderboard" className={`nav-link ${currentPage === 'leaderboard' ? 'active' : ''}`}>Leaderboard</a>
        <a href="/articles/drawn-back-to-defi" className={`nav-link ${currentPage === 'article' ? 'active' : ''}`}>Articles</a>
        <a href="https://docs.everdraw.xyz" target="_blank" rel="noopener noreferrer" className="nav-link">Docs</a>
        <a href="https://x.com/everdrawing" target="_blank" rel="noopener noreferrer" className="nav-link nav-link-x" aria-label="X / Twitter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
      </nav>
      <PointsHeaderWidget account={account} points={points} />
      <div className="header-actions">
        {account ? (
          <button className="btn" onClick={onConnect} title="Switch wallet or account">
            {shortAddr(account)}
          </button>
        ) : (
          <button className="btn" onClick={onConnect}>
            Connect Wallet
          </button>
        )}
      </div>
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

function ClaimFlowModal({ open, mode, busy, status, error, onClose, onRedeemToWallet, onRedeemAndConvert, onBackFromRedirectWarning, confirmRedirectOpen, onConfirmRedirect, isV2 = false, headerNotice = '' }) {
  if (!open) return null

  const isWinner = mode === 'winner'
  const heroEyebrow = ''
  const heroTitle = 'How do you want to claim this round?'
  const heroBody = ''

  const options = isV2
    ? (isWinner
      ? [
          {
            kicker: busy ? 'Working...' : 'REDEEM',
            title: 'Redeem to wallet',
            body: '',
            onClick: onRedeemToWallet,
            tone: 'primary',
          },
          {
            kicker: busy ? 'Working...' : 'REDEEM AND CONVERT',
            title: 'Redeem shMON and convert to MON',
            body: '',
            onClick: onRedeemAndConvert,
            tone: 'default',
          },
        ]
      : [
          {
            kicker: busy ? 'Working...' : 'REDEEM',
            title: 'Redeem to wallet',
            body: '',
            onClick: onRedeemToWallet,
            tone: 'primary',
          },
          {
            kicker: busy ? 'Working...' : 'REDEEM AND CONVERT',
            title: 'Redeem and convert to MON',
            body: '',
            onClick: onRedeemAndConvert,
            tone: 'default',
          },
        ])
    : isWinner
    ? [
        {
          kicker: busy ? 'Working...' : 'REDEEM',
          title: 'Redeem to wallet',
          body: '',
          onClick: onRedeemToWallet,
          tone: 'primary',
        },
        {
          kicker: busy ? 'Working...' : 'REDEEM AND CONVERT',
          title: 'Redeem shMON and convert to MON',
          body: '',
          onClick: onRedeemAndConvert,
          tone: 'default',
        },
      ]
    : [
        {
          kicker: busy ? 'Working...' : 'REDEEM',
          title: 'Redeem to wallet',
          body: '',
          onClick: onRedeemToWallet,
          tone: 'default',
        },
        {
          kicker: busy ? 'Working...' : 'REDEEM AND CONVERT',
          title: 'Redeem and convert to MON',
          body: '',
          onClick: onRedeemAndConvert,
          tone: 'default',
        },
      ]

  const modal = (
    <div className="shmon-modal-backdrop claim-flow-backdrop" role="dialog" aria-modal="true" aria-labelledby="claim-flow-title">
      <div className={`card shmon-modal claim-flow-modal ${isWinner ? 'winner' : 'principal'}`}>
        <div className={`claim-flow-head ${confirmRedirectOpen ? 'compact' : ''}`}>
          <button type="button" className="claim-flow-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
          {!confirmRedirectOpen ? (
            <div className="claim-flow-hero">
              {heroEyebrow ? <div className="claim-flow-eyebrow">{heroEyebrow}</div> : null}
              <div className="claim-flow-title" id="claim-flow-title">{heroTitle}</div>
              {headerNotice ? <p className="claim-flow-body">{headerNotice}</p> : null}
              {heroBody ? <p className="claim-flow-body">{heroBody}</p> : null}
            </div>
          ) : null}
        </div>

        {confirmRedirectOpen ? (
          <div className="claim-flow-confirm">
            <div className="claim-flow-confirm-panel">
              <div className="claim-flow-eyebrow">HEADS UP</div>
              <div className="claim-flow-confirm-copy">You will be redirected to shmonad.xyz to finish MON conversion</div>
            </div>
            <div className="claim-flow-confirm-actions">
              <button type="button" className="claim-option-card claim-confirm-btn" onClick={onBackFromRedirectWarning} disabled={busy}>
                <span className="claim-option-kicker">Go Back</span>
                <strong>Review options</strong>
              </button>
              <button type="button" className="claim-option-card primary claim-confirm-btn" onClick={onConfirmRedirect} disabled={busy}>
                <span className="claim-option-kicker">Continue</span>
                <strong>{busy ? 'Working...' : 'Open shmonad.xyz'}</strong>
              </button>
            </div>
          </div>
        ) : (
          <div className={`claim-flow-grid ${options.length === 2 ? 'two-options' : ''}`}>
            {options.map((option) => (
              <button
                key={option.title}
                type="button"
                className={`claim-option-card ${option.tone === 'primary' ? 'primary' : ''}`}
                onClick={option.onClick}
                disabled={busy}
              >
                <span className="claim-option-kicker">{option.kicker}</span>
                <strong className="claim-option-title">{option.title}</strong>
                {option.body ? <span>{option.body}</span> : null}
              </button>
            ))}
          </div>
        )}

        {status ? <div className="shmon-subline claim-flow-status">{status}</div> : null}
        {error ? <div className="shmon-subline claim-flow-status error">{error}</div> : null}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
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

      <rect x="0" y="0" width="320" height="320" fill="#100d1e" />

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

function WinnersView({ onBack, winner, winnerAddress, prize, participants, participantCount, winnerTickets, totalTickets, roundNumber, isUnstaking, canRedeem, settlementLabel, settlementCountdown, onRedeem, actionBusy, actionStatus, actionError }) {
  const winProbText = typeof winnerTickets === 'number' && totalTickets > 0
    ? `Won with ${((winnerTickets / totalTickets) * 100).toFixed(1)}% chance (${winnerTickets} of ${totalTickets} tickets)`
    : null

  return (
    <div className="winners-view-page">
      <div className="winners-back-wrap">
        <button className="back-link" onClick={onBack}>{'\u2190'} Back to Vault</button>
      </div>

      <div className="winners-hero">
        <h2>{isUnstaking ? 'Winner Revealed' : 'Draw Complete'}</h2>
        {settlementLabel ? <p>{settlementLabel}</p> : null}
        {roundNumber > 0 && <p className="round-label-hero">Round {roundNumber}</p>}
      </div>

      <div className="winner-spotlight-card">
        <div className="winner-address">{winner}</div>
        <div className="winner-stats">
          <div>
            <span>{isUnstaking ? 'Est. Prize' : 'Prize Won'}</span>
            <strong>{prize}</strong>
          </div>
          <div>
            <span>Ticket Count</span>
            <strong>{typeof winnerTickets === 'number' ? winnerTickets.toLocaleString() : winnerTickets}</strong>
          </div>
        </div>
        {winProbText && <div className="win-probability">{winProbText}</div>}
        {isUnstaking ? (
          <button className="btn" disabled>Redeem soon</button>
        ) : canRedeem ? (
          <button className="btn" onClick={onRedeem} disabled={actionBusy}>Redeem now</button>
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
              <span>{'\u2014'}</span><span>No participants indexed yet</span><span>0</span><span>0.00%</span><span>0.0000 MON</span>
            </div>
          ) : participants.map((p, i) => {
            const isWinnerRow = winnerAddress && p.wallet.toLowerCase() === winnerAddress.toLowerCase()
            return (
              <div className={`participants-row${isWinnerRow ? ' winner-row' : ''}`} key={`${p.wallet}-${i}`}>
                <span>{i + 1}</span>
                <span>{p.walletShort}{isWinnerRow ? ' [Winner]' : ''}</span>
                <span>{p.tickets.toLocaleString()}</span>
                <span>{p.sharePct}%</span>
                <span>{p.depositedMon} MON</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="winners-actions-grid">
        <button className="btn ghost-btn" onClick={onRedeem} disabled={actionBusy || !canRedeem || isUnstaking}>
          {isUnstaking
            ? 'Redeem soon'
            : canRedeem
              ? 'Redeem now'
              : settlementCountdown === '00:00:00:00'
                ? 'Nothing to redeem'
                : `Redeem in ${settlementCountdown}`}
        </button>
      </div>

      {actionStatus ? <p className="deposit-caption">{actionStatus}</p> : null}
      {actionError ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{actionError}</p> : null}
    </div>
  )
}

function RoundProgressSteps({ state, settlementSecs, secondsRemaining, isV3 = false }) {
  const steps = [
    'Deposit',
    'Yield Accruing',
    (isV3 && (state === 1 || state === 2)) ? 'Drawing Winner…' : 'Winner Revealed',
    'Claim / Withdraw',
  ]
  let activeStep = 0

  if (isV3) {
    if (state === 0 && secondsRemaining <= 0) activeStep = 1
    if (state === 1 || state === 2) activeStep = 2
    if (state >= 3) activeStep = 3
  } else {
    if (state === 0 && secondsRemaining <= 0) activeStep = 1
    if (state === 1) activeStep = 1
    if (state === 2) activeStep = settlementSecs > 0 ? 2 : 3
    if (state >= 3) activeStep = 3
  }

  return (
    <section className="round-steps">
      {steps.map((label, i) => (
        <div key={i} className={`step ${i < activeStep ? 'done' : i === activeStep ? 'active' : ''}`}>
          {i < steps.length - 1 && <div className="step-line" />}
          <div className="step-circle">{i < activeStep ? '\u2713' : i + 1}</div>
          <div className="step-label">{label}</div>
        </div>
      ))}
    </section>
  )
}

const V5_UAT_DEFAULTS = {
  chainId: 10143,
  rpcUrl: 'https://testnet-rpc.monad.xyz',
  drawManager: '0x9eb6387EeA7daC93AF9585b5D25bfc7e0A3aD89c',
  prizeVault: '0x76A1327c69f6f9f2571b131BB528D0c8ce1D6958',
  twabController: '0x719F4EB6a4187DBAd1647d07F67573B80E5d0376',
  claimManager: '0xF95e319f71B503e396295CD0A55550f56f5901eb',
  shmon: '0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9',
}

const V5_VAULT_ABI = [
  'function deposit() payable returns (uint256)',
  'function depositShmon(uint256 shares) returns (uint256)',
  'function withdraw(uint256 amount) returns (uint256)',
  'function withdrawShmon(uint256 amount) returns (uint256)',
  'function boostDeposit() payable returns (uint256)',
  'function boostDepositShmon(uint256 shares) returns (uint256)',
  'function boostWithdraw(uint256 amount) returns (uint256)',
  'function boostWithdrawShmon(uint256 amount) returns (uint256)',
  'function strategy() view returns (address)',
  'function principalOf(address) view returns (uint256)',
  'function boosterPrincipalOf(address) view returns (uint256)',
  'function totalPrincipal() view returns (uint256)',
  'function totalParticipantPrincipal() view returns (uint256)',
  'function totalBoosterPrincipal() view returns (uint256)',
  'function availableYield() view returns (uint256)',
  'function paused() view returns (bool)',
  'function stoppedAt() view returns (uint64)',
  'event Deposit(address indexed recipient, uint256 amount)',
  'event Withdraw(address indexed recipient, uint256 amount)',
  'event BoostDeposit(address indexed booster, uint256 amount, uint256 balance, uint64 timestamp)',
  'event BoostWithdraw(address indexed booster, uint256 amount, uint256 balance, uint64 timestamp)',
  'error ZeroAmount()',
  'error DepositTooSmall()',
  'error DepositCapExceeded()',
  'error VaultIsStopped()',
  'error InsufficientBalance()',
]

const V5_DRAW_MANAGER_ABI = [
  'function currentDrawId() view returns (uint256)',
  'function nextPeriodStart() view returns (uint64)',
  'function drawPeriod() view returns (uint64)',
  'function previewStartDraw() view returns (bool due,bool willSkip,uint256 requiredFee)',
  'function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)',
  'event RootFinalized(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout)',
]

const V5_CLAIM_MANAGER_ABI = [
  'function claimMany(tuple(bytes32 distributionId,uint256 leafIndex,address account,address token,uint256 amount)[] leaves, bytes32[][] proofs)',
]

const V5_SHMON_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256 assets)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
]

const V5_DRAW_STATUS = ['Waiting', 'Awaiting seed', 'Seeded', 'Proposed', 'Finalized', 'Skipped']

function v5EnvAddress(name, fallback) {
  const value = import.meta.env[name] || fallback
  return ethers.isAddress(value) ? value : fallback
}

function v5Config() {
  return {
    chainId: Number(import.meta.env.VITE_CHAIN_ID || V5_UAT_DEFAULTS.chainId),
    rpcUrl: import.meta.env.VITE_RPC_URL || V5_UAT_DEFAULTS.rpcUrl,
    drawManager: v5EnvAddress('VITE_V5_DRAW_MANAGER_ADDRESS', V5_UAT_DEFAULTS.drawManager),
    prizeVault: v5EnvAddress('VITE_V5_PRIZE_VAULT_ADDRESS', V5_UAT_DEFAULTS.prizeVault),
    twabController: v5EnvAddress('VITE_V5_TWAB_CONTROLLER_ADDRESS', V5_UAT_DEFAULTS.twabController),
    claimManager: v5EnvAddress('VITE_V5_CLAIM_MANAGER_ADDRESS', V5_UAT_DEFAULTS.claimManager),
    shmon: v5EnvAddress('VITE_SHMON_ADDRESS', V5_UAT_DEFAULTS.shmon),
    claimProofUrl: import.meta.env.VITE_V5_CLAIM_PROOF_URL || '',
  }
}

function formatV5Mon(value, digits = 4) {
  try {
    return Number(ethers.formatEther(value || 0n)).toFixed(digits)
  } catch {
    return Number(0).toFixed(digits)
  }
}

function parseV5Mon(value) {
  const clean = String(value || '').trim()
  if (!clean || Number(clean) <= 0) throw new Error('Enter an amount greater than zero')
  return ethers.parseEther(clean)
}

function formatV5Duration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

async function switchToV5Chain(provider, chainId, rpcUrl) {
  const hexChainId = `0x${Number(chainId).toString(16)}`
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] })
  } catch (err) {
    if (err?.code !== 4902) throw err
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hexChainId,
        chainName: 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        rpcUrls: [rpcUrl],
        blockExplorerUrls: ['https://testnet.monadexplorer.com'],
      }],
    })
  }
}

function v5ClaimUrl(template, account, cfg) {
  if (!template) return ''
  const encodedAccount = encodeURIComponent(account)
  const join = template.includes('?') ? '&' : '?'
  if (template.includes('{account}')) {
    return template
      .replaceAll('{account}', encodedAccount)
      .replaceAll('{claimManager}', encodeURIComponent(cfg.claimManager))
      .replaceAll('{vault}', encodeURIComponent(cfg.prizeVault))
  }
  return `${template}${join}account=${encodedAccount}&claimManager=${encodeURIComponent(cfg.claimManager)}&vault=${encodeURIComponent(cfg.prizeVault)}`
}

function normalizeV5ClaimPayload(payload) {
  const leaves = payload?.leaves || payload?.claims || payload?.claim?.leaves || (payload?.leaf ? [payload.leaf] : [])
  const proofs = payload?.proofs || payload?.claim?.proofs || leaves.map((leaf) => leaf.proof || [])
  if (!Array.isArray(leaves) || leaves.length === 0) return null
  return {
    leaves: leaves.map((leaf) => ({
      distributionId: leaf.distributionId,
      leafIndex: leaf.leafIndex,
      account: leaf.account,
      token: leaf.token,
      amount: leaf.amount,
    })),
    proofs,
    total: payload?.total || payload?.amount || leaves.reduce((sum, leaf) => sum + BigInt(leaf.amount || 0), 0n).toString(),
  }
}

function v5EventDate(block) {
  if (!block?.timestamp) return '—'
  return new Date(Number(block.timestamp) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function v5ExplorerTx(hash) {
  return hash ? `https://testnet.monadexplorer.com/tx/${hash}` : '#'
}

const V5_TICKETS_PER_MON_PER_MINUTE = 0.005

function formatV5Tickets(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '0.00'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 1000 ? 0 : 2,
    maximumFractionDigits: n >= 1000 ? 2 : 2,
  })
}

function v5MonNumber(value) {
  try {
    return Number(ethers.formatEther(BigInt(value || 0n)))
  } catch {
    return 0
  }
}

function buildV5TicketModel({ state, account, nowMs }) {
  const blockTime = Number(state?.block?.timestamp || 0)
  const periodStart = Number(state?.nextPeriodStart || 0n)
  const drawPeriod = Number(state?.drawPeriod || 0n)
  const periodEnd = periodStart + drawPeriod
  const principal = BigInt(state?.principal || 0n)
  const events = Array.isArray(state?.periodAccountEvents) ? state.periodAccountEvents : []
  const readAtMs = Number(state?.readAtMs || 0)
  const liveDriftSeconds = readAtMs > 0 ? Math.max(0, (Number(nowMs || Date.now()) - readAtMs) / 1000) : 0
  const now = Math.max(periodStart, Math.min((blockTime || periodStart) + liveDriftSeconds, periodEnd || periodStart))
  const elapsedSeconds = Math.max(0, now - periodStart)
  const totalSeconds = Math.max(1, drawPeriod)
  const sortedEvents = events
    .filter((event) => event.timestamp >= periodStart && event.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp || a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.index - b.index)
  const netDelta = sortedEvents.reduce((sum, event) => {
    const amount = BigInt(event.amount || 0n)
    return event.type === 'deposit' ? sum + amount : sum - amount
  }, 0n)
  let balance = principal - netDelta
  if (balance < 0n) balance = 0n
  let cursor = periodStart
  let balanceMinutes = 0

  for (const event of sortedEvents) {
    const eventTime = Math.max(periodStart, Math.min(Number(event.timestamp || periodStart), now))
    if (eventTime > cursor) {
      balanceMinutes += v5MonNumber(balance) * ((eventTime - cursor) / 60)
      cursor = eventTime
    }
    const amount = BigInt(event.amount || 0n)
    balance = event.type === 'deposit' ? balance + amount : balance - amount
    if (balance < 0n) balance = 0n
  }

  if (now > cursor) {
    balanceMinutes += v5MonNumber(principal) * ((now - cursor) / 60)
  }

  const balanceMon = v5MonNumber(principal)
  const ticketsSoFar = balanceMinutes * V5_TICKETS_PER_MON_PER_MINUTE
  const drawPeriodMinutes = totalSeconds / 60
  const projectedTickets = balanceMon * V5_TICKETS_PER_MON_PER_MINUTE * drawPeriodMinutes
  const liveTicketsPerMinute = balanceMon * V5_TICKETS_PER_MON_PER_MINUTE
  const drawProgressPct = Math.max(0, Math.min(100, (elapsedSeconds / totalSeconds) * 100))

  return {
    hasAccount: Boolean(account),
    hasPrincipal: principal > 0n,
    ticketsSoFar,
    projectedTickets,
    liveTicketsPerMinute,
    drawProgressPct,
  }
}

async function v5BuildHistoryRows({ account, block, vault, manager }) {
  if (!block?.number) return []
  const fromBlock = Math.max(0, Number(block.number) - 200000)
  const [deposits, withdrawals, boostDeposits, boostWithdrawals, finalizedDraws] = await Promise.all([
    account ? vault.queryFilter(vault.filters.Deposit(account), fromBlock, block.number).catch(() => []) : [],
    account ? vault.queryFilter(vault.filters.Withdraw(account), fromBlock, block.number).catch(() => []) : [],
    account ? vault.queryFilter(vault.filters.BoostDeposit(account), fromBlock, block.number).catch(() => []) : [],
    account ? vault.queryFilter(vault.filters.BoostWithdraw(account), fromBlock, block.number).catch(() => []) : [],
    manager.queryFilter(manager.filters.RootFinalized(), fromBlock, block.number).catch(() => []),
  ])

  const logs = [...deposits, ...withdrawals, ...boostDeposits, ...boostWithdrawals, ...finalizedDraws]
  const blockNumbers = [...new Set(logs.map((log) => log.blockNumber).filter(Boolean))]
  const eventProvider = manager.runner?.provider || manager.runner
  const blockMap = new Map(await Promise.all(blockNumbers.map(async (blockNumber) => [
    blockNumber,
    await eventProvider.getBlock(blockNumber).catch(() => null),
  ])))

  const rows = [
    ...deposits.map((log) => ({
      key: `${log.transactionHash}-deposit-${log.index}`,
      blockNumber: log.blockNumber,
      date: v5EventDate(blockMap.get(log.blockNumber)),
      transaction: 'Deposit',
      result: 'Entered',
      principal: `+${formatV5Mon(log.args?.amount)} MON`,
      prize: '—',
      tx: log.transactionHash,
    })),
    ...withdrawals.map((log) => ({
      key: `${log.transactionHash}-withdraw-${log.index}`,
      blockNumber: log.blockNumber,
      date: v5EventDate(blockMap.get(log.blockNumber)),
      transaction: 'Withdraw',
      result: 'Exited',
      principal: `-${formatV5Mon(log.args?.amount)} MON`,
      prize: '—',
      tx: log.transactionHash,
    })),
    ...boostDeposits.map((log) => ({
      key: `${log.transactionHash}-boost-deposit-${log.index}`,
      blockNumber: log.blockNumber,
      date: v5EventDate(blockMap.get(log.blockNumber)),
      transaction: 'Patron Pool deposit',
      result: 'Prize excluded',
      principal: `+${formatV5Mon(log.args?.amount)} MON`,
      prize: '—',
      tx: log.transactionHash,
    })),
    ...boostWithdrawals.map((log) => ({
      key: `${log.transactionHash}-boost-withdraw-${log.index}`,
      blockNumber: log.blockNumber,
      date: v5EventDate(blockMap.get(log.blockNumber)),
      transaction: 'Patron Pool withdraw',
      result: 'Prize excluded',
      principal: `-${formatV5Mon(log.args?.amount)} MON`,
      prize: '—',
      tx: log.transactionHash,
    })),
    ...finalizedDraws.map((log) => ({
      key: `${log.transactionHash}-draw-${log.index}`,
      blockNumber: log.blockNumber,
      date: v5EventDate(blockMap.get(log.blockNumber)),
      transaction: `Prize draw #${log.args?.drawId?.toString?.() || '—'}`,
      result: 'Finalized',
      principal: '—',
      prize: `${formatV5Mon(log.args?.totalPayout)} MON`,
      tx: log.transactionHash,
    })),
  ]

  return rows.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 24)
}

function V5ActionCard({
  mode,
  amount,
  setAmount,
  principal,
  walletBalance,
  shmonBalance,
  depositAsset = 'MON',
  setDepositAsset,
  tickets,
  actionMode = 'deposit',
  setActionMode,
  notice,
  busy,
  account,
  boosterSupported,
  onDeposit,
  onWithdraw,
  onConnect,
}) {
  const isDegen = mode === 'degen'
  const isDeposit = actionMode === 'deposit'
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  const depositUsesShmon = isDeposit && depositAsset === 'shMON'
  const balanceLabel = isDeposit
    ? depositUsesShmon ? 'shMON balance' : 'Wallet balance'
    : isDegen ? 'Patron Pool balance' : 'Deposited balance'
  const balanceValue = isDeposit ? (depositUsesShmon ? shmonBalance : walletBalance) : principal
  const balanceUnit = depositUsesShmon ? 'shMON' : 'MON'
  const submitVerb = isDeposit ? (isDegen ? 'Deposit' : 'Deposit') : 'Withdraw'
  const submitLabel = busy
    ? 'Submitting...'
    : !account
      ? `Connect Wallet to ${isDeposit ? 'Deposit' : 'Withdraw'}`
      : isDeposit ? `${submitVerb} with ${depositAsset}` : submitVerb

  return (
    <div className={`card v5-product-card${isDegen ? ' v5-degen-card' : ''}`}>
      {isDegen ? (
        <div className="card-header">
          <div>
            <div className="card-title">Patron Pool</div>
          </div>
        </div>
      ) : null}

      <section className="v5-action-pill" aria-label={isDegen ? 'Deposit to Patron Pool or withdraw' : 'Deposit or withdraw'}>
        <button className={`v5-action-pill-btn ${isDeposit ? 'active' : ''}`} onClick={() => setActionMode('deposit')}>Deposit</button>
        <div className="v5-action-pill-track">
          <button
            type="button"
            className={`v5-action-pill-knob ${!isDeposit ? 'right' : ''}`}
            onClick={() => setActionMode(isDeposit ? 'withdraw' : 'deposit')}
            aria-label={isDeposit ? 'Switch to withdraw' : 'Switch to deposit'}
          >
            {isDeposit ? '+' : '-'}
          </button>
        </div>
        <button className={`v5-action-pill-btn ${!isDeposit ? 'active' : ''}`} onClick={() => setActionMode('withdraw')}>Withdraw</button>
      </section>

      <div className="deposit-area">
        <div className="input-group">
          <div className="input-wrapper">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="currency-label">MON</span>
          </div>
          <div className="balance-info">
            <span>{balanceLabel}</span>
            <span className="v5-balance-actions">
              <span>{formatV5Mon(balanceValue || 0n)} {balanceUnit}</span>
              <button className="max-btn" onClick={() => setAmount(formatDepositMon(balanceValue || 0n))}>Max</button>
            </span>
          </div>
        </div>

        <div className="deposit-cta-wrap">
          {isDeposit ? (
            <div className="token-selector-wrap">
              <div className="token-selector">
                <button
                  className="token-select-btn"
                  type="button"
                  onClick={() => setTokenDropdownOpen((open) => !open)}
                >
                  <img src={depositUsesShmon ? shmonIcon : monIcon} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />
                  <span>{depositAsset}</span>
                  <span className="token-select-arrow">▾</span>
                </button>
                {tokenDropdownOpen ? (
                  <div className="token-dropdown">
                    <button
                      className={`token-dropdown-item${depositAsset === 'MON' ? ' selected' : ''}`}
                      onClick={() => { setDepositAsset('MON'); setTokenDropdownOpen(false) }}
                    >
                      <img src={monIcon} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', marginRight: 6, verticalAlign: 'middle' }} />
                      MON
                    </button>
                    <button
                      className={`token-dropdown-item${depositAsset === 'shMON' ? ' selected' : ''}`}
                      onClick={() => { setDepositAsset('shMON'); setTokenDropdownOpen(false) }}
                    >
                      <img src={shmonIcon} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', marginRight: 6, verticalAlign: 'middle' }} />
                      shMON
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <button
            className="btn deposit-btn"
            disabled={Boolean(busy) || (isDegen && !boosterSupported && Boolean(account))}
            onClick={!account ? onConnect : isDeposit ? onDeposit : onWithdraw}
          >
            {submitLabel}
          </button>
          {notice ? <p className="deposit-caption">{notice}</p> : null}
          {isDegen && !boosterSupported ? (
            <p className="deposit-caption">This UAT vault needs the post-#167 redeploy before Patron Pool transactions can run.</p>
          ) : null}
        </div>

        {!isDegen ? (
          <div className="v5-tickets-panel">
            <div className="participants-head v5-tickets-head">
              <span>Your tickets · this draw</span>
              <span title="Tickets are rebuilt each draw from your MON balance over time. Add more MON and they pile up faster; withdraw anytime.">Live</span>
            </div>
            <div className="v5-tickets-value">{formatV5Tickets(tickets?.ticketsSoFar || 0)}</div>
            <div className="v5-tickets-rate">
              +{formatV5Tickets(tickets?.liveTicketsPerMinute || 0)} tickets / min
            </div>
            <div className="v5-tickets-timeline" aria-label="Current draw ticket progress">
              <div className="v5-tickets-fill" style={{ width: `${tickets?.drawProgressPct || 0}%` }} />
            </div>
            <div className="v5-tickets-scale">
              <span>Start</span>
              <span>Draw</span>
            </div>
            <p className="deposit-caption v5-tickets-copy">
              {tickets?.hasPrincipal
                ? 'Your tickets grow the longer your MON sits — add more and they pile up faster. New draw, your tickets rebuild.'
                : 'Deposit to start building tickets for this draw. Each new draw starts fresh and rebuilds from your MON over time.'}
            </p>
          </div>
        ) : (
          <details className="v5-patron-details">
            <summary>What is the Patron Pool?</summary>
            <p>
              Depositing in the Patron Pool gives you 0 entries into the weekly draw. Instead, you become a patron and contribute your yield to the prize pool. This noble sacrifice helps make the weekly prize larger for everyone while you earn boosted EverDraw points.
            </p>
            <p>
              This pool is illiquid and deposits are not tradeable in DeFi. When you withdraw, you receive 100% of your initial MON deposit value back as shMON.
            </p>
          </details>
        )}
      </div>
    </div>
  )
}

function V5PreviousRound({ state, onBack, onClaim, canClaimPrize, busy, status, error }) {
  const draw = state?.draw
  const drawId = state?.currentDrawId?.toString?.() || '0'
  const winnerCount = Number(draw?.winnerCount ?? draw?.[6] ?? 0)
  const prize = `${formatV5Mon(draw?.totalPayout ?? draw?.[5])} MON`
  const statusLabel = draw ? V5_DRAW_STATUS[Number(draw?.status ?? draw?.[11])] || 'Unknown' : 'Warming up'

  return (
    <div className="winners-view-page">
      <div className="winners-back-wrap">
        <button className="back-link" onClick={onBack}>{'\u2190'} Back to Vault</button>
      </div>

      <div className="winners-hero">
        <h2>Previous Round</h2>
        <p className="round-label-hero">Draw {drawId}</p>
      </div>

      <div className="winner-spotlight-card">
        <div className="winner-address">{winnerCount > 0 ? `${winnerCount} winner${winnerCount === 1 ? '' : 's'}` : 'No winner yet'}</div>
        <div className="winner-stats">
          <div>
            <span>Prize Won</span>
            <strong>{prize}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{statusLabel}</strong>
          </div>
        </div>
        <button className="btn" onClick={onClaim} disabled={Boolean(busy) || !canClaimPrize}>Claim Prize</button>
      </div>

      <div className="participants-card">
        <div className="participants-head">
          <span>All Participants</span>
          <span>V5 UAT</span>
        </div>
        <div className="participants-table">
          <div className="participants-row">
            <span>{'\u2014'}</span><span>Winner data comes from the V5 claim indexer when a draw finalizes.</span><span>{winnerCount}</span><span>{statusLabel}</span><span>{prize}</span>
          </div>
        </div>
      </div>

      {status ? <p className="deposit-caption">{status}</p> : null}
      {error ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{error}</p> : null}
    </div>
  )
}

function V5HistoryTable({ account, rows }) {
  return (
    <section className="participants-card v5-history-card">
      <div className="participants-head">
        <span>My History</span>
        <span>{account ? shortAddr(account) : 'Connect wallet'}</span>
      </div>
      <div className="participants-table">
        <div className="participants-row participants-header v5-history-row">
          <span>Date</span><span>Transaction</span><span>Result</span><span>Principal</span><span>Prize</span>
        </div>
        {!account ? (
          <div className="points-empty-state">Connect a wallet to view your history.</div>
        ) : rows.length === 0 ? (
          <div className="points-empty-state">No V5 UAT history found yet.</div>
        ) : rows.map((row) => (
          <div className="participants-row v5-history-row" key={row.key}>
            <span>{row.date}</span>
            <span>{row.tx ? <a className="stats-winner-link" href={v5ExplorerTx(row.tx)} target="_blank" rel="noopener noreferrer">{row.transaction}</a> : row.transaction}</span>
            <span>{row.result}</span>
            <span>{row.principal}</span>
            <span>{row.prize}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function V5UatExperience() {
  initPosthog()
  const cfg = useMemo(v5Config, [])
  const [account, setAccount] = useState('')
  const [playAmount, setPlayAmount] = useState('1')
  const [degenAmount, setDegenAmount] = useState('1')
  const [state, setState] = useState(null)
  const [v5Page, setV5Page] = useState('vault')
  const [playActionMode, setPlayActionMode] = useState('deposit')
  const [degenActionMode, setDegenActionMode] = useState('deposit')
  const [playDepositAsset, setPlayDepositAsset] = useState('MON')
  const [degenDepositAsset, setDegenDepositAsset] = useState('MON')
  const [playNotice, setPlayNotice] = useState('')
  const [degenNotice, setDegenNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())
  const [withdrawRequest, setWithdrawRequest] = useState(null)
  const [withdrawChoiceOpen, setWithdrawChoiceOpen] = useState(false)
  const [withdrawRedirectWarningOpen, setWithdrawRedirectWarningOpen] = useState(false)
  const [pointsProfile, setPointsProfile] = useState(null)
  const [pointsHistory, setPointsHistory] = useState([])

  const readProvider = useMemo(() => new ethers.JsonRpcProvider(cfg.rpcUrl), [cfg.rpcUrl])
  const vault = useMemo(() => new ethers.Contract(cfg.prizeVault, V5_VAULT_ABI, readProvider), [cfg.prizeVault, readProvider])
  const manager = useMemo(() => new ethers.Contract(cfg.drawManager, V5_DRAW_MANAGER_ABI, readProvider), [cfg.drawManager, readProvider])
  const shmon = useMemo(() => new ethers.Contract(cfg.shmon, V5_SHMON_ABI, readProvider), [cfg.shmon, readProvider])

  const refresh = useCallback(async (targetAccount = account) => {
    setError('')
    const [
      block,
      currentDrawId,
      nextPeriodStart,
      drawPeriod,
      preview,
      totalPrincipal,
      totalParticipantPrincipal,
      totalBoosterPrincipal,
      availableYield,
      paused,
      stoppedAt,
      vaultCode,
    ] = await Promise.all([
      readProvider.getBlock('latest'),
      manager.currentDrawId(),
      manager.nextPeriodStart(),
      manager.drawPeriod(),
      manager.previewStartDraw().catch(() => null),
      vault.totalPrincipal(),
      vault.totalParticipantPrincipal(),
      vault.totalBoosterPrincipal().catch(() => null),
      vault.availableYield(),
      vault.paused(),
      vault.stoppedAt(),
      readProvider.getCode(cfg.prizeVault),
    ])

    const draw = currentDrawId > 0n ? await manager.draws(currentDrawId).catch(() => null) : null
    const user = ethers.isAddress(targetAccount || '') ? targetAccount : ''
    const [principal, boosterPrincipal, balance, shmonShares] = user ? await Promise.all([
      vault.principalOf(user).catch(() => 0n),
      vault.boosterPrincipalOf(user).catch(() => null),
      readProvider.getBalance(user).catch(() => 0n),
      shmon.balanceOf(user).catch(() => 0n),
    ]) : [0n, 0n, 0n, 0n]
    const shmonBalance = shmonShares > 0n ? await shmon.convertToAssets(shmonShares).catch(() => 0n) : 0n
    const historyRows = await v5BuildHistoryRows({ account: user, block, vault, manager })
    const periodStart = Number(nextPeriodStart || 0n)
    const periodLogs = user && periodStart > 0 && block?.number ? await Promise.all([
      vault.queryFilter(vault.filters.Deposit(user), Math.max(0, Number(block.number) - 200000), block.number).catch(() => []),
      vault.queryFilter(vault.filters.Withdraw(user), Math.max(0, Number(block.number) - 200000), block.number).catch(() => []),
    ]).then(async ([deposits, withdrawals]) => {
      const logs = [
        ...deposits.map((log) => ({ log, type: 'deposit' })),
        ...withdrawals.map((log) => ({ log, type: 'withdraw' })),
      ]
      const blocks = new Map(await Promise.all([...new Set(logs.map((item) => item.log.blockNumber))].map(async (blockNumber) => [
        blockNumber,
        await readProvider.getBlock(blockNumber).catch(() => null),
      ])))
      return logs
        .map((item) => ({
          type: item.type,
          amount: item.log.args?.amount?.toString?.() || '0',
          blockNumber: item.log.blockNumber,
          transactionIndex: item.log.transactionIndex || 0,
          index: item.log.index || 0,
          timestamp: Number(blocks.get(item.log.blockNumber)?.timestamp || 0),
        }))
        .filter((item) => item.timestamp >= periodStart)
        .sort((a, b) => a.timestamp - b.timestamp || a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex || a.index - b.index)
    }) : []

    setState({
      block,
      currentDrawId,
      nextPeriodStart,
      drawPeriod,
      preview,
      draw,
      totalPrincipal,
      totalParticipantPrincipal,
      totalBoosterPrincipal,
      availableYield,
      paused,
      stoppedAt,
      principal,
      boosterPrincipal,
      balance,
      shmonBalance,
      shmonShares,
      historyRows,
      periodAccountEvents: periodLogs,
      readAtMs: Date.now(),
      boosterSupported: vaultCode !== '0x' && totalBoosterPrincipal !== null && boosterPrincipal !== null,
    })
  }, [account, cfg.prizeVault, manager, readProvider, shmon, vault])

  useEffect(() => {
    const id = setInterval(() => setLiveNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    trackPageView('/v5-uat', 'EverDraw V5 UAT')
    refresh().catch((err) => setError(err?.message || String(err)))
    const id = setInterval(() => refresh().catch(() => {}), 20_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const ac = new AbortController()
    if (!account) {
      setPointsProfile(null)
      setPointsHistory([])
      return () => ac.abort()
    }
    Promise.all([
      fetch(`${getIndexerBaseUrl()}/api/points/${account}`, { signal: ac.signal }).then((r) => r.ok ? r.json() : null),
      fetch(`${getIndexerBaseUrl()}/api/points/${account}/history?limit=12`, { signal: ac.signal }).then((r) => r.ok ? r.json() : []),
    ]).then(([profile, history]) => {
      assertNotAborted(ac.signal)
      setPointsProfile(profile)
      setPointsHistory(Array.isArray(history) ? history : [])
    }).catch((err) => {
      if (!isAbortError(err)) {
        setPointsProfile(null)
        setPointsHistory([])
      }
    })
    return () => ac.abort()
  }, [account])

  const connect = useCallback(async () => {
    setError('')
    await modal.open()
    const provider = getWalletProvider()
    if (!provider) return
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    await switchToV5Chain(provider, cfg.chainId, cfg.rpcUrl)
    const next = accounts?.[0] || ''
    setAccount(next)
    await refresh(next)
  }, [cfg.chainId, cfg.rpcUrl, refresh])

  const transact = useCallback(async (label, fn, options = {}) => {
    setBusy(label)
    setStatus('')
    setError('')
    try {
      const provider = getWalletProvider()
      if (!provider) throw new Error('Connect wallet first')
      await switchToV5Chain(provider, cfg.chainId, cfg.rpcUrl)
      const browserProvider = new ethers.BrowserProvider(provider)
      const signer = await browserProvider.getSigner()
      const tx = await fn(signer)
      options.afterSubmit?.()
      setStatus(`${label} submitted. Waiting for confirmation...`)
      const receipt = await tx.wait()
      const nextAccount = await signer.getAddress()
      setAccount(nextAccount)
      setStatus('')
      await refresh(nextAccount)
      await options.afterConfirm?.({ signer, account: nextAccount, receipt })
    } catch (err) {
      setError(err?.shortMessage || err?.message || String(err))
    } finally {
      setBusy('')
    }
  }, [cfg.chainId, cfg.rpcUrl, refresh])

  const claim = useCallback(async (signer) => {
    if (!cfg.claimProofUrl) throw new Error('Claim proof source is not configured yet for this UAT build.')
    const signerAccount = await signer.getAddress()
    const res = await fetch(v5ClaimUrl(cfg.claimProofUrl, signerAccount, cfg), { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`No claim found yet (${res.status})`)
    const payload = normalizeV5ClaimPayload(await res.json())
    if (!payload) throw new Error('No claimable prize found for this wallet yet.')
    const claims = new ethers.Contract(cfg.claimManager, V5_CLAIM_MANAGER_ABI, signer)
    return claims.claimMany(payload.leaves, payload.proofs)
  }, [cfg])

  const now = Number(state?.block?.timestamp || 0)
  const nextPeriodStart = Number(state?.nextPeriodStart || 0n)
  const drawPeriod = Number(state?.drawPeriod || 0n)
  const periodEnd = nextPeriodStart + drawPeriod
  const secondsRemaining = Math.max(0, periodEnd - now)
  const countdown = formatV5Duration(secondsRemaining)
  const previewCopy = state?.preview
    ? state.preview.due ? (state.preview.willSkip ? 'Next draw pending keeper' : 'Next draw ready for keeper') : 'Next draw building'
    : 'Keeper preview unavailable'
  const ticketModel = buildV5TicketModel({ state, account, nowMs: liveNowMs })
  const claimButton = () => transact('Claim prize', claim)
  const openVaultPage = (event) => {
    event?.preventDefault?.()
    setStatus('')
    setV5Page('vault')
  }
  const openDegenPage = (event) => {
    event?.preventDefault?.()
    setStatus('')
    setV5Page('degen')
  }
  const openProfilePage = (event) => {
    event?.preventDefault?.()
    setStatus('')
    setV5Page('profile')
  }
  const openPreviousRound = () => {
    setStatus('')
    setV5Page('previous')
  }
  const openHistoryPage = () => {
    setStatus('')
    setV5Page('history')
  }
  const afterPlayAction = async ({ account: nextAccount }) => {
    setPlayAmount('')
    const deposited = await vault.principalOf(nextAccount).catch(() => 0n)
    setPlayNotice(`Total currently deposited: ${formatV5Mon(deposited)} MON`)
  }
  const afterDegenAction = async ({ account: nextAccount }) => {
    setDegenAmount('')
    const deposited = await vault.boosterPrincipalOf(nextAccount).catch(() => 0n)
    setDegenNotice(`Total currently in Patron Pool: ${formatV5Mon(deposited)} MON`)
  }
  const clearPlayAmount = () => setPlayAmount('')
  const clearDegenAmount = () => setDegenAmount('')
  const depositV5Shmon = async (signer, amountValue, methodName) => {
    const assets = parseV5Mon(amountValue)
    const shmonWrite = new ethers.Contract(cfg.shmon, V5_SHMON_ABI, signer)
    const vaultWrite = new ethers.Contract(cfg.prizeVault, V5_VAULT_ABI, signer)
    const strategyAddress = await vaultWrite.strategy()
    const shares = await shmonWrite.previewDeposit(assets)
    if (shares <= 0n) throw new Error('shMON deposit amount is too small')
    setStatus('Approving shMON...')
    const approveTx = await shmonWrite.approve(strategyAddress, shares)
    await approveTx.wait()
    setStatus('Submitting shMON deposit...')
    return vaultWrite[methodName](shares)
  }
  const closeWithdrawFlow = () => {
    if (busy) return
    setWithdrawRequest(null)
    setWithdrawChoiceOpen(false)
    setWithdrawRedirectWarningOpen(false)
  }
  const beginWithdrawFlow = ({ kind, amountValue, principal, label, methodName, clearAmount, afterConfirm }) => {
    setError('')
    setStatus('')
    try {
      const amount = parseV5Mon(amountValue)
      if (amount > (principal || 0n)) throw new Error('Insufficient balance')
      setWithdrawRequest({
        kind,
        amount,
        amountValue,
        amountLabel: `${formatV5Mon(amount)} MON`,
        principal: principal || 0n,
        isFull: amount >= (principal || 0n),
        label,
        methodName,
        clearAmount,
        afterConfirm,
      })
      setWithdrawChoiceOpen(true)
    } catch (err) {
      setError(err?.shortMessage || err?.message || String(err))
    }
  }
  const withdrawToWallet = () => {
    const request = withdrawRequest
    if (!request) return
    return transact(request.label, (signer) => new ethers.Contract(cfg.prizeVault, V5_VAULT_ABI, signer)[request.methodName](request.amount), {
      afterSubmit: request.clearAmount,
      afterConfirm: async (ctx) => {
        setWithdrawChoiceOpen(false)
        setWithdrawRequest(null)
        await request.afterConfirm?.(ctx)
      },
    })
  }
  const withdrawAndConvert = () => {
    setWithdrawRedirectWarningOpen(true)
  }
  const confirmWithdrawAndConvert = () => {
    const request = withdrawRequest
    if (!request) return
    const shmonadWindow = window.open('about:blank', '_blank')
    try {
      if (shmonadWindow) {
        shmonadWindow.document.write('<!doctype html><title>Opening shmonad.xyz</title><body style="font-family:system-ui;background:#100d1e;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><main style="text-align:center"><h1>Redeeming…</h1><p>shmonad.xyz will open after your wallet confirms. Then click Unstake.</p></main></body>')
        shmonadWindow.document.close()
      }
    } catch {}
    const openShmonad = () => {
      try {
        if (shmonadWindow && !shmonadWindow.closed) {
          shmonadWindow.location.assign('https://shmonad.xyz')
          shmonadWindow.focus?.()
          return
        }
      } catch {}
      window.location.assign('https://shmonad.xyz')
    }
    return transact(request.label, (signer) => new ethers.Contract(cfg.prizeVault, V5_VAULT_ABI, signer)[request.methodName](request.amount), {
      afterSubmit: request.clearAmount,
      afterConfirm: async (ctx) => {
        setWithdrawChoiceOpen(false)
        setWithdrawRedirectWarningOpen(false)
        setWithdrawRequest(null)
        await request.afterConfirm?.(ctx)
        setStatus('Redeemed. Continue MON conversion in shmonad.xyz.')
        openShmonad()
      },
    })
  }
  const drawPayout = BigInt(state?.draw?.totalPayout ?? state?.draw?.[5] ?? 0n)
  const canClaimPrize = Boolean(account && cfg.claimProofUrl && drawPayout > 0n)

  return (
    <div className="app-shell v5-uat-mode">
      <div className="beta-corner-ribbon" title="Testnet UAT only"></div>
      <div className="app-container">
        <Header account={account} onConnect={connect} currentPage={v5Page === 'degen' ? 'degen' : v5Page === 'profile' ? 'profile' : 'vault'} points={pointsProfile} showDegen onDegenClick={openDegenPage} onVaultClick={openVaultPage} onProfileClick={openProfilePage} />
        <div className="v5-uat-strip">TESTNET / UAT</div>

        <h1>
          Win the Pot.
          <br />
          Or keep your lot.
        </h1>

        <section className="vault-bar">
          <button className={`vault-aux-btn ${v5Page === 'vault' ? 'active' : ''}`} onClick={openVaultPage}>Vault</button>
          <button className={`vault-aux-btn ${v5Page === 'previous' || v5Page === 'winners' ? 'active' : ''}`} onClick={openPreviousRound}>Previous Round</button>
          <button className={`vault-aux-btn ${v5Page === 'history' ? 'active' : ''}`} onClick={openHistoryPage}>My History</button>
        </section>

        {v5Page === 'degen' ? (
          <section className="main-grid v5-single-card-page">
            <V5ActionCard
              mode="degen"
              amount={degenAmount}
              setAmount={setDegenAmount}
              principal={state?.boosterPrincipal}
              walletBalance={state?.balance || 0n}
              shmonBalance={state?.shmonBalance || 0n}
              depositAsset={degenDepositAsset}
              setDepositAsset={setDegenDepositAsset}
              actionMode={degenActionMode}
              setActionMode={setDegenActionMode}
              notice={degenNotice}
              busy={busy}
              account={account}
              boosterSupported={Boolean(state?.boosterSupported)}
              onConnect={connect}
              onDeposit={() => transact('Patron Pool deposit', (signer) => (
                degenDepositAsset === 'shMON'
                  ? depositV5Shmon(signer, degenAmount, 'boostDepositShmon')
                  : new ethers.Contract(cfg.prizeVault, V5_VAULT_ABI, signer).boostDeposit({ value: parseV5Mon(degenAmount) })
              ), { afterSubmit: clearDegenAmount, afterConfirm: afterDegenAction })}
              onWithdraw={() => beginWithdrawFlow({
                kind: 'degen',
                amountValue: degenAmount,
                principal: state?.boosterPrincipal || 0n,
                label: 'Patron Pool withdraw',
                methodName: 'boostWithdrawShmon',
                clearAmount: clearDegenAmount,
                afterConfirm: afterDegenAction,
              })}
            />
            <section className="stats-grid two-col v5-degen-position">
              <StatCard label="Your current position" value={`${formatV5Mon(state?.boosterPrincipal || 0n)} MON`} sub="Patron Pool" icon={<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3l8 4v6c0 4.42-3.05 8.32-8 9-4.95-.68-8-4.58-8-9V7l8-4zm0 3.2L7 8.7V13c0 2.86 1.82 5.43 5 6.08 3.18-.65 5-3.22 5-6.08V8.7l-5-2.5z"/></svg>} />
            </section>
          </section>
        ) : v5Page === 'profile' ? (
          <ProfilePage account={account} points={pointsProfile} history={pointsHistory} />
        ) : v5Page === 'winners' ? (
          <V5PreviousRound
            state={state}
            onBack={openPreviousRound}
            onClaim={claimButton}
            canClaimPrize={canClaimPrize}
            busy={busy}
            status=""
            error=""
          />
        ) : v5Page === 'history' ? (
          <V5HistoryTable account={account} rows={state?.historyRows || []} />
        ) : (
        <>
        <section className="main-grid">
          <V5ActionCard
            mode="play"
            amount={playAmount}
            setAmount={setPlayAmount}
            principal={state?.principal || 0n}
            walletBalance={state?.balance || 0n}
            shmonBalance={state?.shmonBalance || 0n}
            depositAsset={playDepositAsset}
            setDepositAsset={setPlayDepositAsset}
            tickets={ticketModel}
            actionMode={playActionMode}
            setActionMode={setPlayActionMode}
            notice={playNotice}
            busy={busy}
            account={account}
            boosterSupported
            onConnect={connect}
            onDeposit={() => transact('Deposit', (signer) => (
              playDepositAsset === 'shMON'
                ? depositV5Shmon(signer, playAmount, 'depositShmon')
                : new ethers.Contract(cfg.prizeVault, V5_VAULT_ABI, signer).deposit({ value: parseV5Mon(playAmount) })
            ), { afterSubmit: clearPlayAmount, afterConfirm: afterPlayAction })}
            onWithdraw={() => beginWithdrawFlow({
              kind: 'vault',
              amountValue: playAmount,
              principal: state?.principal || 0n,
              label: 'Withdraw',
              methodName: 'withdrawShmon',
              clearAmount: clearPlayAmount,
              afterConfirm: afterPlayAction,
            })}
          />

          {v5Page === 'previous' ? (
            <VaultAnimationTest onComplete={() => setV5Page('winners')} />
          ) : (
            <div className="card filled vault-card v5-vault-stage" id="vault-card">
              <VaultDoorBackground progressPct={50} salesOpen={false} />
              <div className="v5-next-draw-overlay">
                <div className="card-header vault-layer">
                  <div className="card-title">Next prize draw</div>
                </div>
                <div className="countdown-center vault-layer vault-center">
                  <div className="countdown-value">{countdown}</div>
                  <div className="countdown-sub">{previewCopy}</div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="stats-grid two-col">
          <StatCard label="Total Entered" value={`${formatV5Mon(state?.totalParticipantPrincipal)} MON`} sub={`Draw #${state?.currentDrawId?.toString() || '0'}`} icon={<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2a2 2 0 0 0 0 4v2a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-2a2 2 0 0 0 0-4V7z"/></svg>} />
          <StatCard label="Total TVL" value={`${formatV5Mon(state?.totalPrincipal)} MON`} sub="SHMON Deposited" icon={<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>} />
          <StatCard label="Winner" value="—" sub="Revealed after draw" icon={<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h12v3a4 4 0 0 1-4 4h-1v2.08A4 4 0 0 1 16 17v2H8v-2a4 4 0 0 1 3-3.87V11h-1a4 4 0 0 1-4-4V4z"/></svg>} />
          <StatCard label="Total Prize Pool" value={`${formatV5Mon(state?.availableYield)} MON`} sub="Estimated current yield" icon={<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17h2.59l3.7-3.71 3 3L17.59 11H20v2h-1.59l-6.12 6.12-3-3L7 18.41V21H3v-4zM14 3h7v7h-2V6.41l-5.29 5.3-1.42-1.42 5.3-5.29H14V3z"/></svg>} />
        </section>

        </>
        )}

        {error && v5Page !== 'winners' ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{error}</p> : null}

        <ClaimFlowModal
          open={withdrawChoiceOpen}
          mode="principal"
          busy={Boolean(busy)}
          status={status}
          error={error}
          onClose={closeWithdrawFlow}
          onRedeemToWallet={withdrawToWallet}
          onRedeemAndConvert={withdrawAndConvert}
          onBackFromRedirectWarning={() => setWithdrawRedirectWarningOpen(false)}
          confirmRedirectOpen={withdrawRedirectWarningOpen}
          onConfirmRedirect={confirmWithdrawAndConvert}
          headerNotice="Withdrawing your deposits will impact your weekly streak"
        />

        <footer className="site-footer" id="disclaimer">
          <div className="disclaimer-box">
            <div className="disclaimer-title">Testnet UAT</div>
            <p>This isolated site is for EverDraw V5 user acceptance testing on Monad testnet. Use testnet funds only. Production everdraw.xyz and production Vercel envs are not used by this build.</p>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default function App() {
  initPosthog()

  // Hash-based page routing
  const [currentPage, setCurrentPage] = useState(() => {
    if (window.location.pathname === '/blog/drawn-back-to-defi' || window.location.pathname === '/articles/drawn-back-to-defi') return 'article'
    if (window.location.hash === '#stats') return 'stats'
    if (window.location.hash === '#shmon') return 'shmon'
    if (window.location.hash === '#profile') return 'profile'
    if (window.location.hash === '#leaderboard') return 'leaderboard'
    return 'vault'
  })
  useEffect(() => {
    function onHashChange() {
      if (window.location.pathname === '/blog/drawn-back-to-defi' || window.location.pathname === '/articles/drawn-back-to-defi') setCurrentPage('article')
      else if (window.location.hash === '#stats') setCurrentPage('stats')
      else if (window.location.hash === '#shmon') setCurrentPage('shmon')
      else if (window.location.hash === '#profile') setCurrentPage('profile')
      else if (window.location.hash === '#leaderboard') setCurrentPage('leaderboard')
      else setCurrentPage('vault')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    const pagePath = currentPage === 'vault'
      ? `${window.location.pathname || '/'}${window.location.hash || '#vault'}`
      : `${window.location.pathname || '/'}${window.location.hash || ''}`
    trackPageView(pagePath, `EverDraw - ${currentPage}`)
  }, [currentPage])

  const poolAddresses = useMemo(() => parsePoolAddresses(), [])
  const poolAddressesV2 = useMemo(() => parseV2PoolAddresses(), [])
  const poolAddressesV3 = useMemo(() => parseV3PoolAddresses(), [])
  const poolAddressesV4 = useMemo(() => parseV4PoolAddresses(), [])
  const activeVaultAddresses = useMemo(() => {
    const slots = [
      poolAddressesV4[0] || poolAddressesV3[0] || poolAddressesV2[0] || poolAddresses[0],
      poolAddressesV4[1] || poolAddressesV3[1] || poolAddressesV2[1] || poolAddresses[1],
    ].filter(Boolean)
    return [...new Set(slots.map((addr) => addr))]
  }, [poolAddresses, poolAddressesV2, poolAddressesV3, poolAddressesV4])
  const allPoolAddresses = useMemo(() => {
    const seen = new Set()
    return [...activeVaultAddresses, ...poolAddressesV4, ...poolAddressesV3, ...poolAddressesV2, ...poolAddresses].filter((addr) => {
      const lc = String(addr || '').toLowerCase()
      if (!lc || seen.has(lc)) return false
      seen.add(lc)
      return true
    })
  }, [activeVaultAddresses, poolAddresses, poolAddressesV2, poolAddressesV3, poolAddressesV4])
  const [selectedPoolAddress, setSelectedPoolAddress] = useState(activeVaultAddresses[0] || allPoolAddresses[0] || '')
  const poolAddress = selectedPoolAddress
  const isV2Pool = useMemo(() => poolAddressesV2.some((a) => a.toLowerCase() === String(poolAddress).toLowerCase()), [poolAddressesV2, poolAddress])
  const isV3Pool = useMemo(() => poolAddressesV3.some((a) => a.toLowerCase() === String(poolAddress).toLowerCase()), [poolAddressesV3, poolAddress])
  const isV4Pool = useMemo(() => poolAddressesV4.some((a) => a.toLowerCase() === String(poolAddress).toLowerCase()), [poolAddressesV4, poolAddress])
  const isV4Address = useCallback((addr) => {
    const lc = String(addr || '').toLowerCase()
    return poolAddressesV4.some((a) => a.toLowerCase() === lc)
  }, [poolAddressesV4])
  const usesSharePrizeAccounting = useCallback((addr) => {
    const lc = String(addr || '').toLowerCase()
    return poolAddressesV2.some((a) => a.toLowerCase() === lc) || poolAddressesV3.some((a) => a.toLowerCase() === lc) || poolAddressesV4.some((a) => a.toLowerCase() === lc)
  }, [poolAddressesV2, poolAddressesV3, poolAddressesV4])
  const getPoolAbi = useCallback((addr) => (
    isV4Address(addr) ? POOL_V4_ABI : usesSharePrizeAccounting(addr) ? POOL_V2_ABI : POOL_ABI
  ), [isV4Address, usesSharePrizeAccounting])
  const activePoolAbi = isV4Pool ? POOL_V4_ABI : isV2Pool || isV3Pool ? POOL_V2_ABI : POOL_ABI

  const expectedChainId = import.meta.env.VITE_CHAIN_ID ? Number(import.meta.env.VITE_CHAIN_ID) : 143
  const estimatedApyPercent = import.meta.env.VITE_ESTIMATED_APY_PERCENT ? Number(import.meta.env.VITE_ESTIMATED_APY_PERCENT) : 12
  const poolDeployBlock = import.meta.env.VITE_POOL_DEPLOY_BLOCK ? Number(import.meta.env.VITE_POOL_DEPLOY_BLOCK) : 0
  const configuredDepositWindowSec = import.meta.env.VITE_DEPOSIT_WINDOW_SEC ? Number(import.meta.env.VITE_DEPOSIT_WINDOW_SEC) : 0
  const deployBlockForPool = useCallback((addr) => {
    const lc = String(addr || '').toLowerCase()
    const v4Index = poolAddressesV4.findIndex((a) => a.toLowerCase() === lc)
    if (v4Index === 0 && import.meta.env.VITE_V4_A_DEPLOY_BLOCK) return Number(import.meta.env.VITE_V4_A_DEPLOY_BLOCK)
    if (v4Index === 1 && import.meta.env.VITE_V4_B_DEPLOY_BLOCK) return Number(import.meta.env.VITE_V4_B_DEPLOY_BLOCK)
    return poolDeployBlock
  }, [poolAddressesV4, poolDeployBlock])

  const hydrateV4RoundInfo = useCallback(async (pool, addr, rid, info, signal) => {
    if (!isV4Address(addr) || !info) return info
    const enriched = {
      ...info,
      winner: ethers.ZeroAddress,
      winningTicket: 0,
      winners: [],
      winningTickets: [],
      prizeShares: [],
      prizeClaimed: false,
    }
    try {
      const fromBlock = deployBlockForPool(addr)
      const logs = await _cached(
        `v4Winners:${addr}:${rid}`,
        10_000,
        () => pool.queryFilter(pool.filters.WinnersDrawn(BigInt(rid)), fromBlock || 0),
        signal,
      )
      const last = logs?.[logs.length - 1]
      const winners = Array.from(last?.args?.winners || [])
      const winningTickets = Array.from(last?.args?.winningTickets || [])
      const prizeShares = Array.from(last?.args?.prizeShares || [])
      enriched.winners = winners
      enriched.winningTickets = winningTickets
      enriched.prizeShares = prizeShares
      enriched.winner = winners[0] || ethers.ZeroAddress
      enriched.winningTicket = winningTickets[0] || 0
      if (prizeShares[0] != null) enriched.totalPrizeShares = prizeShares.reduce((acc, v) => acc + BigInt(v || 0n), 0n)
    } catch (err) {
      if (isAbortError(err)) throw err
    }
    return enriched
  }, [deployBlockForPool, isV4Address])

  const [account, setAccount] = useState('')
  const [balance, setBalance] = useState('0')
  const [ticketCountInput, setTicketCountInput] = useState('1')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [depositTotalLine, setDepositTotalLine] = useState(null)
  const [connectedChainId, setConnectedChainId] = useState(null)

  const [roundId, setRoundId] = useState('0')
  const [roundInfo, setRoundInfo] = useState(null)
  const [vaultPaused, setVaultPaused] = useState(false)
  const [nextAction, setNextAction] = useState(0)
  const [ticketPrice, setTicketPrice] = useState(0n)
  const [roundDuration, setRoundDuration] = useState(0)
  const [yieldPeriod, setYieldPeriod] = useState(0)
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  const [showWinnersView, setShowWinnersView] = useState(false)
  const [winnersTransitioning, setWinnersTransitioning] = useState(false)
  const [mainView, setMainView] = useState('vaultA')
  const [participants, setParticipants] = useState([])
  const [previousRoundId, setPreviousRoundId] = useState('0')
  const [previousRoundInfo, setPreviousRoundInfo] = useState(null)
  const [previousParticipants, setPreviousParticipants] = useState([])
  const participantsCacheRef = useRef(new Map())
  const [winnersUserPrincipalWei, setWinnersUserPrincipalWei] = useState(0n)
  const [claimFlow, setClaimFlow] = useState({ open: false, mode: 'winner', rid: null, poolAddr: '', principalWei: 0n, prizeWei: 0n, claimPrize: false, withdrawPrincipal: false })
  const [claimRedirectWarningOpen, setClaimRedirectWarningOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [withdrawingRid, setWithdrawingRid] = useState(null)
  const [actionStatus, setActionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const [myRounds, setMyRounds] = useState([])
  const [vaultSummaries, setVaultSummaries] = useState([])
  const [settledRoundId, setSettledRoundId] = useState('0')
  const [settledRoundInfo, setSettledRoundInfo] = useState(null)
  const [settledPoolAddress, setSettledPoolAddress] = useState('')
  const [settledParticipants, setSettledParticipants] = useState([])
  const participantLoadRef = useRef({ key: '' })
  const settledRidCacheRef = useRef(null)
  const [latestBlockNumber, setLatestBlockNumber] = useState(0)
  const [currentInternalEpoch, setCurrentInternalEpoch] = useState(0)
  const [shmonMonBalance, setShmonMonBalance] = useState(0n)
  const [commitAfterTime, setCommitAfterTime] = useState(0)
  const unlockAudioRef = useRef(null)
  const doorAudioRef = useRef(null)
  const [buyWithShmon, setBuyWithShmon] = useState(false)
  const [vaultBPending, setVaultBPending] = useState(false)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  const [pointsProfile, setPointsProfile] = useState(null)
  const [pointsHistory, setPointsHistory] = useState([])
  const [pointsBanner, setPointsBanner] = useState(null)

  useEffect(() => {
    if (!allPoolAddresses.length) {
      setSelectedPoolAddress('')
      return
    }
    if (!selectedPoolAddress || !allPoolAddresses.some((a) => a.toLowerCase() === selectedPoolAddress.toLowerCase())) {
      setSelectedPoolAddress(activeVaultAddresses[0] || allPoolAddresses[0])
    }
  }, [activeVaultAddresses, allPoolAddresses, selectedPoolAddress])

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


  useEffect(() => {
    const ac = new AbortController()
    if (!account) {
      setPointsProfile(null)
      setPointsHistory([])
      return () => ac.abort()
    }
    Promise.all([
      fetch(`${getIndexerBaseUrl()}/api/points/${account}`, { signal: ac.signal }).then((r) => r.ok ? r.json() : null),
      fetch(`${getIndexerBaseUrl()}/api/points/${account}/history?limit=12`, { signal: ac.signal }).then((r) => r.ok ? r.json() : []),
    ]).then(([profile, history]) => {
      assertNotAborted(ac.signal)
      setPointsProfile(profile)
      setPointsHistory(Array.isArray(history) ? history : [])
    }).catch((err) => {
      if (!isAbortError(err)) {
        setPointsProfile(null)
        setPointsHistory([])
      }
    })
    return () => ac.abort()
  }, [account])

  const refreshVaultSummaries = useCallback(async ({ signal } = {}) => {
    if (!allPoolAddresses.length) {
      setVaultSummaries([])
      return
    }
    const provider = await getReadProvider()
    const summaries = await Promise.all(allPoolAddresses.map(async (addr) => {
      try {
        assertNotAborted(signal)
        const v2 = poolAddressesV2.some((a) => a.toLowerCase() === addr.toLowerCase())
        const v4 = isV4Address(addr)
        const sharePrize = usesSharePrizeAccounting(addr)
        const abi = getPoolAbi(addr)
        const pool = new ethers.Contract(addr, abi, provider)
        const rid = await _cached(`currentRound:${addr}`, 10_000, () => pool.currentRoundId(), signal)
        const info = await hydrateV4RoundInfo(pool, addr, rid, await getCachedRoundInfo(pool, addr, rid, signal), signal)
        const state = Number(info.state)
        const salesEndTime = Number(info.salesEndTime)
        const nowSec = Math.floor(Date.now() / 1000)
        const commitAfter = sharePrize ? Number(await _cached(`commitAfter:${addr}:${rid}`, 5_000, () => pool.getCommitAfterTime(rid).catch(() => 0), signal)) : 0
        const secs = Math.max(0, salesEndTime - nowSec)
        const yieldSecs = Math.max(0, commitAfter - nowSec)
        const stateLabel = v2 && state === 0 && secs === 0
          ? (Number(info.totalTickets ?? 0) > 0
              ? (yieldSecs > 0 ? 'Yield Accruing' : 'Drawing Queued')
              : 'Round Skipped')
          : (v2 ? STATE_LABELS_V2 : STATE_LABELS)[state] ?? 'Unknown'
        return {
          poolAddress: addr,
          roundId: rid.toString(),
          state,
          stateLabel,
          isNowOpen: state === 0 && secs > 0,
          timeRemainingSec: v2 && state === 0 && secs === 0 ? yieldSecs : secs,
          commitAfterTime: commitAfter,
          totalTickets: Number(info.totalTickets ?? 0),
          tvlMon: Number(ethers.formatEther(v4 ? info.totalPrincipalAsset ?? 0n : info.totalPrincipalMON ?? 0n)).toFixed(4),
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
      if (isSettledState(v.state, poolAddressesV2.some((a) => a.toLowerCase() === String(v.poolAddress).toLowerCase()))) return 2
      return 3
    }

    summaries.sort((a, b) => {
      const s = score(a) - score(b)
      if (s !== 0) return s
      const t = a.timeRemainingSec - b.timeRemainingSec
      if (t !== 0) return t
      return a.poolAddress.localeCompare(b.poolAddress)
    })

    assertNotAborted(signal)
    setVaultSummaries(summaries)
  }, [allPoolAddresses, poolAddressesV2, usesSharePrizeAccounting, getPoolAbi, isV4Address, hydrateV4RoundInfo])

  const refresh = useCallback(async ({ signal } = {}) => {
    if (!poolAddress) return
    if (!ethers.isAddress(poolAddress)) {
      throw new Error('Invalid VITE_POOL_ADDRESS. Use a 0x... contract address.')
    }
    const provider = await getReadProvider()
    assertNotAborted(signal)
    const pool = new ethers.Contract(poolAddress, activePoolAbi, provider)

    const [
      rid,
      nextExecutable,
      price,
      duration,
      yieldDur,
      latestBlock,
      network,
      shmonAddr,
      accountBalance,
      pausedFlag,
    ] = await Promise.all([
      _cached(`currentRound:${poolAddress}`, 10_000, () => pool.currentRoundId(), signal),
      _cached(`nextExecutable:${poolAddress}`, 5_000, () => pool.nextExecutable(), signal),
      _cached(`ticketPrice:${poolAddress}:${isV4Pool ? 'asset' : 'mon'}`, 86400_000 * 365, () => isV4Pool ? pool.ticketPriceAsset() : pool.ticketPriceMON(), signal),
      _cached(`deposit:${poolAddress}`, 86400_000 * 365, () => isV2Pool || isV3Pool || isV4Pool ? pool.roundDurationSec() : pool.depositPeriodSec(), signal),
      _cached(`yieldPeriod:${poolAddress}`, 86400_000 * 365, () => isV2Pool ? pool.yieldPeriodSec().catch(() => 0) : pool.yieldPeriodSec(), signal),
      _cached('provider:blockNumber', 2_000, () => provider.getBlockNumber(), signal),
      _cached('provider:network', 60_000, () => provider.getNetwork(), signal),
      _cached(`shmon:${poolAddress}`, 86400_000 * 365, () => isV4Pool ? pool.yieldVault().catch(() => ethers.ZeroAddress) : pool.shmon().catch(() => ethers.ZeroAddress), signal),
      account ? _cached(`balance:${account}`, 5_000, () => provider.getBalance(account).catch(() => null), signal) : Promise.resolve(null),
      isV4Pool ? _cached(`paused:${poolAddress}`, 5_000, () => pool.paused().catch(() => false), signal) : Promise.resolve(false),
    ])

    const info = await hydrateV4RoundInfo(pool, poolAddress, rid, await getCachedRoundInfo(pool, poolAddress, rid, signal), signal)

    assertNotAborted(signal)
    setRoundId(rid.toString())
    setRoundInfo(info)
    setVaultPaused(Boolean(pausedFlag))
    setNextAction(Number(nextExecutable?.[1] ?? 0))
    setTicketPrice(price)
    setRoundDuration(Number(duration))
    setYieldPeriod(Number(yieldDur || 0))
    setLatestBlockNumber(Number(latestBlock))
    setConnectedChainId(Number(network.chainId))

    if (accountBalance != null) {
      setBalance(ethers.formatEther(accountBalance))
    }

    try {
      if (ethers.isAddress(shmonAddr) && shmonAddr !== ethers.ZeroAddress) {
        const shmon = new ethers.Contract(shmonAddr, SHMON_READ_ABI, provider)
        const [ep, shmonBal] = await Promise.all([
          _cached(`shmonEpoch:${shmonAddr}`, 5_000, () => shmon.getInternalEpoch(), signal),
          account ? _cached(`shmonBalance:${account}:${shmonAddr}`, 5_000, () => shmon.balanceOf(account).catch(() => 0n), signal) : Promise.resolve(0n),
        ])
        assertNotAborted(signal)
        setCurrentInternalEpoch(Number(ep))
        if (account) {
          const monBal = shmonBal > 0n ? await _cached(`shmonMonBal:${account}:${shmonAddr}`, 15_000, () => shmon.convertToAssets(shmonBal), signal) : 0n
          setShmonMonBalance(monBal)
        }
      }
    } catch {
      // Keep fallback timers if epoch endpoint is unavailable.
    }

    if (isV2Pool || isV3Pool || isV4Pool) {
      const commitAt = Number(await _cached(`commitAfter:${poolAddress}:${rid}`, 5_000, () => pool.getCommitAfterTime(rid).catch(() => 0), signal))
      assertNotAborted(signal)
      setCommitAfterTime(commitAt)
    } else {
      setCommitAfterTime(0)
    }

    if (Number(rid) > 0) {
      const prevRid = Number(rid) - 1
      const prevInfo = await hydrateV4RoundInfo(pool, poolAddress, BigInt(prevRid), await getCachedRoundInfo(pool, poolAddress, BigInt(prevRid), signal), signal)
      assertNotAborted(signal)
      setPreviousRoundId(String(prevRid))
      setPreviousRoundInfo(prevInfo)
    } else {
      setPreviousRoundId('0')
      setPreviousRoundInfo(null)
      setPreviousParticipants([])
    }

    let bestSettled = null
    const scanPools = allPoolAddresses.length ? allPoolAddresses : [poolAddress]
    for (const scanAddr of scanPools) {
      try {
        if (!ethers.isAddress(scanAddr)) continue
        const scanIsV2 = poolAddressesV2.some((a) => a.toLowerCase() === scanAddr.toLowerCase())
        const scanAbi = getPoolAbi(scanAddr)
        const scanPool = new ethers.Contract(scanAddr, scanAbi, provider)
        const scanCurrentRid = Number(await _cached(`currentRound:${scanAddr}`, 10_000, () => scanPool.currentRoundId(), signal))
        const scanRids = []
        for (let r = scanCurrentRid; r >= Math.max(1, scanCurrentRid - 5); r--) scanRids.push(r)
        const results = await Promise.all(scanRids.map((r) => getCachedRoundInfo(scanPool, scanAddr, BigInt(r), signal).then((info) => hydrateV4RoundInfo(scanPool, scanAddr, BigInt(r), info, signal)).catch(() => null)))
        for (let i = 0; i < results.length; i++) {
          const si = results[i]
          if (!si) continue
          const hasActivity = Number(si.totalTickets ?? 0) > 0 || roundPrincipalWei(si) > 0n
          if (isTerminalRound(si.state, scanIsV2) && hasActivity) {
            const candidate = {
              poolAddr: scanAddr,
              rid: scanRids[i],
              info: si,
              sortTime: Number(si.salesEndTime ?? 0),
            }
            if (!bestSettled || candidate.sortTime > bestSettled.sortTime) bestSettled = candidate
            break
          }
        }
      } catch (err) {
        if (isAbortError(err)) throw err
      }
    }
    assertNotAborted(signal)
    if (bestSettled) {
      settledRidCacheRef.current = bestSettled.rid
      setSettledRoundId(String(bestSettled.rid))
      setSettledRoundInfo(bestSettled.info)
      setSettledPoolAddress(bestSettled.poolAddr)
    } else {
      setSettledRoundId('0')
      setSettledRoundInfo(null)
      setSettledPoolAddress('')
      setSettledParticipants([])
    }
  }, [account, poolAddress, activePoolAbi, isV2Pool, isV3Pool, isV4Pool, allPoolAddresses, poolAddressesV2, getPoolAbi, hydrateV4RoundInfo])

  useEffect(() => {
    if (!poolAddress) return
    const ac = new AbortController()
    refresh({ signal: ac.signal }).catch((e) => { if (!isAbortError(e)) setError(normalizeError(e) || 'Failed to load round data') })
    refreshVaultSummaries({ signal: ac.signal }).catch(() => {})

    const clockTick = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)

    const dataRefresh = setInterval(() => {
      refresh({ signal: ac.signal }).catch(() => {})
    }, 60000)

    const vaultRefresh = setInterval(() => {
      refreshVaultSummaries({ signal: ac.signal }).catch(() => {})
    }, 120000)

    return () => {
      ac.abort()
      clearInterval(clockTick)
      clearInterval(dataRefresh)
      clearInterval(vaultRefresh)
    }
  }, [poolAddress, refresh, refreshVaultSummaries])

  const loadParticipantsForView = useCallback(async (view, { signal } = {}) => {
    const currentRidNum = Number(roundId) || 0
    const prevRidNum = Number(previousRoundId) || 0
    const vaultARoundIdNum = currentRidNum % 2 === 1 ? currentRidNum : prevRidNum
    const vaultBRoundIdNum = currentRidNum % 2 === 0 ? currentRidNum : prevRidNum

    let targetRoundId = 0
    let targetPoolAddress = ''
    let setter = null

    if (view === 'current') {
      targetRoundId = currentRidNum
      targetPoolAddress = poolAddress
      setter = setParticipants
    } else if (view === 'vaultA') {
      targetRoundId = vaultARoundIdNum
      targetPoolAddress = activeVaultAddresses[0] || poolAddress
      setter = setParticipants
    } else if (view === 'vaultB') {
      targetRoundId = vaultBRoundIdNum
      targetPoolAddress = activeVaultAddresses[1] || poolAddress
      setter = setPreviousParticipants
    } else if (view === 'previous') {
      targetRoundId = Number(settledRoundId) || 0
      targetPoolAddress = settledPoolAddress || poolAddress
      setter = setSettledParticipants
    } else {
      return
    }

    if (!targetRoundId || !ethers.isAddress(targetPoolAddress)) {
      setter?.([])
      return
    }

    try {
      const url = new URL(`https://everdraw-indexer.fly.dev/api/rounds/${targetRoundId}/participants`)
      url.searchParams.set('pool', targetPoolAddress)
      const res = await fetch(url.toString(), { signal })
      if (!res.ok) {
        console.warn('[EverDraw] indexer participants fetch failed:', res.status)
        setter([])
        return
      }
      const data = await res.json()
      const byWallet = new Map()
      for (const p of Array.isArray(data) ? data : []) {
        if (p.poolAddress && String(p.poolAddress).toLowerCase() !== targetPoolAddress.toLowerCase()) continue
        const wallet = p.wallet || p.buyer || p.address
        const tickets = Number(p.tickets ?? p.ticketCount ?? 0) || 0
        if (!wallet || !ethers.isAddress(wallet) || tickets <= 0) continue
        const key = wallet.toLowerCase()
        const prev = byWallet.get(key) || { wallet, tickets: 0, depositedWei: 0n }
        prev.tickets += tickets
        prev.depositedWei += BigInt(p.assetPaid || p.monPaid || p.depositedWei || p.deposited_mon_wei || '0')
        byWallet.set(key, prev)
      }
      const totalTicketsNum = [...byWallet.values()].reduce((acc, p) => acc + p.tickets, 0)
      const built = [...byWallet.values()].map((p) => ({
        wallet: p.wallet,
        walletShort: shortAddr(p.wallet),
        tickets: p.tickets,
        sharePct: totalTicketsNum > 0 ? ((p.tickets / totalTicketsNum) * 100).toFixed(2) : '0.00',
        depositedMon: Number(ethers.formatEther(p.depositedWei)).toFixed(4),
      })).sort((a, b) => b.tickets - a.tickets || a.wallet.localeCompare(b.wallet))
      assertNotAborted(signal)
      setter(built)
    } catch (e) {
      if (!isAbortError(e)) {
        console.warn('[EverDraw] indexer participants fetch error:', e)
        setter([])
      }
    }
  }, [activeVaultAddresses, poolAddress, previousRoundId, roundId, settledPoolAddress, settledRoundId])

  useEffect(() => {
    if (mainView === 'myrounds') return
    const ac = new AbortController()
    loadParticipantsForView(mainView, { signal: ac.signal }).catch((err) => { if (!isAbortError(err)) console.warn('[EverDraw] participants load failed:', err) })
    return () => ac.abort()
  }, [mainView, loadParticipantsForView])

  const connectWallet = useCallback(async () => {
    try {
      await modal.open()
    } catch (e) {
      setError(normalizeError(e) || 'Wallet connection failed')
    }
  }, [])

  // Reactively handle wallet connect/disconnect via web3modal
  useEffect(() => {
    const unsubscribe = modal.subscribeProvider(async (state) => {
      if (!state.isConnected || !state.provider) {
        setAccount('')
        setBalance('0')
        setConnectedChainId(null)
        return
      }
      try {
        const provider = new ethers.BrowserProvider(state.provider)
        await ensureCorrectNetwork(provider, expectedChainId)
        const signer = await provider.getSigner()
        const addr = await signer.getAddress()
        setAccount(addr)
        const bal = await provider.getBalance(addr)
        setBalance(ethers.formatEther(bal))
        const network = await provider.getNetwork()
        setConnectedChainId(Number(network.chainId))
        trackEvent('wallet_connect_success', {
          chain_id: Number(network.chainId),
        })
        setError('')
      } catch (e) {
        const msg = normalizeError(e)
        if (msg) trackEvent('wallet_connect_error', { reason: msg })
        if (msg) setError(msg)
      }
    })
    return unsubscribe
  }, [expectedChainId])

  // Handle account/chain changes from injected wallet (MetaMask, Rabby, etc.)
  useEffect(() => {
    const provider = getWalletProvider()
    if (!provider) return

    const onAccountsChanged = (accounts) => {
      setAccount(accounts?.[0] ?? '')
    }

    const onChainChanged = (chainHex) => {
      setConnectedChainId(hexChainIdToDec(chainHex))
    }

    provider.on('accountsChanged', onAccountsChanged)
    provider.on('chainChanged', onChainChanged)

    return () => {
      provider.removeListener('accountsChanged', onAccountsChanged)
      provider.removeListener('chainChanged', onChainChanged)
    }
  }, [])

  const activeCurrentWalletTickets = useMemo(() => {
    if (!account) return 0
    const row = participants.find((p) => String(p.wallet || '').toLowerCase() === account.toLowerCase())
    return Math.max(0, Number(row?.tickets || 0))
  }, [account, participants])
  const activeRemainingTicketAllowance = Math.max(0, FRONTEND_TICKET_CAP - activeCurrentWalletTickets)
  const activeBuyVaultLabel = selectedPoolAddress.toLowerCase() === activeVaultAddresses[1]?.toLowerCase() || vaultBPending ? 'Vault B' : 'Vault A'

  useEffect(() => {
    setDepositTotalLine(null)
  }, [account, poolAddress, roundId])

  const readUserRoundDepositWei = useCallback(async ({
    targetAccount = account,
    targetPoolAddress = poolAddress,
    targetRoundId = roundId,
  } = {}) => {
    if (!targetAccount || !ethers.isAddress(targetAccount) || !targetPoolAddress || !ethers.isAddress(targetPoolAddress) || !targetRoundId) return 0n

    const provider = await getReadProvider()
    const pool = new ethers.Contract(targetPoolAddress, activePoolAbi, provider)

    try {
      const position = await pool.getUserPosition(BigInt(targetRoundId), targetAccount)
      return BigInt(position?.[0] ?? 0n)
    } catch {
      try {
        return BigInt(await pool.principalMON(BigInt(targetRoundId), targetAccount))
      } catch {
        return 0n
      }
    }
  }, [account, activePoolAbi, poolAddress, roundId])

  const pollUserDepositTotal = useCallback(async ({
    expectedMinWei = 0n,
    targetAccount = account,
    targetPoolAddress = poolAddress,
    targetRoundId = roundId,
  } = {}) => {
    const context = {
      account: targetAccount,
      poolAddress: targetPoolAddress,
      roundId: String(targetRoundId || ''),
    }
    setDepositTotalLine({ ...context, text: 'updating your deposit total...' })
    await delay(1500)

    let lastTotal = 0n
    for (let attempt = 0; attempt < 6; attempt += 1) {
      lastTotal = await readUserRoundDepositWei({ targetAccount, targetPoolAddress, targetRoundId })
      if (lastTotal > 0n && (!expectedMinWei || lastTotal >= expectedMinWei)) {
        setDepositTotalLine({
          ...context,
          text: `you have deposited ${formatDepositMon(lastTotal)} MON this round`,
        })
        return lastTotal
      }
      await delay(700)
    }

    setDepositTotalLine({
      ...context,
      text: lastTotal > 0n
        ? `you have deposited ${formatDepositMon(lastTotal)} MON this round`
        : 'deposit submitted. total update delayed.',
    })
    return lastTotal
  }, [account, poolAddress, readUserRoundDepositWei, roundId])

  const buyTickets = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setStatus('Preparing transaction...')

      if (!poolAddress) throw new Error('Missing VITE_POOL_ADDRESS in web/.env')
      const walletProvider = await getDepositWalletProvider(account)
      if (!walletProvider) throw new Error('Wallet required for buyTickets')

      const n = Number(ticketCountInput)
      if (!Number.isInteger(n) || n <= 0) throw new Error('Ticket count must be a positive integer')
      if (n > activeRemainingTicketAllowance) {
        trackEvent('deposit_cap_hit', {
          vault: activeBuyVaultLabel,
          requested_tickets: n,
          remaining_tickets: activeRemainingTicketAllowance,
          cap_tickets: FRONTEND_TICKET_CAP,
          entry_mode: 'mon',
        })
        throw new Error(`limit reached. remaining tickets you can purchase is ${formatWholeNumber(activeRemainingTicketAllowance)}`)
      }

      const provider = new ethers.BrowserProvider(walletProvider)
      await provider.send('eth_requestAccounts', [])
      await ensureCorrectNetwork(provider, expectedChainId)
      if (!account) throw new Error('No wallet connected')

      const currentSalesOpen = roundInfo && Number(roundInfo.state) === 0 && Math.max(0, Number(roundInfo.salesEndTime ?? 0) - Math.floor(Date.now() / 1000)) > 0
      if (!currentSalesOpen) throw new Error('Deposits are closed for this round')

      const value = ticketPrice * BigInt(n)
      if (value === 0n) throw new Error('Ticket price not loaded yet — please wait a moment and try again')

      const readProvider = await getReadProvider()
      const nativeBalance = await readProvider.getBalance(account)
      if (nativeBalance < value) {
        throw new Error(`Insufficient MON balance: need ${ethers.formatEther(value)} MON plus gas, wallet has ${Number(ethers.formatEther(nativeBalance)).toFixed(4)} MON`)
      }
      const feeData = await readProvider.getFeeData()
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas
      if (!gasPrice) throw new Error('Gas price not available — please try again in a moment')
      const gasReserve = 650000n * gasPrice
      if (nativeBalance < value + gasReserve) {
        throw new Error(`Insufficient MON for deposit gas: need about ${Number(ethers.formatEther(value + gasReserve)).toFixed(4)} MON total, wallet has ${Number(ethers.formatEther(nativeBalance)).toFixed(4)} MON`)
      }
      const targetRoundId = roundId
      const previousDepositWei = await readUserRoundDepositWei({ targetRoundId }).catch(() => 0n)
      const expectedDepositWei = previousDepositWei + value

      const callData = new ethers.Interface(activePoolAbi).encodeFunctionData(
        isV2Pool && !isV4Pool ? 'buyTicketsMON' : 'buyTickets',
        [n]
      )
      trackEvent('deposit_start', {
        vault: activeBuyVaultLabel,
        ticket_count: n,
        entry_mode: 'mon',
      })

      setStatus('Estimating gas...')
      try {
        await readProvider.estimateGas({ from: account, to: poolAddress, data: callData, value })
      } catch (estErr) {
        const reason = estErr?.reason || estErr?.shortMessage || estErr?.message || 'unknown'
        throw new Error(`Transaction would fail: ${reason}`)
      }

      setStatus('Waiting for wallet confirmation...')
      const txHash = await provider.send('eth_sendTransaction', [{
        from: account,
        to: poolAddress,
        data: callData,
        value: ethers.toBeHex(value),
      }])

      setTicketCountInput('')
      pollUserDepositTotal({ expectedMinWei: expectedDepositWei, targetRoundId }).catch(() => {
        setDepositTotalLine({
          account,
          poolAddress,
          roundId: String(targetRoundId || ''),
          text: 'deposit submitted. total update delayed.',
        })
      })
      setStatus(`Submitted: ${String(txHash).slice(0, 10)}... waiting for confirmation...`)
      await readProvider.waitForTransaction(txHash)
      setStatus('Buy successful')
      trackEvent('deposit_success', {
        vault: activeBuyVaultLabel,
        ticket_count: n,
        entry_mode: 'mon',
      })
      setLoading(false)
      refresh().catch(() => {})
      return
    } catch (e) {
      setStatus('')
      trackEvent('deposit_error', {
        vault: activeBuyVaultLabel,
        reason: normalizeError(e) || 'unknown',
        entry_mode: 'mon',
      })
      setError(normalizeError(e) || 'buyTickets failed')
    } finally {
      setLoading(false)
    }
  }, [account, expectedChainId, poolAddress, pollUserDepositTotal, readUserRoundDepositWei, refresh, roundId, ticketCountInput, ticketPrice, activePoolAbi, isV2Pool, isV4Pool, roundInfo, activeRemainingTicketAllowance, activeBuyVaultLabel])

  const secondsRemaining = useMemo(() => {
    if (!roundInfo) return 0
    return Math.max(0, Number(roundInfo.salesEndTime) - now)
  }, [now, roundInfo])

  const depositWindowSec = useMemo(() => {
    const contractDepositWindowSec = Number(roundDuration || 0)
    const fallbackDepositWindowSec = Math.min(86400, Math.max(0, configuredDepositWindowSec || 0))
    return Math.max(contractDepositWindowSec, fallbackDepositWindowSec)
  }, [roundDuration, configuredDepositWindowSec])

  const progressPct = useMemo(() => {
    if (!depositWindowSec || !roundInfo) return 0
    const elapsed = Math.max(0, depositWindowSec - secondsRemaining)
    return Math.min(100, Math.round((elapsed / depositWindowSec) * 100))
  }, [depositWindowSec, secondsRemaining, roundInfo])

  const poolDisplayLabel = useCallback((addr, isV2 = false) => {
    const lc = String(addr || '').toLowerCase()
    const v4Index = poolAddressesV4.findIndex((a) => a.toLowerCase() === lc)
    if (v4Index >= 0) return `Vault ${labelLetter(v4Index)}`
    const v2Index = poolAddressesV2.findIndex((a) => a.toLowerCase() === lc)
    if (v2Index >= 0) {
      const letter = labelLetter(v2Index)
      if (v2Index === 0 && poolAddressesV3[0]) return `Retired Vault ${letter}`
      if (v2Index === 1 && poolAddressesV3[1]) return `Retired Vault ${letter}`
      return isActiveV2PoolIndex(v2Index) ? `Vault ${letter}` : `Retired Vault ${letter}`
    }
    const legacyIndex = poolAddresses.findIndex((a) => a.toLowerCase() === lc)
    if (legacyIndex >= 0) return `Legacy Vault ${labelLetter(legacyIndex)}`
    return isV2 ? `Vault ${shortAddr(addr)}` : `Legacy ${shortAddr(addr)}`
  }, [poolAddresses, poolAddressesV2, poolAddressesV3, poolAddressesV4])

  const currentState = roundInfo ? Number(roundInfo.state) : null
  const isOpenState = currentState === 0
  const usesSeparateVaultAddresses = isV2Pool || isV3Pool || isV4Pool

  // Vault A = odd rounds, Vault B = even rounds
  const currentRidNum = Number(roundId) || 0
  const vaultARoundId = currentRidNum % 2 === 1 ? roundId : previousRoundId
  const vaultARoundInfo = currentRidNum % 2 === 1 ? roundInfo : previousRoundInfo
  const vaultAParticipants = currentRidNum % 2 === 1 ? participants : previousParticipants
  const vaultBRoundId = currentRidNum % 2 === 0 ? roundId : previousRoundId
  const vaultBRoundInfo = currentRidNum % 2 === 0 ? roundInfo : previousRoundInfo
  const vaultBParticipants = currentRidNum % 2 === 0 ? participants : previousParticipants

  const shownRoundId = usesSeparateVaultAddresses
    ? (mainView === 'previous' ? settledRoundId : roundId)
    : mainView === 'vaultA' ? vaultARoundId
      : mainView === 'vaultB' ? vaultBRoundId
      : mainView === 'previous' ? settledRoundId
      : roundId
  const shownRoundInfo = usesSeparateVaultAddresses
    ? (mainView === 'previous' ? settledRoundInfo : roundInfo)
    : mainView === 'vaultA' ? vaultARoundInfo
      : mainView === 'vaultB' ? vaultBRoundInfo
      : mainView === 'previous' ? settledRoundInfo
      : roundInfo
  const shownParticipants = usesSeparateVaultAddresses
    ? (mainView === 'previous' ? settledParticipants : participants)
    : mainView === 'vaultA' ? vaultAParticipants
      : mainView === 'vaultB' ? vaultBParticipants
      : mainView === 'previous' ? settledParticipants
      : participants
  const shownIsCurrentRound = mainView !== 'previous' && shownRoundId === roundId
  const shownState = shownRoundInfo ? Number(shownRoundInfo.state) : -1
  const shownPoolAddress = mainView === 'previous' && settledPoolAddress ? settledPoolAddress : poolAddress
  const shownUsesSharePrizeAccounting = usesSharePrizeAccounting(shownPoolAddress)
  const shownVaultLabel = mainView === 'previous'
    ? poolDisplayLabel(settledPoolAddress, poolAddressesV2.some((a) => a.toLowerCase() === String(settledPoolAddress).toLowerCase()))
    : usesSeparateVaultAddresses
      ? (selectedPoolAddress.toLowerCase() === activeVaultAddresses[1]?.toLowerCase() || vaultBPending ? 'Vault B' : 'Vault A')
      : mainView === 'vaultA' ? 'Vault A' : mainView === 'vaultB' ? 'Vault B' : 'Previous Vault'
  const wrongNetwork = expectedChainId && connectedChainId && expectedChainId !== connectedChainId
  const shownSecondsRemaining = shownRoundInfo ? Math.max(0, Number(shownRoundInfo.salesEndTime ?? 0) - now) : 0
  const shownCommitAfterRemaining = shownRoundInfo && (isV2Pool || isV3Pool || isV4Pool) ? Math.max(0, Number(commitAfterTime || 0) - now) : 0
  const shownSalesOpen = shownState === 0 && shownSecondsRemaining > 0
  const shownHasActivity = Number(shownRoundInfo?.totalTickets ?? 0) > 0 || roundPrincipalWei(shownRoundInfo) > 0n
  const shownEmptyClosedRound = (isV2Pool || isV4Pool) && shownState === 0 && shownSecondsRemaining === 0 && !shownHasActivity
  const shownYieldAccruing = (isV2Pool || isV4Pool) && shownState === 0 && shownSecondsRemaining === 0 && shownCommitAfterRemaining > 0 && shownHasActivity
  const shownSettled = isTerminalRound(shownState, isV2Pool)
  const salesOpen = shownIsCurrentRound ? shownSalesOpen : isOpenState && secondsRemaining > 0
  const buyFormOpen = shownIsCurrentRound && shownSalesOpen && !vaultPaused
  const canBuyTx = !!account && buyFormOpen && !loading
  const currentWalletTickets = useMemo(() => {
    if (!account || !shownIsCurrentRound) return 0
    const row = shownParticipants.find((p) => String(p.wallet || '').toLowerCase() === account.toLowerCase())
    return Math.max(0, Number(row?.tickets || 0))
  }, [account, shownIsCurrentRound, shownParticipants])
  const remainingTicketAllowance = Math.max(0, FRONTEND_TICKET_CAP - currentWalletTickets)
  const requestedTicketCount = Number(ticketCountInput)
  const ticketLimitExceeded = !!account &&
    buyFormOpen &&
    Number.isInteger(requestedTicketCount) &&
    requestedTicketCount > remainingTicketAllowance
  const ticketLimitMessage = ticketLimitExceeded
    ? `limit reached. remaining tickets you can purchase is ${formatWholeNumber(remainingTicketAllowance)}`
    : ''

  const buyDisabledReason = useMemo(() => {
    if (loading) return 'Transaction in progress'
    if (vaultPaused && shownIsCurrentRound) return 'Vault is temporarily closed'
    if (!shownIsCurrentRound) return 'Deposits are only available in the active vault'
    if (!shownSalesOpen) {
      if (shownYieldAccruing) return 'Yield accruing'
      if (shownState !== 0) return 'Sales not open in this vault state'
      return 'Deposits are closed for this round'
    }
    if (!account) return 'Connect wallet to deposit'
    if (wrongNetwork) return 'Wrong network — click Buy to switch automatically'
    return ''
  }, [loading, vaultPaused, shownIsCurrentRound, shownSalesOpen, shownYieldAccruing, shownState, account, wrongNetwork])

  useEffect(() => {
    if (!buyFormOpen && /missing revert data|SalesEnded|sales ended/i.test(error || '')) setError('')
  }, [buyFormOpen, error])

  const settlementSecondsRemaining = useMemo(() => {
    if (!roundInfo) return 0
    const state = Number(roundInfo.state ?? -1)
    const targetBlock = Number(roundInfo.targetBlockNumber ?? 0)
    if (!targetBlock || !latestBlockNumber) return 0
    const blocksLeft = Math.max(0, targetBlock - latestBlockNumber)
    const BLOCK_TIME_SEC = 0.4

    if (isV2Pool) {
      if (state !== 1) return 0
      return Math.ceil(blocksLeft * BLOCK_TIME_SEC)
    }

    if (state === 1) {
      return Math.ceil(blocksLeft * BLOCK_TIME_SEC)
    }

    if (state !== 2) return 0

    const completionEpoch = Number(roundInfo.unstakeCompletionEpoch ?? 0)
    if (completionEpoch > 0 && currentInternalEpoch > 0 && latestBlockNumber > 0) {
      const EPOCH_LENGTH = 50_000
      const epochsLeft = completionEpoch - currentInternalEpoch
      if (epochsLeft <= 0) return 0

      const blocksIntoEpoch = latestBlockNumber % EPOCH_LENGTH
      const blocksRemaining =
        (EPOCH_LENGTH - blocksIntoEpoch) + (epochsLeft - 1) * EPOCH_LENGTH

      return Math.max(0, Math.ceil(blocksRemaining * BLOCK_TIME_SEC))
    }

    return Math.ceil(blocksLeft * BLOCK_TIME_SEC)
  }, [roundInfo, latestBlockNumber, currentInternalEpoch, isV2Pool])

  // Must be declared before timerCard to avoid temporal dead zone
  const isDeadRound = !isV2Pool && !isV4Pool && shownState === 3 && Number(shownRoundInfo?.totalTickets ?? 0) === 0

  const shownProgressPct = useMemo(() => {
    if (!depositWindowSec || !shownRoundInfo) return 0
    const elapsed = Math.max(0, depositWindowSec - shownSecondsRemaining)
    return Math.min(100, Math.round((elapsed / depositWindowSec) * 100))
  }, [depositWindowSec, shownSecondsRemaining, shownRoundInfo])

  // Compute settlement seconds for the shown round (not just the current round)
  const shownSettlementSecs = useMemo(() => {
    if (shownIsCurrentRound) return settlementSecondsRemaining
    if (!shownRoundInfo) return 0
    const st = Number(shownRoundInfo.state)
    if (st === 3 || (st !== 1 && st !== 2)) return 0
    const completionEpoch = Number(shownRoundInfo.unstakeCompletionEpoch ?? 0)
    if (completionEpoch > 0 && currentInternalEpoch > 0) {
      const EPOCH_LENGTH = 50_000
      const BLOCK_TIME_SEC = 0.4
      const epochsLeft = completionEpoch - currentInternalEpoch
      if (epochsLeft <= 0) return 0
      const blocksIntoEpoch = latestBlockNumber % EPOCH_LENGTH
      const blocksRemaining = (EPOCH_LENGTH - blocksIntoEpoch) + (epochsLeft - 1) * EPOCH_LENGTH
      return Math.max(0, Math.ceil(blocksRemaining * BLOCK_TIME_SEC))
    }
    return 0
  }, [shownIsCurrentRound, settlementSecondsRemaining, shownRoundInfo, currentInternalEpoch, latestBlockNumber])

  const timerCard = useMemo(() => {
    if (vaultPaused && shownIsCurrentRound) {
      return {
        heading: 'Vault Closed',
        value: 'Paused',
        sub: 'This vault is temporarily closed. Deposits are paused.',
        metaLabel: 'Vault status',
        metaValue: 'Closed'
      }
    }
    if (isV2Pool) {
      if (shownState === 0 && shownSecondsRemaining > 0) {
        return {
          heading: 'Deposits Open',
          value: formatCountdown(shownSecondsRemaining),
          sub: 'Deposits close in',
          metaLabel: 'Progress',
          metaValue: `${shownProgressPct}%`
        }
      }

      if (shownEmptyClosedRound) {
        return {
          heading: 'Round Skipped',
          value: 'Skipped',
          sub: 'No entries in this round',
          metaLabel: 'Vault status',
          metaValue: 'Skipped'
        }
      }

      if (shownYieldAccruing) {
        return {
          heading: 'Vault Closed',
          value: formatCountdown(shownCommitAfterRemaining),
          sub: 'Yield accruing — deposits no longer accepted',
          metaLabel: 'Next phase',
          metaValue: 'Drawing'
        }
      }

      if (shownState === 1) {
        return {
          heading: 'Drawing...',
          value: shownSettlementSecs > 0 ? formatCountdown(shownSettlementSecs) : 'Processing...',
          sub: 'Winner reveal in progress',
          metaLabel: 'Vault status',
          metaValue: 'Drawing'
        }
      }

      if (shownState === 2) {
        return {
          heading: 'Round Complete',
          value: 'Complete',
          sub: shownRoundInfo?.winner ? `Winner: ${shortAddr(shownRoundInfo.winner)}` : 'Winner and prize are available',
          metaLabel: 'Vault status',
          metaValue: 'Claim / Redeem'
        }
      }

      if (shownState === 3) {
        if (Number(shownRoundInfo?.totalTickets ?? 0) === 0) {
          return {
            heading: 'Round Skipped',
            value: 'Skipped',
            sub: 'No entries in this round',
            metaLabel: 'Vault status',
            metaValue: 'Skipped'
          }
        }
        return {
          heading: 'Round Complete',
          value: 'Complete',
          sub: shownRoundInfo?.winner ? `Winner: ${shortAddr(shownRoundInfo.winner)}` : 'Redeem and claim are now available',
          metaLabel: 'Vault status',
          metaValue: 'Claim / Redeem'
        }
      }

      if (shownState === 4) {
        return {
          heading: 'Round Skipped',
          value: 'Skipped',
          sub: 'No draw was completed for this round',
          metaLabel: 'Vault status',
          metaValue: 'Skipped'
        }
      }
    }

    if (isDeadRound) {
      return {
        heading: 'Vault Cycling',
        value: 'Resetting',
        sub: 'This vault is preparing for the next deposit window',
        metaLabel: 'Vault status',
        metaValue: 'Cycling'
      }
    }

    if (shownState === 0) {
      if (shownSecondsRemaining > 0) {
        return {
          heading: 'Vault Accepting Deposits',
          value: formatCountdown(shownSecondsRemaining),
          sub: 'Deposit window closes in',
          metaLabel: 'Progress',
          metaValue: `${shownProgressPct}%`
        }
      }

      const emptyRound = Number(shownRoundInfo?.totalTickets ?? 0) === 0 || roundPrincipalWei(shownRoundInfo) === 0n
      if (emptyRound) {
        return {
          heading: 'Round Closed',
          value: '00:00:00',
          sub: 'No tickets sold in this round.',
          metaLabel: 'Next action',
          metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Skip') : 'Closed'
        }
      }

      const commitAfterTime = Number(shownRoundInfo?.salesEndTime ?? 0) + yieldPeriod
      const yieldSecsRemaining = Math.max(0, commitAfterTime - now)

      if (yieldSecsRemaining > 0) {
        return {
          heading: 'Yield Accumulating',
          value: formatCountdown(yieldSecsRemaining),
          sub: 'Vault locked -- yield building for prize',
          metaLabel: 'Winner reveal in',
          metaValue: formatCountdown(yieldSecsRemaining)
        }
      }

      return {
        heading: 'Round Finalizing',
        value: 'Processing...',
        sub: 'Yield complete -- awaiting draw',
        metaLabel: 'Next action',
        metaValue: 'Commit'
      }
    }

    if (shownState === 1) {
      const targetBlock = Number(shownRoundInfo?.targetBlockNumber ?? 0)
      if (shownSettlementSecs > 0) {
        return {
          heading: 'Winner Reveal Pending',
          value: formatCountdown(shownSettlementSecs),
          sub: `Draw unlock at block ${targetBlock.toLocaleString()}`,
          metaLabel: 'Next action',
          metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Draw') : 'Draw'
        }
      }

      return {
        heading: 'Winner Revealed',
        value: 'Finalizing…',
        sub: targetBlock > 0 ? `Waiting for draw at block ${targetBlock.toLocaleString()}` : 'Round is being finalized',
        metaLabel: 'Next action',
        metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Claim / Redeem') : 'Claim / Redeem'
      }
    }

    if (shownState === 2) {
      const targetBlock = Number(shownRoundInfo?.targetBlockNumber ?? 0)
      const completionEpoch = Number(shownRoundInfo?.unstakeCompletionEpoch ?? 0)
      const epochBased = completionEpoch > 0 && currentInternalEpoch > 0

      if (shownSettlementSecs > 0 && shownSettlementSecs <= 86400) {
        return {
          heading: 'Winner Revealed',
          value: formatCountdown(shownSettlementSecs),
          sub: 'Round is wrapping up',
          metaLabel: 'Next action',
          metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Claim / Redeem') : 'Claim / Redeem'
        }
      }

      if (shownSettlementSecs > 86400) {
        return {
          heading: 'Vault Locked — Accumulating Yield',
          value: formatCountdown(shownSettlementSecs),
          sub: epochBased
            ? 'Yield window in progress'
            : 'Yield building for prize',
          metaLabel: 'Est. unlock',
          metaValue: formatCountdown(Math.max(0, shownSettlementSecs - 86400))
        }
      }

      return {
        heading: 'Winner Revealed',
        value: 'Finalizing…',
        sub: targetBlock > 0 ? `Target block ${targetBlock.toLocaleString()}` : 'Round is being finalized',
        metaLabel: 'Next action',
        metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Claim / Redeem') : 'Claim / Redeem'
      }
    }

    if (shownState === 3) {
      return {
        heading: 'Draw Complete',
        value: 'Ready',
        sub: 'Claim or redeem is now available',
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
  }, [vaultPaused, isV2Pool, isDeadRound, shownState, shownSecondsRemaining, shownCommitAfterRemaining, shownEmptyClosedRound, shownYieldAccruing, shownProgressPct, shownRoundInfo, shownSettlementSecs, shownIsCurrentRound, nextAction, currentInternalEpoch, yieldPeriod, now])

  const timerProgressPct = shownState === 0 ? shownProgressPct : shownSettled ? 100 : 50
  const timerIsClock = /^\d+:\d{2}:\d{2}:\d{2}$/.test(timerCard.value)

  const isUnstaking = !isV2Pool && shownState === 2 && shownSettlementSecs > 0 && shownSettlementSecs <= 86400
  const drawFinished = !isDeadRound && !isFailedRound(shownState, isV2Pool) && (shownSettled || isUnstaking)
  const activeRoundInfo = shownRoundInfo ?? roundInfo
  const activeRoundId = shownRoundId || roundId

  useEffect(() => {
    if (!drawFinished) setShowWinnersView(false)
  }, [drawFinished])

  const tvlMON = roundInfo ? Number(ethers.formatEther(roundPrincipalWei(roundInfo))).toFixed(4) : '...'
  const currentPrizePool = useMemo(() => {
    if (!roundInfo) return { value: '...', sub: 'Loading...' }

    if (isSettledState(roundInfo.state, isV2Pool)) {
      return {
        value: `${Number(ethers.formatEther(roundYieldWei(roundInfo, isV2Pool || isV3Pool))).toFixed(4)} MON`,
        sub: 'Final yield'
      }
    }

    const principal = Number(ethers.formatEther(roundPrincipalWei(roundInfo)))
    const durationSec = roundDuration || 0
    const yearSec = 365 * 24 * 60 * 60
    const apy = (Number.isFinite(estimatedApyPercent) ? estimatedApyPercent : 0) / 100
    const est = principal * apy * (durationSec / yearSec)

    return {
      value: `~${est.toFixed(4)} MON`,
      sub: `Estimated final yield @ ${estimatedApyPercent}% APY`
    }
  }, [estimatedApyPercent, isV2Pool, isV3Pool, roundDuration, roundInfo])

  const winnersSource = {
    rid: shownRoundId,
    info: shownRoundInfo ?? roundInfo,
    participants: shownParticipants,
  }

  const winnerParticipant = useMemo(() => {
    if (!winnersSource.info?.winner) return null
    return winnersSource.participants.find((p) => p.wallet.toLowerCase() === String(winnersSource.info.winner).toLowerCase()) || null
  }, [winnersSource])

  const previousSettlementCountdown = useMemo(() => {
    if (!previousRoundInfo) return '—'
    const st = Number(previousRoundInfo.state)
    if (isSettledState(st, isV2Pool)) return '00:00:00:00'
    if (salesOpen && secondsRemaining > 0) return formatCountdown(secondsRemaining)
    return 'Winner revealed'
  }, [previousRoundInfo, isV2Pool, salesOpen, secondsRemaining])

  const winnersRoundId = winnersSource?.rid || roundId
  const winnersPoolAddress = shownPoolAddress
  const winnersIsV2Pool = poolAddressesV2.some((a) => a.toLowerCase() === String(winnersPoolAddress).toLowerCase())
  const winnersUsesSharePrizeAccounting = usesSharePrizeAccounting(winnersPoolAddress)
  const winnersPoolAbi = getPoolAbi(winnersPoolAddress)
  const winnersYieldWei = roundYieldWei(winnersSource?.info, winnersUsesSharePrizeAccounting)
  const isWinnerWallet = !!account && !!winnersSource?.info?.winner && account.toLowerCase() === String(winnersSource.info.winner).toLowerCase()
  const winnersTerminal = isTerminalRound(winnersSource?.info?.state ?? -1, winnersIsV2Pool)
  const canClaimPrize = isWinnerWallet && winnersYieldWei > 0n && winnersTerminal && !Boolean(winnersSource?.info?.prizeClaimed)
  const canWithdrawPrincipal = !!account && winnersUserPrincipalWei > 0n && winnersTerminal
  const canRedeemWinnersRound = canClaimPrize || canWithdrawPrincipal

  const winnerTicketsDisplay = winnerParticipant
    ? winnerParticipant.tickets
    : Number(winnersSource?.info?.totalTickets ?? 0) > 0
      ? '—'
      : 0

  const sfxTestMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('sfxtest') === '1'

  useEffect(() => {
    const ac = new AbortController()
    const loadPrincipal = async () => {
      if (!account || !winnersPoolAddress || !winnersRoundId) {
        setWinnersUserPrincipalWei(0n)
        return
      }
      try {
        const provider = await getReadProvider()
        assertNotAborted(ac.signal)
        const pool = new ethers.Contract(winnersPoolAddress, winnersPoolAbi, provider)
        const v = winnersUsesSharePrizeAccounting
          ? (await _cached(`userPosition:${winnersPoolAddress}:${winnersRoundId}:${account}`, 5_000, () => pool.getUserPosition(BigInt(winnersRoundId), account), ac.signal))[0]
          : await _cached(`principal:${winnersPoolAddress}:${winnersRoundId}:${account}`, 5_000, () => pool.principalMON(BigInt(winnersRoundId), account), ac.signal)
        assertNotAborted(ac.signal)
        setWinnersUserPrincipalWei(BigInt(v))
      } catch (err) {
        if (!isAbortError(err)) setWinnersUserPrincipalWei(0n)
      }
    }
    loadPrincipal()
    return () => ac.abort()
  }, [account, winnersPoolAddress, winnersRoundId, winnersPoolAbi, winnersUsesSharePrizeAccounting])

  useEffect(() => {
    const ac = new AbortController()
    const loadMyRounds = async () => {
      if (!account || !allPoolAddresses.length) {
        setMyRounds([])
        return
      }
      try {
        const provider = await getReadProvider()
        const rowsByKey = new Map()
        const putRow = (row) => rowsByKey.set(`${String(row.poolAddr).toLowerCase()}:${row.rid}`, row)

        for (const addr of allPoolAddresses) {
          if (!ethers.isAddress(addr)) continue
          const addrUsesPosition = usesSharePrizeAccounting(addr)
          const pool = new ethers.Contract(addr, getPoolAbi(addr), provider)

          let cur = 0
          try {
            cur = Number(await _cached(`currentRound:${addr}`, 10_000, () => pool.currentRoundId(), ac.signal))
          } catch (err) { if (isAbortError(err)) throw err; continue }

          const rids = []
          for (let rid = 1; rid <= cur; rid++) rids.push(rid)

          const [infos, principals] = await Promise.all([
            Promise.all(rids.map(rid =>
              getCachedRoundInfo(pool, addr, BigInt(rid), ac.signal).then((info) => hydrateV4RoundInfo(pool, addr, BigInt(rid), info, ac.signal)).catch(() => null)
            )),
            Promise.all(rids.map(rid => addrUsesPosition
              ? _cached(`userPosition:${addr}:${rid}:${account}`, 10_000, () => pool.getUserPosition(BigInt(rid), account).then((pos) => pos[0]).catch(() => 0n), ac.signal)
              : _cached(`principal:${addr}:${rid}:${account}`, 10_000, () => pool.principalMON(BigInt(rid), account).catch(() => 0n), ac.signal)))
          ])

          rids.forEach((rid, i) => {
            const info = infos[i]
            const principal = principals[i] ?? 0n
            if (!info) return
            const isWinner = account.toLowerCase() === String(info.winner || '').toLowerCase()
            if (principal > 0n || isWinner) {
              putRow({
                rid,
                poolAddr: addr,
                isV2: false,
                state: Number(info.state),
                salesEndTime: Number(info.salesEndTime ?? 0),
                commitAfterTime: 0,
                isWinner,
                prizeClaimed: Boolean(info.prizeClaimed),
                principalWei: principal,
                principalMon: Number(ethers.formatEther(principal)).toFixed(4),
                withdrawableShares: 0n,
                withdrawableMon: principal,
                prizeWei: roundYieldWei(info, false),
                canClaimPrize: isWinner && roundYieldWei(info, false) > 0n && !Boolean(info.prizeClaimed) && Number(info.state) === 3,
                canWithdraw: Number(info.state) === 3 && principal > 0n,
              })
            }
          })
        }

        const indexerRows = await fetch(`${INDEXER_URL}/api/wallets/${account}/rounds`, { signal: ac.signal })
          .then((r) => r.json())
          .catch((err) => { if (isAbortError(err)) throw err; return [] })

        for (const r of indexerRows) {
          if (!ethers.isAddress(r.poolAddress)) continue
          const isV2round = poolAddressesV2.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())
          const isV3round = !isV2round && poolAddressesV3.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())
          const isV4round = !isV2round && !isV3round && poolAddressesV4.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())
          const isLegacyRound = !isV2round && !isV3round && !isV4round
          const salesEndSec = r.salesEndTime ? Math.floor(new Date(r.salesEndTime).getTime() / 1000) : 0
          const monPaidWei = BigInt(r.assetPaid || r.monPaid || '0')
          const principalWithdrawnWei = BigInt(r.principalWithdrawn || '0')
          let remainingPrincipalWei = principalWithdrawnWei >= monPaidWei ? 0n : monPaidWei - principalWithdrawnWei
          let principalReadFromChain = false
          let normalizedState = isV2round
            ? (r.state === 'open' ? 0 : r.state === 'committed' ? 1 : r.state === 'settled' ? 2 : r.state === 'skipped' ? 3 : r.state === 'failed' ? 4 : 0)
            : (r.state === 'settled' || r.state === 'skipped' ? 3 : r.state === 'drawn' || r.state === 'unstaking' ? 2 : r.state === 'committed' ? 1 : 0)
          let commitAfterTime = salesEndSec + (isV2round ? 604800 : 0)
          let prizeWei = BigInt(r.prizeClaimed || '0')
          let prizeClaimed = r.prizeClaimed !== '0'

          if (isV2round) {
            try {
              const pool = new ethers.Contract(r.poolAddress, POOL_V2_ABI, provider)
              const [info, commitAt, userPos] = await Promise.all([
                getCachedRoundInfo(pool, r.poolAddress, BigInt(r.roundId), ac.signal),
                _cached(`commitAfter:${r.poolAddress}:${r.roundId}`, 5_000, () => pool.getCommitAfterTime(BigInt(r.roundId)).catch(() => 0), ac.signal),
                _cached(`userPosition:${r.poolAddress}:${r.roundId}:${account}`, 10_000, () => pool.getUserPosition(BigInt(r.roundId), account).catch(() => null), ac.signal),
              ])
              normalizedState = Number(info.state)
              commitAfterTime = Number(commitAt || 0)
              prizeWei = roundYieldWei(info, true)
              prizeClaimed = Boolean(info.prizeClaimed)
              if (userPos) {
                remainingPrincipalWei = BigInt(userPos[0] || 0n)
                principalReadFromChain = true
              }
            } catch (err) {
              if (isAbortError(err)) throw err
            }
          }

          if (isV3round) {
            try {
              const pool = new ethers.Contract(r.poolAddress, POOL_V3_ABI, provider)
              const [info, userPos] = await Promise.all([
                getCachedRoundInfo(pool, r.poolAddress, BigInt(r.roundId), ac.signal),
                _cached(`userPositionV3:${r.poolAddress}:${r.roundId}:${account}`, 10_000, () => pool.getUserPosition(BigInt(r.roundId), account).catch(() => null), ac.signal),
              ])
              normalizedState = Number(info.state)
              prizeClaimed = Boolean(info.prizeClaimed)

              const prizeShares = BigInt(info.prizeShares || 0n)
              if (prizeShares > 0n) {
                const shmon = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, provider)
                prizeWei = await _cached(
                  `shmonPreviewRedeem:${SHMON_ADDRESS}:${prizeShares.toString()}`,
                  15_000,
                  () => shmon.previewRedeem(prizeShares).catch(() => 0n),
                  ac.signal,
                )
              } else {
                prizeWei = 0n
              }

              if (userPos) {
                remainingPrincipalWei = BigInt(userPos[0] || 0n)
                principalReadFromChain = true
              }
            } catch (err) {
              if (isAbortError(err)) throw err
            }
          }

          if (isV4round) {
            try {
              const pool = new ethers.Contract(r.poolAddress, POOL_V4_ABI, provider)
              const [info, userPos] = await Promise.all([
                getCachedRoundInfo(pool, r.poolAddress, BigInt(r.roundId), ac.signal).then((round) => hydrateV4RoundInfo(pool, r.poolAddress, BigInt(r.roundId), round, ac.signal)),
                _cached(`userPositionV4:${r.poolAddress}:${r.roundId}:${account}`, 10_000, () => pool.getUserPosition(BigInt(r.roundId), account).catch(() => null), ac.signal),
              ])
              normalizedState = Number(info.state)
              prizeClaimed = false
              prizeWei = roundYieldWei(info, true)
              if (userPos) {
                remainingPrincipalWei = BigInt(userPos[0] || 0n)
                principalReadFromChain = true
              }
            } catch (err) {
              if (isAbortError(err)) throw err
            }
          }

          if (isLegacyRound) {
            try {
              const pool = new ethers.Contract(r.poolAddress, POOL_ABI, provider)
              const onchainPrincipal = await _cached(
                `legacyPrincipal:${r.poolAddress}:${r.roundId}:${account}`,
                10_000,
                () => pool.principalMON(BigInt(r.roundId), account).catch(() => null),
                ac.signal,
              )
              if (onchainPrincipal !== null) {
                remainingPrincipalWei = BigInt(onchainPrincipal)
                principalReadFromChain = true
              }
            } catch (err) {
              if (isAbortError(err)) throw err
            }
          }

          putRow({
            rid: r.roundId,
            poolAddr: r.poolAddress,
            isV2: isV2round,
            isV4: isV4round,
            state: normalizedState,
            salesEndTime: salesEndSec,
            commitAfterTime,
            isWinner: r.won === 1,
            prizeClaimed,
            principalWei: remainingPrincipalWei,
            principalMon: Number(ethers.formatEther(remainingPrincipalWei)).toFixed(4),
            withdrawableShares: 0n,
            withdrawableMon: null,
            prizeWei,
            canClaimPrize: r.won === 1 && prizeWei > 0n && !prizeClaimed && isTerminalRound(normalizedState, isV2round),
            canWithdraw: principalReadFromChain && isTerminalRound(normalizedState, isV2round) && remainingPrincipalWei > 0n,
          })
        }

        const rows = Array.from(rowsByKey.values())
        rows.sort((a, b) => b.rid !== a.rid ? b.rid - a.rid : a.poolAddr.localeCompare(b.poolAddr))
        assertNotAborted(ac.signal)
        setMyRounds(rows)
      } catch (err) {
        if (!isAbortError(err)) setMyRounds([])
      }
    }
    loadMyRounds()
    return () => ac.abort()
  }, [account, allPoolAddresses, poolAddressesV2, poolAddressesV3, poolAddressesV4, roundId, usesSharePrizeAccounting, getPoolAbi, hydrateV4RoundInfo])

  const myRoundsStats = useMemo(() => {
    const lockedWei = myRounds
      .filter((r) => !isTerminalRound(r.state, r.isV2))
      .reduce((acc, r) => acc + (r.principalWei || 0n), 0n)

    const claimableWei = myRounds
      .filter((r) => isTerminalRound(r.state, r.isV2))
      .reduce((acc, r) => acc + (r.principalWei || 0n), 0n)

    const winningsWei = myRounds
      .filter((r) => r.isWinner)
      .reduce((acc, r) => acc + (r.prizeWei || 0n), 0n)

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

      const walletProvider = getWalletProvider()
      if (!walletProvider) throw new Error('Wallet required')
      if (!targetPoolAddress) throw new Error('Missing pool address')
      if (!account) throw new Error('No wallet connected')

      const provider = new ethers.BrowserProvider(walletProvider)
      await ensureCorrectNetwork(provider, expectedChainId)

      const readProvider = await getReadProvider()
      const nonce = await fetchNonceWithRetry(account)
      const feeData = await readProvider.getFeeData()
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas

      const sendTx = async (contractMethod, args, gasLimit, options = {}) => {
        const iface = new ethers.Interface(getPoolAbi(targetPoolAddress))
        const data = iface.encodeFunctionData(contractMethod, args)
        const txHash = await provider.send('eth_sendTransaction', [{
          from: account,
          to: targetPoolAddress,
          data,
          gas: ethers.toBeHex(gasLimit),
          nonce: ethers.toBeHex(nonce + (options.nonceOffset ?? 0)),
          gasPrice: ethers.toBeHex(gasPrice),
          ...(options.value !== undefined ? { value: ethers.toBeHex(options.value) } : {}),
        }])
        await readProvider.waitForTransaction(txHash)
        return txHash
      }

      await fn(sendTx)
      await refresh()
      setActionStatus(`${label}: success`)
      return true
    } catch (e) {
      setActionStatus('')
      setActionError(normalizeError(e) || `${label} failed`)
      return false
    } finally {
      setActionBusy(false)
    }
  }, [account, expectedChainId, poolAddress, refresh, getPoolAbi])

  const handleRedeemRound = useCallback(async ({ rid, poolAddr = poolAddress, claimPrize = false, withdrawPrincipal = false, label = `Redeem (Round #${rid})` }) => {
    if (!rid || (!claimPrize && !withdrawPrincipal)) return false
    return await runSignedAction(label, async (sendTx) => {
      let nonceOffset = 0
      if (claimPrize) {
        const claimTxHash = await sendTx('claimPrize', [BigInt(rid)], 500000n, { nonceOffset })
        nonceOffset += 1
        setActionStatus(`${label}: prize submitted ${String(claimTxHash).slice(0, 10)}...`)
      }
      if (withdrawPrincipal) {
        const withdrawTxHash = await sendTx('withdrawPrincipal', [BigInt(rid)], 500000n, { nonceOffset })
        setActionStatus(`${label}: principal submitted ${String(withdrawTxHash).slice(0, 10)}...`)
      }
    }, poolAddr)
  }, [poolAddress, runSignedAction])

  const closeClaimFlow = useCallback(() => {
    if (actionBusy) return
    setClaimRedirectWarningOpen(false)
    setClaimFlow((prev) => ({ ...prev, open: false }))
    setActionStatus('')
    setActionError('')
  }, [actionBusy])

  const openClaimFlow = useCallback((next) => {
    setClaimRedirectWarningOpen(false)
    setActionStatus('')
    setActionError('')
    setClaimFlow({
      open: true,
      mode: next.mode,
      rid: next.rid ?? null,
      poolAddr: next.poolAddr ?? poolAddress,
      principalWei: next.principalWei ?? 0n,
      prizeWei: next.prizeWei ?? 0n,
      claimPrize: Boolean(next.claimPrize),
      withdrawPrincipal: Boolean(next.withdrawPrincipal),
    })
  }, [poolAddress])

  const claimFlowIsV2 = useMemo(() => {
    const lc = String(claimFlow.poolAddr || '').toLowerCase()
    return poolAddressesV2.some((a) => a.toLowerCase() === lc)
  }, [claimFlow.poolAddr, poolAddressesV2])

  const handleRedeemToWallet = useCallback(async () => {
    if (!claimFlow.rid) return
    const ok = await handleRedeemRound({
      rid: claimFlow.rid,
      poolAddr: claimFlow.poolAddr,
      claimPrize: claimFlow.claimPrize,
      withdrawPrincipal: claimFlow.withdrawPrincipal,
      label: `Redeem (Round #${claimFlow.rid})`,
    })
    if (ok) setClaimFlow((prev) => ({ ...prev, open: false }))
  }, [claimFlow.claimPrize, claimFlow.poolAddr, claimFlow.rid, claimFlow.withdrawPrincipal, handleRedeemRound])

  const handleRedeemAndConvert = useCallback(() => {
    setClaimRedirectWarningOpen(true)
  }, [])

  const handleConfirmRedeemAndConvert = useCallback(async () => {
    if (!claimFlow.rid) {
      setActionError('Missing round to withdraw')
      return
    }

    // Open from the click gesture so wallet/mobile browsers do not block it
    // after async wallet confirmation. Use a neutral holding page instead of
    // cloning EverDraw, then move it to shmonad.xyz once redemption succeeds.
    const shmonadWindow = window.open('', '_blank')
    try {
      if (shmonadWindow) {
        shmonadWindow.document.write('<!doctype html><title>Opening shmonad.xyz</title><body style="font-family:system-ui;background:#100d1e;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><main style="text-align:center"><h1>Redeeming…</h1><p>shmonad.xyz will open after your wallet confirms. Then click Unstake.</p></main></body>')
        shmonadWindow.document.close()
      }
    } catch {}
    const openShmonad = () => {
      try {
        if (shmonadWindow && !shmonadWindow.closed) {
          shmonadWindow.location.assign('https://shmonad.xyz')
          shmonadWindow.focus?.()
          return
        }
      } catch {}
      window.location.assign('https://shmonad.xyz')
    }

    const ok = await handleRedeemRound({
      rid: claimFlow.rid,
      poolAddr: claimFlow.poolAddr,
      claimPrize: claimFlow.claimPrize,
      withdrawPrincipal: claimFlow.withdrawPrincipal,
      label: `Redeem (Round #${claimFlow.rid})`,
    })
    if (!ok) return
    setClaimRedirectWarningOpen(false)
    setClaimFlow((prev) => ({ ...prev, open: false }))
    setActionStatus('Redeemed. Continue MON conversion in shmonad.xyz.')
    openShmonad()
  }, [claimFlow.claimPrize, claimFlow.rid, claimFlow.poolAddr, claimFlow.withdrawPrincipal, handleRedeemRound])

  const buyTicketsShmon = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setStatus('Preparing shMON approval...')

      if (!poolAddress) throw new Error('Missing pool address')
      if (!isV2Pool && !isV4Pool) throw new Error('Selected pool does not support shMON buys')
      const currentSalesOpen = roundInfo && Number(roundInfo.state) === 0 && Math.max(0, Number(roundInfo.salesEndTime ?? 0) - Math.floor(Date.now() / 1000)) > 0
      if (!currentSalesOpen) throw new Error('Deposits are closed for this round')
      const walletProvider = getWalletProvider()
      if (!walletProvider) throw new Error('Wallet required')

      const n = Number(ticketCountInput)
      if (!Number.isInteger(n) || n <= 0) throw new Error('Ticket count must be a positive integer')
      if (n > remainingTicketAllowance) {
        trackEvent('deposit_cap_hit', {
          vault: shownVaultLabel,
          requested_tickets: n,
          remaining_tickets: remainingTicketAllowance,
          cap_tickets: FRONTEND_TICKET_CAP,
          entry_mode: 'shmon',
        })
        throw new Error(`limit reached. remaining tickets you can purchase is ${formatWholeNumber(remainingTicketAllowance)}`)
      }

      const provider = new ethers.BrowserProvider(walletProvider)
      await provider.send('eth_requestAccounts', [])
      await ensureCorrectNetwork(provider, expectedChainId)
      if (!account) throw new Error('No wallet connected')

      const readProvider = await getReadProvider()
      const poolAbi = isV4Pool ? POOL_V4_ABI : POOL_V2_ABI
      const pool = new ethers.Contract(poolAddress, poolAbi, readProvider)
      const shmonAddress = await _cached(
        `shmon:${poolAddress}`,
        86400_000 * 365,
        () => isV4Pool ? pool.yieldVault() : pool.shmon()
      )
      const ticketPriceForAsset = await _cached(
        `ticketPrice:${poolAddress}:${isV4Pool ? 'asset' : 'mon'}`,
        86400_000 * 365,
        () => isV4Pool ? pool.ticketPriceAsset() : pool.getFunction('ticketPriceMON').staticCall()
      )
      const monCost = BigInt(ticketPriceForAsset) * BigInt(n)
      const shmonRead = new ethers.Contract(shmonAddress, SHMON_READ_ABI, readProvider)
      const sharesOwed = isV4Pool
        ? await shmonRead.previewDeposit(monCost)
        : (await shmonRead.previewWithdraw(monCost)) + 1n
      const targetRoundId = roundId
      const previousDepositWei = await readUserRoundDepositWei({ targetRoundId }).catch(() => 0n)
      const expectedDepositWei = previousDepositWei + monCost
      const nonce = await fetchNonceWithRetry(account)
      const feeData = await readProvider.getFeeData()
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas

      const erc20 = new ethers.Interface(ERC20_ABI)
      const poolIface = new ethers.Interface(poolAbi)

      const approveData = erc20.encodeFunctionData('approve', [poolAddress, sharesOwed])
      const buyData = poolIface.encodeFunctionData('buyTicketsShmon', [n])
      trackEvent('deposit_start', {
        vault: shownVaultLabel,
        ticket_count: n,
        entry_mode: 'shmon',
      })

      setStatus('Waiting for approve confirmation...')
      const approveTxHash = await provider.send('eth_sendTransaction', [{
        from: account,
        to: shmonAddress,
        data: approveData,
        gas: ethers.toBeHex(120000n),
        nonce: ethers.toBeHex(nonce),
        gasPrice: ethers.toBeHex(gasPrice),
      }])
      await readProvider.waitForTransaction(approveTxHash)

      setStatus('Submitting shMON buy...')
      const buyTxHash = await provider.send('eth_sendTransaction', [{
        from: account,
        to: poolAddress,
        data: buyData,
        gas: ethers.toBeHex(500000n),
        nonce: ethers.toBeHex(nonce + 1),
        gasPrice: ethers.toBeHex(gasPrice),
      }])
      setTicketCountInput('')
      pollUserDepositTotal({ expectedMinWei: expectedDepositWei, targetRoundId }).catch(() => {
        setDepositTotalLine({
          account,
          poolAddress,
          roundId: String(targetRoundId || ''),
          text: 'deposit submitted. total update delayed.',
        })
      })
      await readProvider.waitForTransaction(buyTxHash)

      setStatus('Buy with shMON successful')
      trackEvent('deposit_success', {
        vault: shownVaultLabel,
        ticket_count: n,
        entry_mode: 'shmon',
      })
      refresh().catch(() => {})
    } catch (e) {
      setStatus('')
      trackEvent('deposit_error', {
        vault: shownVaultLabel,
        reason: normalizeError(e) || 'unknown',
        entry_mode: 'shmon',
      })
      setError(normalizeError(e) || 'buyTicketsShmon failed')
    } finally {
      setLoading(false)
    }
  }, [account, expectedChainId, isV2Pool, isV4Pool, poolAddress, pollUserDepositTotal, readUserRoundDepositWei, refresh, roundId, ticketCountInput, roundInfo, remainingTicketAllowance, shownVaultLabel])


  const setMaxTickets = useCallback(() => {
    try {
      if (!ticketPrice || ticketPrice <= 0n) return
      const canBuyWithShmon = (isV2Pool || isV4Pool) && buyWithShmon
      const available = canBuyWithShmon ? BigInt(shmonMonBalance || 0n) : ethers.parseEther(String(balance || '0'))
      const max = available / ticketPrice
      const cappedMax = max > BigInt(remainingTicketAllowance) ? BigInt(remainingTicketAllowance) : max
      if (cappedMax > 0n) setTicketCountInput(cappedMax.toString())
    } catch {
      // ignore malformed balance state
    }
  }, [balance, buyWithShmon, isV2Pool, isV4Pool, remainingTicketAllowance, shmonMonBalance, ticketPrice])

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

  if (!poolAddress && currentPage !== 'article') {
    return (
      <div className="app-shell">
        <div className="app-container">
          <h1>Missing configuration</h1>
          <p className="deposit-caption">Set VITE_POOL_ADDRESSES (or VITE_POOL_ADDRESS) and ideally VITE_RPC_URL in web/.env</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="beta-corner-ribbon" title="beta phase. Please size deposits accordingly." aria-label="beta phase. Please size deposits accordingly." />
      <div className="app-container">
        {showWinnersView ? (
          <WinnersView
            onBack={() => setShowWinnersView(false)}
            winner={winnersSource.info ? shortAddr(winnersSource.info.winner) : '\u2014'}
            winnerAddress={winnersSource.info ? String(winnersSource.info.winner) : ''}
            prize={
              isUnstaking && winnersSource.info
                ? `~${Number(ethers.formatEther(roundYieldWei(winnersSource.info, winnersUsesSharePrizeAccounting))).toFixed(4)} MON (estimated)`
                : winnersSource.info
                  ? `${Number(ethers.formatEther(roundYieldWei(winnersSource.info, winnersUsesSharePrizeAccounting))).toFixed(4)} MON`
                  : currentPrizePool.value
            }
            participants={winnersSource.participants}
            participantCount={winnersSource.participants.length}
            winnerTickets={winnerTicketsDisplay}
            totalTickets={winnersSource.info ? Number(winnersSource.info.totalTickets) : 0}
            roundNumber={Number(winnersSource.rid) || 0}
            isUnstaking={isUnstaking}
            canRedeem={canRedeemWinnersRound}
            settlementLabel={
              isUnstaking
                ? `Winner revealed — ${formatCountdown(shownSettlementSecs)} remaining`
                : winnersTerminal
                  ? ''
                  : 'Winner Revealed'
            }
            settlementCountdown={
              winnersTerminal
                ? '00:00:00:00'
                : shownSettlementSecs > 0
                  ? formatCountdown(shownSettlementSecs)
                  : previousSettlementCountdown
            }
            onRedeem={() => openClaimFlow({ mode: canClaimPrize ? 'winner' : 'principal', rid: winnersRoundId, poolAddr: winnersPoolAddress, principalWei: winnersUserPrincipalWei, prizeWei: winnersYieldWei, claimPrize: canClaimPrize, withdrawPrincipal: canWithdrawPrincipal })}
            actionBusy={actionBusy}
            actionStatus={actionStatus}
            actionError={actionError}
          />
        ) : (
          <>
            <Header account={account} onConnect={connectWallet} currentPage={currentPage} points={pointsProfile} />
            {currentPage === 'article' ? <FounderLaunchArticle /> : null}
            {currentPage !== 'article' && pointsBanner ? <div className="points-banner"><span>{pointsBanner}</span><button onClick={() => setPointsBanner(null)}>×</button></div> : null}
        {currentPage === 'stats' ? <StatsPage /> : null}
            {currentPage === 'profile' ? <ProfilePage account={account} points={pointsProfile} history={pointsHistory} /> : null}
            {currentPage === 'leaderboard' ? <LeaderboardPage account={account} /> : null}
            {currentPage === 'vault' && (<>


        <h1>
          Win the Pot.
          <br />
          Or keep your lot.
        </h1>

        <section className="vault-bar">
          {(isV2Pool || isV3Pool || isV4Pool) ? (
            <>
              {/* V3 takes the Vault A slot when present; V2 Vault A is reachable via My Rounds for in-flight finalization */}
              {(() => {
                const vaultASlot = activeVaultAddresses[0]
                const vaultBSlot = activeVaultAddresses[1]
                const hasTwoSlots = Boolean(vaultASlot && vaultBSlot)
                const selLc = selectedPoolAddress.toLowerCase()
                const isOnA = selLc === vaultASlot?.toLowerCase()
                const isOnB = selLc === vaultBSlot?.toLowerCase()
                return (
                  <>
                    <button
                      className={`vault-label ${!vaultBPending && isOnA ? 'active' : ''}`}
                      tabIndex={-1}
                      onClick={() => { setVaultBPending(false); setSelectedPoolAddress(vaultASlot); setMainView('current') }}
                    >VAULT A</button>
                    <div
                      className="vault-gear-track"
                      onClick={() => {
                        if (hasTwoSlots) {
                          setVaultBPending(false)
                          setSelectedPoolAddress(isOnA ? vaultBSlot : vaultASlot)
                        } else {
                          setVaultBPending((p) => !p)
                        }
                        setMainView('current')
                      }}
                    >
                      <div className={`vault-gear-knob ${vaultBPending || isOnB ? 'right' : ''}`}>⚙</div>
                    </div>
                    <button
                      className={`vault-label ${vaultBPending || isOnB ? 'active' : ''}`}
                      tabIndex={-1}
                      onClick={() => {
                        if (hasTwoSlots) {
                          setVaultBPending(false)
                          setSelectedPoolAddress(vaultBSlot)
                        } else {
                          setVaultBPending(true)
                        }
                        setMainView('current')
                      }}
                    >VAULT B</button>
                  </>
                )
              })()}
            </>
          ) : (
            <>
              <button className={`vault-label ${mainView === 'vaultA' ? 'active' : ''}`} tabIndex={-1} onClick={() => setMainView('vaultA')}>VAULT A</button>
              <div className="vault-gear-track" onClick={() => setMainView(mainView === 'vaultA' ? 'vaultB' : 'vaultA')}>
                <div className={`vault-gear-knob ${mainView === 'vaultB' ? 'right' : ''}`}>⚙</div>
              </div>
              <button className={`vault-label ${mainView === 'vaultB' ? 'active' : ''}`} tabIndex={-1} onClick={() => setMainView('vaultB')}>VAULT B</button>
            </>
          )}
          <div className="vault-bar-divider"></div>
          <button
            className={`vault-aux-btn ${mainView === 'previous' ? 'active' : ''}`}
            onClick={() => {
              setVaultBPending(false)
              setMainView('previous')
            }}
            disabled={false}
          >Previous Vault</button>
          <button className={`vault-aux-btn ${mainView === 'myrounds' ? 'active' : ''}`} onClick={() => setMainView('myrounds')}>My Rounds</button>
        </section>

        {mainView === 'myrounds' ? (
          <section className="participants-card">
            <div className="participants-head">
              <span>My Rounds</span>
              <span>{myRounds.length} Records</span>
            </div>
            <div className="participants-table my-rounds rounds-table">
              <div className="participants-row participants-header rounds-row">
                <span>Entry</span><span>Round</span><span>Result</span><span>Principal</span><span>Prize</span><span>Action</span>
              </div>
              {myRounds.length === 0 ? (
                <div className="participants-row rounds-row">
                  <span>—</span><span>No prior rounds found for this wallet</span><span>—</span><span>0.0000 MON</span><span>—</span><span className="action-cell">—</span>
                </div>
              ) : myRounds.map((r, index) => {
                const myRoundResultLabel = r.isV2
                  ? (r.state === 0 ? 'Open' : r.state < 2 ? 'Active' : r.state === 2 ? (r.isWinner ? 'Won' : 'No win') : 'No draw')
                  : (r.state === 0 ? 'Open' : r.state < 3 ? 'Locked' : (r.isWinner ? 'Won' : 'Participant'))
                const canRedeemRound = Boolean(r.canClaimPrize || r.canWithdraw)
                const canDepositRound = r.state === 0 && Number(r.salesEndTime || 0) > now
                const actionLabel = canRedeemRound
                  ? 'Redeem'
                  : canDepositRound
                    ? 'Deposit'
                    : isTerminalRound(r.state, r.isV2)
                      ? 'Claimed'
                      : '—'
                const pendingActionLabel = actionLabel
                const prizeLabel = r.isWinner
                  ? `${Number(ethers.formatEther(r.prizeWei || 0n)).toFixed(4)} MON`
                  : '—'
                const entryLabel = myRounds.length - index
                return (
                <div className="participants-row rounds-row" key={`${r.poolAddr}:${r.rid}`}>
                  <span>{entryLabel}</span>
                  <span>Round #{r.rid}</span>
                  <span>{myRoundResultLabel}</span>
                  <span>{r.principalMon} MON</span>
                  <span className={r.isWinner ? (r.prizeClaimed ? 'my-rounds-prize claimed' : 'my-rounds-prize won') : 'my-rounds-prize'}>{prizeLabel}</span>
                  <span className="action-cell">
                    {canRedeemRound ? (
                      <button
                        className="max-btn"
                        onClick={() => openClaimFlow({
                          mode: r.canClaimPrize ? 'winner' : 'principal',
                          rid: r.rid,
                          poolAddr: r.poolAddr,
                          principalWei: r.principalWei || 0n,
                          prizeWei: r.prizeWei || 0n,
                          claimPrize: r.canClaimPrize,
                          withdrawPrincipal: r.canWithdraw,
                        })}
                        disabled={withdrawingRid === `${r.poolAddr}:${r.rid}`}
                      >
                        {withdrawingRid === `${r.poolAddr}:${r.rid}` ? pendingActionLabel : actionLabel}
                      </button>
                    ) : canDepositRound ? (
                      <button
                        className="max-btn"
                        onClick={() => {
                          setVaultBPending(false)
                          setSelectedPoolAddress(r.poolAddr)
                          setMainView('current')
                        }}
                      >
                        Deposit
                      </button>
                    ) : isTerminalRound(r.state, r.isV2) && !canRedeemRound ? 'Claimed' : '—'}
                  </span>
                </div>
              )})}
            </div>
          </section>
        ) : (
          <section className="main-grid">
            {isV2Pool && vaultBPending ? (
              <div className="card">
                <div className="card-header"><div className="card-title">VAULT B</div></div>
                <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'rgba(155,109,255,0.5)', fontSize: '1rem' }}>
                  Opening Soon
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Buy Tickets</div>
                  {shownRoundId && Number(shownRoundId) > 0 ? (
                    <div style={{ fontSize: '0.82rem', color: 'rgba(155,109,255,0.8)', marginTop: '2px' }}>
                      {shownVaultLabel} · Round #{shownRoundId}
                    </div>
                  ) : null}
                </div>

                <div className="deposit-area">
                  <div className="input-group">
                    <div className="input-wrapper">
                      <input
                        type="number"
                        min="1"
                        max={remainingTicketAllowance || FRONTEND_TICKET_CAP}
                        step="1"
                        value={ticketCountInput}
                        onChange={(e) => setTicketCountInput(e.target.value)}
                        disabled={!shownIsCurrentRound}
                      />
                      <span className="currency-label">tickets</span>
                    </div>
                    <div className="balance-info balance-max-info">
                      <span>
                        Balance: {(isV2Pool || isV4Pool) && buyWithShmon ? `${formatMon(shmonMonBalance)} shMON` : `${Number(balance).toFixed(4)} MON`}
                      </span>
                      <button className="max-btn" onClick={setMaxTickets}>MAX</button>
                    </div>
                  </div>

                  <div className="balance-info">
                    <span>Price / ticket</span>
                    <span>{ethers.formatEther(ticketPrice || 0n)} MON</span>
                  </div>
                  {account && buyFormOpen ? (
                    <div className="balance-info beta-limit-info">
                      <span>BETA frontend limit</span>
                      <span>{formatWholeNumber(remainingTicketAllowance)} remaining / {formatWholeNumber(FRONTEND_TICKET_CAP)}</span>
                    </div>
                  ) : null}
                  {depositTotalLine &&
                    depositTotalLine.account === account &&
                    depositTotalLine.poolAddress === poolAddress &&
                    depositTotalLine.roundId === String(roundId || '')
                    ? <div className="deposit-total-line">{depositTotalLine.text}</div>
                    : null}

                  <div className="deposit-cta-wrap">
                    {(isV2Pool || isV4Pool) && (
                      <div className="token-selector-wrap">
                        <div className="token-selector">
                          <button
                            className="token-select-btn"
                            type="button"
                            onClick={() => setTokenDropdownOpen((o) => !o)}
                          >
                            <img src={buyWithShmon ? shmonIcon : monIcon} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} />
                            <span>{buyWithShmon ? 'shMON' : 'MON'}</span>
                            <span className="token-select-arrow">▾</span>
                          </button>
                          {tokenDropdownOpen && (
                            <div className="token-dropdown">
                              <button
                                className={`token-dropdown-item${!buyWithShmon ? ' selected' : ''}`}
                                onClick={() => { setBuyWithShmon(false); setTokenDropdownOpen(false) }}
                              >
                                <img src={monIcon} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', marginRight: 6, verticalAlign: 'middle' }} />
                                MON
                              </button>
                              <button
                                className={`token-dropdown-item${buyWithShmon ? ' selected' : ''}`}
                                onClick={() => { setBuyWithShmon(true); setTokenDropdownOpen(false) }}
                              >
                                <img src={shmonIcon} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', marginRight: 6, verticalAlign: 'middle' }} />
                                shMON
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      className="btn deposit-btn"
                      disabled={!shownIsCurrentRound || loading || !salesOpen}
                      onClick={account ? ((isV2Pool || isV4Pool) && buyWithShmon ? buyTicketsShmon : buyTickets) : connectWallet}
                    >
                      {loading
                        ? 'Submitting...'
                        : isDeadRound
                          ? 'Vault Cycling — Next Round Soon'
                          : !shownIsCurrentRound
                            ? (mainView === 'previous' ? `Buy with ${(isV2Pool || isV4Pool) && buyWithShmon ? 'shMON' : 'MON'}` : 'This Vault is Locked')
                            : !salesOpen
                              ? 'Deposits closed'
                              : !account
                                ? 'Connect Wallet to Buy'
                                : wrongNetwork
                                  ? 'Wrong network — click Buy to switch automatically'
                                  : (isV2Pool || isV4Pool)
                                    ? `Buy with ${buyWithShmon ? 'shMON' : 'MON'}`
                                    : canBuyTx
                                      ? 'Buy Tickets'
                                      : 'Buy Unavailable'}
                    </button>
                    {ticketLimitMessage ? <p className="deposit-caption">{ticketLimitMessage}</p> : null}
                    {(loading || wrongNetwork || !salesOpen || !account || !shownIsCurrentRound) && buyDisabledReason ? <p className="deposit-caption">{buyDisabledReason}</p> : null}
                    {account ? <p className="deposit-caption">MetaMask may wrongly flag brand-new Monad contracts as "malicious" — a known false positive we've reported to MetaMask. Other wallets aren't affected.</p> : null}
                  </div>

                  {status ? <p className="deposit-caption">{status}</p> : null}
                  {error ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{error}</p> : null}
                </div>
              </div>
            )}

            {mainView === 'previous' ? (
              <VaultAnimationTest onComplete={() => setShowWinnersView(true)} />
            ) : drawFinished ? (
              <VaultAnimationTest onComplete={() => setShowWinnersView(true)} />
            ) : (
              <div className={`card filled vault-card ${winnersTransitioning ? 'to-winners' : ''}`} id="vault-card">
                <VaultDoorBackground progressPct={shownState === 3 ? 100 : shownIsCurrentRound ? timerProgressPct : 50} salesOpen={shownIsCurrentRound ? salesOpen : false} />

                <div className="card-header vault-layer">
                  <div className="card-title">{timerCard.heading}</div>
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

        {mainView !== 'myrounds' ? (
          <RoundProgressSteps
            state={shownState >= 0 ? shownState : 0}
            settlementSecs={shownSettlementSecs}
            secondsRemaining={shownSecondsRemaining}
            isV3={isV3Pool || isV4Pool}
          />
        ) : null}

        <section className="stats-grid two-col">
          {mainView === 'myrounds' ? (
            <>
              <StatCard
                label="Total Locked (Active Rounds)"
                value={`${myRoundsStats.lockedMon} MON`}
                sub="Principal in active rounds"
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M17 9h-1V7a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V7z"/></svg>
                )}
              />
              <StatCard
                label="Total Redeemable"
                value={`${myRoundsStats.claimableMon} MON`}
                sub="Rounds ready to redeem"
                icon={(
                  <svg viewBox="0 0 24 24"><path d="M12 2v10m0 0l-4-4m4 4l4-4M5 14v5h14v-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              />
              <StatCard
                label="Total Winnings To Date"
                value={`${myRoundsStats.winningsMon} MON`}
                sub="Yield from wins"
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
                value={activeRoundInfo && (isSettledState(activeRoundInfo.state, isV2Pool) || isUnstaking) ? shortAddr(activeRoundInfo.winner) : '\u2014'}
                sub={activeRoundInfo && (isSettledState(activeRoundInfo.state, isV2Pool) || isUnstaking) ? `Winning ticket: ${activeRoundInfo.winningTicket}` : 'Revealed after draw'}
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h12v3a4 4 0 0 1-4 4h-1v2.08A4 4 0 0 1 16 17v2H8v-2a4 4 0 0 1 3-3.87V11h-1a4 4 0 0 1-4-4V4z"/></svg>
                )}
              />
              <StatCard
                label="Total Prize Pool"
                value={
                  activeRoundInfo && isSettledState(activeRoundInfo.state, isV2Pool)
                    ? `${Number(ethers.formatEther(roundYieldWei(activeRoundInfo, shownUsesSharePrizeAccounting))).toFixed(4)} MON`
                    : isUnstaking && activeRoundInfo
                      ? `~${Number(ethers.formatEther(roundYieldWei(activeRoundInfo, shownUsesSharePrizeAccounting))).toFixed(4)} MON (est.)`
                      : currentPrizePool.value
                }
                sub={
                  activeRoundInfo && isSettledState(activeRoundInfo.state, isV2Pool)
                    ? 'Final yield'
                    : isUnstaking
                      ? 'Estimated yield'
                      : currentPrizePool.sub
                }
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17h2.59l3.7-3.71 3 3L17.59 11H20v2h-1.59l-6.12 6.12-3-3L7 18.41V21H3v-4zM14 3h7v7h-2V6.41l-5.29 5.3-1.42-1.42 5.3-5.29H14V3z"/></svg>
                )}
              />
            </>
          )}
        </section>
        </>)}

          </>
        )}

        <ClaimFlowModal
          open={claimFlow.open}
          mode={claimFlow.mode}
          busy={actionBusy}
          status={actionStatus}
          error={actionError}
          onClose={closeClaimFlow}
          onRedeemToWallet={handleRedeemToWallet}
          onRedeemAndConvert={handleRedeemAndConvert}
          onBackFromRedirectWarning={() => setClaimRedirectWarningOpen(false)}
          confirmRedirectOpen={claimRedirectWarningOpen}
          onConfirmRedirect={handleConfirmRedeemAndConvert}
          isV2={claimFlowIsV2}
        />
        <footer className="site-footer" id="disclaimer">
          <div className="disclaimer-box">
            <div className="disclaimer-title">Disclaimer</div>
            <p>
              EverDraw is currently in beta and is awaiting a formal third-party audit. By accessing or using EverDraw, you acknowledge that the protocol, yield integrations, indexer data, wallet connections, and related infrastructure are experimental software. You buy tickets, approve tokens, deposit assets, interact with third-party protocols, and secure your wallet entirely at your own risk. You are solely responsible for reviewing all risks, permissions, transaction details, applicable laws, and tax treatment before participating. EverDraw is not investment, tax, accounting, or legal advice, and all liability is disclaimed to the maximum extent permitted by law.
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
