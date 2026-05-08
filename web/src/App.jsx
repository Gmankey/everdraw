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

function getWalletProvider() {
  return modal.getWalletProvider() || window.ethereum || null
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
  'function buyTicketsMON(uint32 ticketCount) payable',
  'function buyTicketsShmon(uint32 ticketCount)',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function getUserPosition(uint256 rid, address user) view returns (uint128 principalMONOut, uint128 principalShmonSharesOut)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)'
]

const SHMON_READ_ABI = [
  'function getInternalEpoch() view returns (uint64)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256 assets)'
]

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]

const ACTION_LABELS = ['None', 'Skip', 'Commit', 'Draw', 'Settle', 'Recommit']
const ACTION_LABELS_V2 = ['None', 'Commit', 'Settle', 'MarkFailed']
const STATE_LABELS = ['Open', 'Committed', 'Finalizing', 'Settled']
const STATE_LABELS_V2 = ['Open', 'Committed', 'Settled', 'Skipped', 'Failed']
const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'https://everdraw-indexer.fly.dev'

const SHMON_ABI = [
  'function getInternalEpoch() view returns (uint64)'
]

function formatMon(value, digits = 4) {
  try {
    return Number(ethers.formatEther(value || 0n)).toFixed(digits)
  } catch {
    return '0.0000'
  }
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

function parsePoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES, import.meta.env.VITE_POOL_ADDRESS)
}

function parseV2PoolAddresses() {
  return parseAddressEnv(import.meta.env.VITE_POOL_ADDRESSES_V2, import.meta.env.VITE_POOL_ADDRESS_V2)
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
  return String(import.meta.env.VITE_INDEXER_URL || INDEXER_URL || 'https://everdraw-indexer.fly.dev').replace(/\/$/, '')
}

function tierClass(tier) {
  return `tier-chip tier-${String(tier || 'Bronze').toLowerCase()}`
}

function PointsHeaderWidget({ account, points }) {
  const [open, setOpen] = useState(false)
  if (!account) return null
  const p = points || {}
  return (
    <div className="points-header">
      <button className="points-pill" type="button" onClick={() => setOpen((v) => !v)}>
        <span>{Number(p.lifetime_points || 0).toLocaleString()} pts</span>
        <span>🔥 {p.current_streak_weeks || 0}w</span>
      </button>
      {open ? (
        <div className="points-popover">
          <div className={tierClass(p.current_tier)}>{p.current_tier || 'Bronze'}</div>
          <strong>{Number(p.lifetime_points || 0).toLocaleString()} lifetime points</strong>
          <span>×{(Number(p.current_multiplier_x100 || 100) / 100).toFixed(2)} active multiplier</span>
          <a href="#profile">View profile →</a>
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
  const nextTier = points?.next_tier_threshold ?? (streakWeeks < 4 ? 4 : streakWeeks < 8 ? 8 : streakWeeks < 13 ? 13 : streakWeeks < 26 ? 26 : null)
  const milestoneBonus = { 4: 50, 13: 200, 26: 500, 52: 1000 }
  const nextMilestone = points?.next_milestone ?? [4, 13, 26, 52].find((m) => m > streakWeeks) ?? null
  const nextMilestoneReward = nextMilestone ? milestoneBonus[nextMilestone] : null
  const progressTarget = nextMilestone || nextTier || Math.max(1, streakWeeks)
  const progress = Math.min(100, (streakWeeks / progressTarget) * 100)
  const ensName = points?.ens && !ethers.isAddress(points.ens) && points.ens.toLowerCase() !== account.toLowerCase() ? points.ens : ''
  const recentRounds = (history || []).slice(0, 12)
  const bonusChips = [
    { label: 'First Deposit', unlocked: !!points?.has_received_first_deposit_bonus },
    { label: 'First Win', unlocked: !!points?.has_received_first_win_bonus },
    { label: 'Streak Milestone', unlocked: Number(points?.highest_streak_milestone_awarded || 0) > 0, detail: Number(points?.highest_streak_milestone_awarded || 0) > 0 ? `${points.highest_streak_milestone_awarded}w` : null },
  ]
  return (
    <section className="participants-card points-page">
      <div className="points-page-head">
        <div>
          <h2>{ensName || 'Your Points'}</h2>
          <span>{shortAddr(account)}</span>
        </div>
        <div className={tierClass(points?.current_tier)}>{points?.current_tier || 'Bronze'}</div>
      </div>
      <div className="points-big">{Number(points?.lifetime_points || 0).toLocaleString()} <span>points</span></div>
      <div className="points-streak-card">
        <div className="points-streak-title">🔥 {streakWeeks} week streak</div>
        <div className="points-progress"><span style={{ width: `${progress}%` }} /></div>
        <div className="points-highlight-grid">
          <div className="points-highlight-card">
            <span>Active multiplier</span>
            <strong>×{(multiplierX100 / 100).toFixed(2)}</strong>
            <small>{points?.current_tier || 'Bronze'} tier</small>
          </div>
          <div className="points-highlight-card">
            <span>Next milestone</span>
            <strong>{nextMilestone ? `${nextMilestone} weeks` : 'Complete'}</strong>
            <small>{nextMilestoneReward ? `+${nextMilestoneReward} point bonus` : 'All streak milestones cleared'}</small>
          </div>
        </div>
      </div>
      <h3>Recent rounds</h3>
      <div className="participants-table">
        <div className="participants-row participants-header"><span>Round</span><span>Base</span><span>Multiplier</span><span>Bonuses</span><span>Total</span></div>
        {recentRounds.length === 0 ? (
          <div className="points-empty-state">No rounds yet. Buy a ticket to start earning.</div>
        ) : recentRounds.map((h) => (
          <div className="participants-row" key={`${h.pool_address}:${h.round_id}`}><span>#{h.round_id}</span><span>{h.base_points}</span><span>×{(h.multiplier_x100 / 100).toFixed(2)}</span><span>{Object.keys(h.bonuses_breakdown || {}).join(', ') || '—'}</span><span>+{h.total_points}</span></div>
        ))}
      </div>
      <h3>Bonuses</h3>
      <div className="points-bonus-chips">
        {bonusChips.map((chip) => (
          <span className={`points-bonus-chip ${chip.unlocked ? 'unlocked' : 'locked'}`} key={chip.label}>
            {chip.label}{chip.detail ? ` · ${chip.detail}` : ''}
            <small>{chip.unlocked ? 'Unlocked' : 'To unlock'}</small>
          </span>
        ))}
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

function Header({ account, onConnect, currentPage, points }) {
  return (
    <header>
      <div className="logo">
        <img src="/favicon.png" alt="EverDraw" className="logo-img" />
        EverDraw
      </div>
      <nav className="nav-links">
        <a href="#vault" className={`nav-link ${currentPage === 'vault' ? 'active' : ''}`}>Vault</a>
        <a href="#stats" className={`nav-link ${currentPage === 'stats' ? 'active' : ''}`}>Stats</a>
        <a href="#profile" className={`nav-link ${currentPage === 'profile' ? 'active' : ''}`}>Profile</a>
        <a href="#leaderboard" className={`nav-link ${currentPage === 'leaderboard' ? 'active' : ''}`}>Leaderboard</a>
        <a href="https://docs.everdraw.xyz" target="_blank" rel="noopener noreferrer" className="nav-link">Docs</a>
        <a href="https://x.com/everdrawing" target="_blank" rel="noopener noreferrer" className="nav-link nav-link-x" aria-label="X / Twitter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
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

function ClaimFlowModal({ open, mode, busy, status, error, onClose, onClaimOnly, onWithdrawOnly, onRedeposit, onWithdrawAndConvert, onBackFromRedirectWarning, confirmRedirectOpen, onConfirmRedirect, isV2 = false }) {
  if (!open) return null

  const isWinner = mode === 'winner'
  const heroEyebrow = ''
  const heroTitle = isV2 ? 'Choose your redemption action' : 'How do you want to claim this round?'
  const heroBody = ''

  const options = isV2
    ? (isWinner
      ? [
          {
            kicker: busy ? 'Working...' : 'CLAIM PRIZE',
            title: 'Claim prize',
            body: '',
            onClick: onClaimOnly,
            tone: 'primary',
          },
          {
            kicker: busy ? 'Working...' : 'REDEEM',
            title: 'Redeem tickets to shMON wallet balance',
            body: '',
            onClick: onWithdrawOnly,
            tone: 'default',
          },
          {
            kicker: busy ? 'Working...' : 'REDEEM AS MON',
            title: 'Redeem, then open shmonad.xyz',
            body: '',
            onClick: onWithdrawAndConvert,
            tone: 'default',
          },
        ]
      : [
          {
            kicker: busy ? 'Working...' : 'REDEEM',
            title: 'Redeem tickets to shMON wallet balance',
            body: '',
            onClick: onWithdrawOnly,
            tone: 'primary',
          },
          {
            kicker: busy ? 'Working...' : 'REDEEM AS MON',
            title: 'Redeem, then open shmonad.xyz',
            body: '',
            onClick: onWithdrawAndConvert,
            tone: 'default',
          },
        ])
    : isWinner
    ? [
        {
          kicker: busy ? 'Working...' : 'SIMPLE CLAIM',
          title: 'Withdraw Shmon directly to wallet ',
          body: '',
          onClick: onClaimOnly,
          tone: 'default',
        },
        {
          kicker: busy ? 'Working...' : 'KEEP PLAYING',
          title: 'Re-deposit into the next active round',
          body: '',
          onClick: onRedeposit,
          tone: 'primary',
        },
        {
          kicker: busy ? 'Working...' : 'CLAIM AND CONVERT',
          title: 'Claim Shmon and convert to MON',
          body: '',
          onClick: onWithdrawAndConvert,
          tone: 'default',
        },
      ]
    : [
        {
          kicker: busy ? 'Working...' : 'WITHDRAW PRINCIPAL',
          title: 'Withdraw principal directly to wallet',
          body: '',
          onClick: onWithdrawOnly,
          tone: 'default',
        },
        {
          kicker: busy ? 'Working...' : 'KEEP PLAYING',
          title: 'Leave principal in the next active round',
          body: '',
          onClick: onClaimOnly,
          tone: 'primary',
        },
        {
          kicker: busy ? 'Working...' : 'WITHDRAW AND CONVERT',
          title: 'Withdraw principal and convert to MON',
          body: '',
          onClick: onWithdrawAndConvert,
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
          <div className="claim-flow-grid">
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

function WinnersView({ onBack, winner, winnerAddress, prize, participants, participantCount, winnerTickets, totalTickets, roundNumber, isUnstaking, canClaim, canWithdraw, settlementLabel, settlementCountdown, onClaimPrize, onWithdraw, actionBusy, actionStatus, actionError }) {
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
        <p>{settlementLabel}</p>
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
          <button className="btn" disabled>Available after settlement</button>
        ) : canClaim ? (
          <button className="btn" onClick={onClaimPrize} disabled={actionBusy}>Claim</button>
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
        <button className="btn ghost-btn" onClick={onWithdraw} disabled={actionBusy || !canWithdraw || isUnstaking}>
          {isUnstaking
            ? 'Available after settlement'
            : canWithdraw
              ? 'Claim Principal'
              : settlementCountdown === '00:00:00:00'
                ? 'No principal to claim'
                : `Claim Principal (${settlementCountdown})`}
        </button>
      </div>

      {actionStatus ? <p className="deposit-caption">{actionStatus}</p> : null}
      {actionError ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{actionError}</p> : null}
    </div>
  )
}

function RoundProgressSteps({ state, settlementSecs, secondsRemaining }) {
  const steps = ['Deposit', 'Yield Accruing', 'Winner Revealed', 'Claim / Withdraw']
  let activeStep = 0
  if (state === 0 && secondsRemaining <= 0) activeStep = 1
  if (state === 1) activeStep = 1
  if (state === 2) activeStep = settlementSecs > 0 ? 2 : 3
  if (state === 3) activeStep = 3

  return (
    <section className="round-steps">
      {steps.map((label, i) => (
        <div key={label} className={`step ${i < activeStep ? 'done' : i === activeStep ? 'active' : ''}`}>
          {i < steps.length - 1 && <div className="step-line" />}
          <div className="step-circle">{i < activeStep ? '\u2713' : i + 1}</div>
          <div className="step-label">{label}</div>
        </div>
      ))}
    </section>
  )
}

export default function App() {
  // Hash-based page routing
  const [currentPage, setCurrentPage] = useState(() => {
    if (window.location.hash === '#stats') return 'stats'
    if (window.location.hash === '#shmon') return 'shmon'
    if (window.location.hash === '#profile') return 'profile'
    if (window.location.hash === '#leaderboard') return 'leaderboard'
    return 'vault'
  })
  useEffect(() => {
    function onHashChange() {
      if (window.location.hash === '#stats') setCurrentPage('stats')
      else if (window.location.hash === '#shmon') setCurrentPage('shmon')
      else if (window.location.hash === '#profile') setCurrentPage('profile')
      else if (window.location.hash === '#leaderboard') setCurrentPage('leaderboard')
      else setCurrentPage('vault')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const poolAddresses = useMemo(() => parsePoolAddresses(), [])
  const poolAddressesV2 = useMemo(() => parseV2PoolAddresses(), [])
  const allPoolAddresses = useMemo(() => [...poolAddressesV2, ...poolAddresses], [poolAddresses, poolAddressesV2])
  const [selectedPoolAddress, setSelectedPoolAddress] = useState(allPoolAddresses[0] || '')
  const poolAddress = selectedPoolAddress
  const isV2Pool = useMemo(() => poolAddressesV2.some((a) => a.toLowerCase() === String(poolAddress).toLowerCase()), [poolAddressesV2, poolAddress])
  const activePoolAbi = isV2Pool ? POOL_V2_ABI : POOL_ABI

  const expectedChainId = import.meta.env.VITE_CHAIN_ID ? Number(import.meta.env.VITE_CHAIN_ID) : 143
  const estimatedApyPercent = import.meta.env.VITE_ESTIMATED_APY_PERCENT ? Number(import.meta.env.VITE_ESTIMATED_APY_PERCENT) : 12
  const poolDeployBlock = import.meta.env.VITE_POOL_DEPLOY_BLOCK ? Number(import.meta.env.VITE_POOL_DEPLOY_BLOCK) : 0
  const configuredDepositWindowSec = import.meta.env.VITE_DEPOSIT_WINDOW_SEC ? Number(import.meta.env.VITE_DEPOSIT_WINDOW_SEC) : 0

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
  const [claimFlow, setClaimFlow] = useState({ open: false, mode: 'winner', rid: null, poolAddr: '', principalWei: 0n, prizeWei: 0n })
  const [claimRedirectWarningOpen, setClaimRedirectWarningOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [withdrawingRid, setWithdrawingRid] = useState(null)
  const [actionStatus, setActionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const [myRounds, setMyRounds] = useState([])
  const [vaultSummaries, setVaultSummaries] = useState([])
  const [settledRoundId, setSettledRoundId] = useState('0')
  const [settledRoundInfo, setSettledRoundInfo] = useState(null)
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
      setSelectedPoolAddress(allPoolAddresses[0])
    }
  }, [allPoolAddresses, selectedPoolAddress])

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
        const abi = v2 ? POOL_V2_ABI : POOL_ABI
        const pool = new ethers.Contract(addr, abi, provider)
        const rid = await _cached(`currentRound:${addr}`, 10_000, () => pool.currentRoundId(), signal)
        const info = await getCachedRoundInfo(pool, addr, rid, signal)
        const state = Number(info.state)
        const salesEndTime = Number(info.salesEndTime)
        const nowSec = Math.floor(Date.now() / 1000)
        const commitAfter = v2 ? Number(await _cached(`commitAfter:${addr}:${rid}`, 5_000, () => pool.getCommitAfterTime(rid).catch(() => 0), signal)) : 0
        const secs = Math.max(0, salesEndTime - nowSec)
        const yieldSecs = Math.max(0, commitAfter - nowSec)
        return {
          poolAddress: addr,
          roundId: rid.toString(),
          state,
          stateLabel: (v2 ? STATE_LABELS_V2 : STATE_LABELS)[state] ?? 'Unknown',
          isNowOpen: state === 0 && secs > 0,
          timeRemainingSec: v2 && state === 0 && secs === 0 ? yieldSecs : secs,
          commitAfterTime: commitAfter,
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

    assertNotAborted(signal)
    setVaultSummaries(summaries)
  }, [allPoolAddresses, poolAddressesV2])

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
    ] = await Promise.all([
      _cached(`currentRound:${poolAddress}`, 10_000, () => pool.currentRoundId(), signal),
      _cached(`nextExecutable:${poolAddress}`, 5_000, () => pool.nextExecutable(), signal),
      _cached(`ticketPrice:${poolAddress}`, 86400_000 * 365, () => pool.ticketPriceMON(), signal),
      _cached(`deposit:${poolAddress}`, 86400_000 * 365, () => isV2Pool ? pool.roundDurationSec() : pool.depositPeriodSec(), signal),
      _cached(`yieldPeriod:${poolAddress}`, 86400_000 * 365, () => isV2Pool ? pool.yieldPeriodSec().catch(() => 0) : pool.yieldPeriodSec(), signal),
      _cached('provider:blockNumber', 2_000, () => provider.getBlockNumber(), signal),
      _cached('provider:network', 60_000, () => provider.getNetwork(), signal),
      _cached(`shmon:${poolAddress}`, 86400_000 * 365, () => pool.shmon().catch(() => ethers.ZeroAddress), signal),
      account ? _cached(`balance:${account}`, 5_000, () => provider.getBalance(account).catch(() => null), signal) : Promise.resolve(null),
    ])

    const info = await getCachedRoundInfo(pool, poolAddress, rid, signal)

    assertNotAborted(signal)
    setRoundId(rid.toString())
    setRoundInfo(info)
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

    if (isV2Pool) {
      const commitAt = Number(await _cached(`commitAfter:${poolAddress}:${rid}`, 5_000, () => pool.getCommitAfterTime(rid).catch(() => 0), signal))
      assertNotAborted(signal)
      setCommitAfterTime(commitAt)
    } else {
      setCommitAfterTime(0)
    }

    if (Number(rid) > 0) {
      const prevRid = Number(rid) - 1
      const prevInfo = await getCachedRoundInfo(pool, poolAddress, BigInt(prevRid), signal)
      assertNotAborted(signal)
      setPreviousRoundId(String(prevRid))
      setPreviousRoundInfo(prevInfo)
    } else {
      setPreviousRoundId('0')
      setPreviousRoundInfo(null)
      setPreviousParticipants([])
    }

    let sRid = null
    let sInfo = null
    if (Number(info.state) === 3 && Number(info.totalTickets) > 0) {
      sRid = Number(rid)
      sInfo = info
    } else if (settledRidCacheRef.current && settledRidCacheRef.current !== Number(rid)) {
      sRid = settledRidCacheRef.current
      sInfo = settledRoundInfo
    } else {
      const scanRids = []
      for (let r = Number(rid) - 1; r >= Math.max(1, Number(rid) - 3); r--) scanRids.push(r)
      const results = await Promise.all(scanRids.map((r) => getCachedRoundInfo(pool, poolAddress, BigInt(r), signal).catch(() => null)))
      for (let i = 0; i < results.length; i++) {
        const si = results[i]
        if (si && Number(si.state) === 3 && Number(si.totalTickets) > 0) {
          sRid = scanRids[i]
          sInfo = si
          break
        }
      }
    }
    assertNotAborted(signal)
    if (sRid) settledRidCacheRef.current = sRid
    setSettledRoundId(sRid ? String(sRid) : '0')
    if (sInfo) setSettledRoundInfo(sInfo)
    else setSettledRoundInfo(null)
    if (!sRid) setSettledParticipants([])
  }, [account, poolAddress, activePoolAbi, isV2Pool])

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
    let setter = null

    if (view === 'vaultA') {
      targetRoundId = vaultARoundIdNum
      setter = setParticipants
    } else if (view === 'vaultB') {
      targetRoundId = vaultBRoundIdNum
      setter = setPreviousParticipants
    } else if (view === 'previous') {
      targetRoundId = Number(settledRoundId) || 0
      setter = setSettledParticipants
    } else {
      return
    }

    if (!targetRoundId) {
      setter?.([])
      return
    }

    try {
      const res = await fetch(`https://everdraw-indexer.fly.dev/api/rounds/${targetRoundId}/participants`, { signal })
      if (!res.ok) {
        console.warn('[EverDraw] indexer participants fetch failed:', res.status)
        setter([])
        return
      }
      const data = await res.json()
      const totalTicketsNum = data.reduce((acc, p) => acc + (Number(p.tickets) || 0), 0)
      const built = data.map((p) => ({
        wallet: p.wallet,
        walletShort: shortAddr(p.wallet),
        tickets: Number(p.tickets) || 0,
        sharePct: totalTicketsNum > 0 ? ((Number(p.tickets) / totalTicketsNum) * 100).toFixed(2) : '0.00',
        depositedMon: Number(ethers.formatEther(BigInt(p.monPaid || '0'))).toFixed(4),
      })).sort((a, b) => b.tickets - a.tickets)
      assertNotAborted(signal)
      setter(built)
    } catch (e) {
      if (!isAbortError(e)) {
        console.warn('[EverDraw] indexer participants fetch error:', e)
        setter([])
      }
    }
  }, [roundId, previousRoundId, settledRoundId])

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
        // Wallet disconnected via modal
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
        setError('')
      } catch (e) {
        const msg = normalizeError(e)
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

  const buyTickets = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setStatus('Preparing transaction...')

      if (!poolAddress) throw new Error('Missing VITE_POOL_ADDRESS in web/.env')
      const walletProvider = getWalletProvider()
      if (!walletProvider) throw new Error('Wallet required for buyTickets')

      const n = Number(ticketCountInput)
      if (!Number.isInteger(n) || n <= 0) throw new Error('Ticket count must be a positive integer')

      const provider = new ethers.BrowserProvider(walletProvider)
      await provider.send('eth_requestAccounts', [])
      await ensureCorrectNetwork(provider, expectedChainId)
      if (!account) throw new Error('No wallet connected')

      const currentSalesOpen = roundInfo && Number(roundInfo.state) === 0 && Math.max(0, Number(roundInfo.salesEndTime ?? 0) - Math.floor(Date.now() / 1000)) > 0
      if (!currentSalesOpen) throw new Error('Deposits are closed for this round')

      const value = ticketPrice * BigInt(n)
      if (value === 0n) throw new Error('Ticket price not loaded yet — please wait a moment and try again')

      const readProvider = await getReadProvider()
      const callData = new ethers.Interface(activePoolAbi).encodeFunctionData(
        isV2Pool ? 'buyTicketsMON' : 'buyTickets',
        [n]
      )

      setStatus('Estimating gas...')
      let gasLimit
      try {
        const estimate = await readProvider.estimateGas({ from: account, to: poolAddress, data: callData, value })
        gasLimit = (estimate * 3n) / 2n
      } catch (estErr) {
        const reason = estErr?.reason || estErr?.shortMessage || estErr?.message || 'unknown'
        throw new Error(`Transaction would fail: ${reason}`)
      }

      setStatus('Waiting for wallet confirmation...')
      const nonce = await fetchNonceWithRetry(account)
      const feeData = await readProvider.getFeeData()
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas

      const txHash = await provider.send('eth_sendTransaction', [{
        from: account,
        to: poolAddress,
        data: callData,
        value: ethers.toBeHex(value),
        gas: ethers.toBeHex(gasLimit),
        nonce: ethers.toBeHex(nonce),
        gasPrice: ethers.toBeHex(gasPrice),
      }])

      setStatus(`Submitted: ${String(txHash).slice(0, 10)}... waiting for confirmation...`)
      await readProvider.waitForTransaction(txHash)
      setStatus('Buy successful')
      setLoading(false)
      refresh().catch(() => {})
      return
    } catch (e) {
      setStatus('')
      setError(normalizeError(e) || 'buyTickets failed')
    } finally {
      setLoading(false)
    }
  }, [account, expectedChainId, poolAddress, refresh, ticketCountInput, ticketPrice, activePoolAbi, isV2Pool, roundInfo])

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

  const currentState = roundInfo ? Number(roundInfo.state) : null
  const isOpenState = currentState === 0

  // Vault A = odd rounds, Vault B = even rounds
  const currentRidNum = Number(roundId) || 0
  const vaultARoundId = currentRidNum % 2 === 1 ? roundId : previousRoundId
  const vaultARoundInfo = currentRidNum % 2 === 1 ? roundInfo : previousRoundInfo
  const vaultAParticipants = currentRidNum % 2 === 1 ? participants : previousParticipants
  const vaultBRoundId = currentRidNum % 2 === 0 ? roundId : previousRoundId
  const vaultBRoundInfo = currentRidNum % 2 === 0 ? roundInfo : previousRoundInfo
  const vaultBParticipants = currentRidNum % 2 === 0 ? participants : previousParticipants

  const shownRoundId = isV2Pool
    ? (mainView === 'previous' ? settledRoundId : roundId)
    : mainView === 'vaultA' ? vaultARoundId
      : mainView === 'vaultB' ? vaultBRoundId
      : mainView === 'previous' ? settledRoundId
      : roundId
  const shownRoundInfo = isV2Pool
    ? (mainView === 'previous' ? settledRoundInfo : roundInfo)
    : mainView === 'vaultA' ? vaultARoundInfo
      : mainView === 'vaultB' ? vaultBRoundInfo
      : mainView === 'previous' ? settledRoundInfo
      : roundInfo
  const shownParticipants = isV2Pool
    ? (mainView === 'previous' ? settledParticipants : participants)
    : mainView === 'vaultA' ? vaultAParticipants
      : mainView === 'vaultB' ? vaultBParticipants
      : mainView === 'previous' ? settledParticipants
      : participants
  const shownIsCurrentRound = shownRoundId === roundId
  const shownState = shownRoundInfo ? Number(shownRoundInfo.state) : -1
  const shownVaultLabel = isV2Pool
    ? (selectedPoolAddress.toLowerCase() === poolAddressesV2[1]?.toLowerCase() || vaultBPending ? 'Vault B' : 'Vault A')
    : mainView === 'vaultA' ? 'Vault A' : mainView === 'vaultB' ? 'Vault B' : 'Previous Vault'
  const wrongNetwork = expectedChainId && connectedChainId && expectedChainId !== connectedChainId
  const shownSecondsRemaining = shownRoundInfo ? Math.max(0, Number(shownRoundInfo.salesEndTime ?? 0) - now) : 0
  const shownCommitAfterRemaining = shownRoundInfo && isV2Pool ? Math.max(0, Number(commitAfterTime || 0) - now) : 0
  const shownSalesOpen = shownState === 0 && shownSecondsRemaining > 0
  const shownYieldAccruing = isV2Pool && shownState === 0 && shownSecondsRemaining === 0 && shownCommitAfterRemaining > 0
  const salesOpen = shownIsCurrentRound ? shownSalesOpen : isOpenState && secondsRemaining > 0
  const buyFormOpen = shownIsCurrentRound && shownSalesOpen
  const canBuyTx = !!account && buyFormOpen && !loading

  const buyDisabledReason = useMemo(() => {
    if (loading) return 'Transaction in progress'
    if (!shownIsCurrentRound) return 'Deposits are only available in the active vault'
    if (!shownSalesOpen) {
      if (shownYieldAccruing) return 'Yield accruing'
      if (shownState !== 0) return 'Sales not open in this vault state'
      return 'Deposits are closed for this round'
    }
    if (!account) return 'Connect wallet to deposit'
    if (wrongNetwork) return 'Wrong network — click Buy to switch automatically'
    return ''
  }, [loading, shownIsCurrentRound, shownSalesOpen, shownYieldAccruing, shownState, account, wrongNetwork])

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
  const isDeadRound = !isV2Pool && shownState === 3 && Number(shownRoundInfo?.totalTickets ?? 0) === 0

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
          sub: 'Waiting for settlement',
          metaLabel: 'Vault status',
          metaValue: 'Drawing'
        }
      }

      if (shownState === 2) {
        return {
          heading: 'Round Complete',
          value: 'Complete',
          sub: shownRoundInfo?.winner ? `Winner: ${shortAddr(shownRoundInfo.winner)}` : 'Redeem and claim are now available',
          metaLabel: 'Vault status',
          metaValue: 'Settled'
        }
      }

      if (shownState === 3) {
        return {
          heading: 'Round Skipped',
          value: 'Skipped',
          sub: 'No entries in this round',
          metaLabel: 'Vault status',
          metaValue: 'Skipped'
        }
      }

      if (shownState === 4) {
        return {
          heading: 'Round Cancelled',
          value: 'Cancelled',
          sub: 'Redeem is available',
          metaLabel: 'Vault status',
          metaValue: 'Failed'
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

      const emptyRound = Number(shownRoundInfo?.totalTickets ?? 0) === 0 || BigInt(shownRoundInfo?.totalPrincipalMON ?? 0n) === 0n
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
        metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Settle') : 'Settle'
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
          metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Settle') : 'Settle'
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
        metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Settle') : 'Settle'
      }
    }

    if (shownState === 3) {
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
  }, [isV2Pool, isDeadRound, shownState, shownSecondsRemaining, shownCommitAfterRemaining, shownYieldAccruing, shownProgressPct, shownRoundInfo, shownSettlementSecs, shownIsCurrentRound, nextAction, currentInternalEpoch, yieldPeriod, now])

  const timerProgressPct = shownState === 0 ? shownProgressPct : shownState === 3 ? 100 : 50
  const timerIsClock = /^\d+:\d{2}:\d{2}:\d{2}$/.test(timerCard.value)

  const isUnstaking = !isV2Pool && shownState === 2 && shownSettlementSecs > 0 && shownSettlementSecs <= 86400
  const drawFinished = !isDeadRound && (shownState === 3 || isUnstaking)
  const activeRoundInfo = shownRoundInfo ?? roundInfo
  const activeRoundId = shownRoundId || roundId

  useEffect(() => {
    if (!drawFinished) setShowWinnersView(false)
  }, [drawFinished])

  const tvlMON = roundInfo ? Number(ethers.formatEther(roundInfo.totalPrincipalMON)).toFixed(4) : '...'
  const currentPrizePool = useMemo(() => {
    if (!roundInfo) return { value: '...', sub: 'Loading...' }

    if (Number(roundInfo.state) === 3) {
      return {
        value: `${Number(ethers.formatEther(roundInfo.yieldMON)).toFixed(4)} MON`,
        sub: 'Final settled yield'
      }
    }

    const principal = Number(ethers.formatEther(roundInfo.totalPrincipalMON))
    const durationSec = roundDuration || 0
    const yearSec = 365 * 24 * 60 * 60
    const apy = (Number.isFinite(estimatedApyPercent) ? estimatedApyPercent : 0) / 100
    const est = principal * apy * (durationSec / yearSec)

    return {
      value: `~${est.toFixed(4)} MON`,
      sub: `Estimated final yield @ ${estimatedApyPercent}% APY`
    }
  }, [estimatedApyPercent, roundDuration, roundInfo])

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
    if (st === 3) return '00:00:00:00'
    if (salesOpen && secondsRemaining > 0) return formatCountdown(secondsRemaining)
    return 'Awaiting settlement'
  }, [previousRoundInfo, salesOpen, secondsRemaining])

  const winnersRoundId = winnersSource?.rid || roundId
  const winnersYieldWei = winnersSource?.info?.yieldMON ? BigInt(winnersSource.info.yieldMON) : 0n
  const isWinnerWallet = !!account && !!winnersSource?.info?.winner && account.toLowerCase() === String(winnersSource.info.winner).toLowerCase()
  const canClaimPrize = isWinnerWallet && winnersYieldWei > 0n && Number(winnersSource?.info?.state ?? -1) === 3
  const canWithdrawPrincipal = !!account && winnersUserPrincipalWei > 0n && Number(winnersSource?.info?.state ?? -1) === 3

  const winnerTicketsDisplay = winnerParticipant
    ? winnerParticipant.tickets
    : Number(winnersSource?.info?.totalTickets ?? 0) > 0
      ? '—'
      : 0

  const sfxTestMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('sfxtest') === '1'

  useEffect(() => {
    const ac = new AbortController()
    const loadPrincipal = async () => {
      if (!account || !poolAddress || !winnersRoundId) {
        setWinnersUserPrincipalWei(0n)
        return
      }
      try {
        const provider = await getReadProvider()
        assertNotAborted(ac.signal)
        const pool = new ethers.Contract(poolAddress, activePoolAbi, provider)
        const v = isV2Pool
          ? (await _cached(`userPosition:${poolAddress}:${winnersRoundId}:${account}`, 5_000, () => pool.getUserPosition(BigInt(winnersRoundId), account), ac.signal))[0]
          : await _cached(`principal:${poolAddress}:${winnersRoundId}:${account}`, 5_000, () => pool.principalMON(BigInt(winnersRoundId), account), ac.signal)
        assertNotAborted(ac.signal)
        setWinnersUserPrincipalWei(BigInt(v))
      } catch (err) {
        if (!isAbortError(err)) setWinnersUserPrincipalWei(0n)
      }
    }
    loadPrincipal()
    return () => ac.abort()
  }, [account, poolAddress, winnersRoundId, activePoolAbi, isV2Pool])

  useEffect(() => {
    const ac = new AbortController()
    const loadMyRounds = async () => {
      if (!account || !poolAddresses.length) {
        setMyRounds([])
        return
      }
      try {
        const provider = await getReadProvider()
        const rowsByKey = new Map()
        const putRow = (row) => rowsByKey.set(`${String(row.poolAddr).toLowerCase()}:${row.rid}`, row)

        for (const addr of poolAddresses) {
          if (!ethers.isAddress(addr)) continue
          const pool = new ethers.Contract(addr, POOL_ABI, provider)

          let cur = 0
          try {
            cur = Number(await _cached(`currentRound:${addr}`, 10_000, () => pool.currentRoundId(), ac.signal))
          } catch (err) { if (isAbortError(err)) throw err; continue }

          const rids = []
          for (let rid = 1; rid <= cur; rid++) rids.push(rid)

          const [infos, principals] = await Promise.all([
            Promise.all(rids.map(rid =>
              getCachedRoundInfo(pool, addr, BigInt(rid), ac.signal).catch(() => null)
            )),
            Promise.all(rids.map(rid => _cached(`principal:${addr}:${rid}:${account}`, 10_000, () => pool.principalMON(BigInt(rid), account).catch(() => 0n), ac.signal)))
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
                salesEndTime: 0,
                commitAfterTime: 0,
                isWinner,
                prizeClaimed: Boolean(info.prizeClaimed),
                principalWei: principal,
                principalMon: Number(ethers.formatEther(principal)).toFixed(4),
                withdrawableShares: 0n,
                withdrawableMon: principal,
                prizeWei: BigInt(info.yieldMON || 0n),
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
          const salesEndSec = r.salesEndTime ? Math.floor(new Date(r.salesEndTime).getTime() / 1000) : 0
          const monPaidWei = BigInt(r.monPaid || '0')
          const principalWithdrawnWei = BigInt(r.principalWithdrawn || '0')
          const remainingPrincipalWei = principalWithdrawnWei >= monPaidWei ? 0n : monPaidWei - principalWithdrawnWei
          const normalizedState = isV2round
            ? (r.state === 'open' ? 0 : r.state === 'committed' ? 1 : r.state === 'settled' ? 2 : r.state === 'skipped' ? 3 : 0)
            : (r.state === 'settled' || r.state === 'skipped' ? 3 : r.state === 'drawn' || r.state === 'unstaking' ? 2 : r.state === 'committed' ? 1 : 0)
          putRow({
            rid: r.roundId,
            poolAddr: r.poolAddress,
            isV2: isV2round,
            state: normalizedState,
            salesEndTime: salesEndSec,
            commitAfterTime: salesEndSec + (isV2round ? 604800 : 0),
            isWinner: r.won === 1,
            prizeClaimed: r.prizeClaimed !== '0',
            principalWei: remainingPrincipalWei,
            principalMon: Number(ethers.formatEther(remainingPrincipalWei)).toFixed(4),
            withdrawableShares: 0n,
            withdrawableMon: null,
            prizeWei: BigInt(r.prizeClaimed || '0'),
            canWithdraw: ['settled', 'skipped'].includes(r.state) && remainingPrincipalWei > 0n,
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
  }, [account, poolAddresses, poolAddressesV2, roundId])

  const poolDisplayLabel = useCallback((addr, isV2 = false) => {
    const lc = String(addr || '').toLowerCase()
    const v2Index = poolAddressesV2.findIndex((a) => a.toLowerCase() === lc)
    if (v2Index >= 0) return v2Index === 0 ? 'Vault A' : v2Index === 1 ? 'Vault B' : `Vault ${v2Index + 1}`
    const legacyIndex = poolAddresses.findIndex((a) => a.toLowerCase() === lc)
    if (legacyIndex >= 0) return `Legacy ${legacyIndex % 2 === 0 ? 'Vault A' : 'Vault B'}`
    return isV2 ? 'Vault' : `Legacy ${shortAddr(addr)}`
  }, [poolAddresses, poolAddressesV2])

  const myRoundsStats = useMemo(() => {
    const lockedWei = myRounds
      .filter((r) => r.state !== 3)
      .reduce((acc, r) => acc + (r.principalWei || 0n), 0n)

    const claimableWei = myRounds
      .filter((r) => r.state === 3)
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
        const iface = new ethers.Interface(activePoolAbi)
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
  }, [account, expectedChainId, poolAddress, refresh, activePoolAbi])

  const handleClaimPrize = useCallback(async (rid = winnersRoundId, targetPoolAddress = poolAddress) => {
    if (!rid) return false
    return await runSignedAction('Claim prize', async (sendTx) => {
      const txHash = await sendTx('claimPrize', [BigInt(rid)], 500000n)
      setActionStatus(`Claim prize: submitted ${String(txHash).slice(0, 10)}...`)
    }, targetPoolAddress)
  }, [poolAddress, winnersRoundId, runSignedAction])

  const handleWithdraw = useCallback(async (rid = winnersRoundId, targetPoolAddress = poolAddress) => {
    if (!rid) return false
    return await runSignedAction('Withdraw', async (sendTx) => {
      const txHash = await sendTx('withdrawPrincipal', [BigInt(rid)], 500000n)
      setActionStatus(`Withdraw: submitted ${String(txHash).slice(0, 10)}... Then visit the /shmon tab to convert shMON to MON.`)
    }, targetPoolAddress)
  }, [poolAddress, winnersRoundId, runSignedAction])

  const handleWithdrawForRound = useCallback(async (rid, targetPoolAddress = poolAddress) => {
    setWithdrawingRid(`${targetPoolAddress}:${rid}`)
    try {
      await runSignedAction(`Withdraw (Round #${rid})`, async (sendTx) => {
        const txHash = await sendTx('withdrawPrincipal', [BigInt(rid)], 500000n)
        setActionStatus(`Withdraw (Round #${rid}): submitted ${String(txHash).slice(0, 10)}...`)
      }, targetPoolAddress)
    } finally {
      setWithdrawingRid(null)
    }
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
    })
  }, [poolAddress])

  const handleClaimOnly = useCallback(async () => {
    if (!claimFlow.rid) return
    if (isV2Pool) {
      const ok = await handleClaimPrize(claimFlow.rid, claimFlow.poolAddr)
      if (ok) setClaimFlow((prev) => ({ ...prev, open: false }))
      return
    }
    if (claimFlow.mode !== 'winner') {
      const ok = await handleClaimPrize(claimFlow.rid, claimFlow.poolAddr)
      if (ok) setClaimFlow((prev) => ({ ...prev, open: false }))
      return
    }
    const ok = await runSignedAction('Claim and withdraw', async (sendTx) => {
      const claimTxHash = await sendTx('claimPrize', [BigInt(claimFlow.rid)], 500000n)
      setActionStatus(`Claim prize: submitted ${String(claimTxHash).slice(0, 10)}...`)
      setActionStatus('Prize claimed, withdrawing principal...')
      const withdrawTxHash = await sendTx('withdrawPrincipal', [BigInt(claimFlow.rid)], 500000n, { nonceOffset: 1 })
      setActionStatus(`Withdraw principal: submitted ${String(withdrawTxHash).slice(0, 10)}...`)
    }, claimFlow.poolAddr)
    if (ok) setClaimFlow((prev) => ({ ...prev, open: false }))
  }, [claimFlow.mode, claimFlow.poolAddr, claimFlow.rid, handleClaimPrize, runSignedAction, isV2Pool])

  const handleWithdrawOnly = useCallback(async () => {
    const ok = await handleWithdraw(claimFlow.rid, claimFlow.poolAddr)
    if (ok) {
      setClaimFlow((prev) => ({ ...prev, open: false }))
    }
  }, [claimFlow.poolAddr, claimFlow.rid, handleWithdraw])

  const handleRedeposit = useCallback(async () => {
    if (!poolAddress) {
      setActionError('Missing pool address')
      return
    }
    if (!claimFlow.rid) {
      setActionError('Missing round to claim')
      return
    }

    const redepositTickets = ticketPrice > 0n ? claimFlow.prizeWei / ticketPrice : 0n
    const redepositValue = redepositTickets * ticketPrice

    await runSignedAction('Claim and re-deposit', async (sendTx) => {
      if (!salesOpen || !roundId) {
        throw new Error('No open vault is currently accepting deposits')
      }
      if (ticketPrice <= 0n) {
        throw new Error('Ticket price not loaded yet')
      }
      if (redepositTickets <= 0n || redepositValue <= 0n) {
        throw new Error('Prize is smaller than one ticket, so it cannot be re-deposited automatically')
      }
      if (redepositTickets > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Prize is too large to convert into a safe ticket count')
      }

      const claimTxHash = await sendTx('claimPrize', [BigInt(claimFlow.rid)], 500000n)
      setActionStatus(`Claim prize: submitted ${String(claimTxHash).slice(0, 10)}...`)

      const withdrawTxHash = await sendTx('withdrawPrincipal', [BigInt(claimFlow.rid)], 500000n, { nonceOffset: 1 })
      setActionStatus(`Withdraw principal: submitted ${String(withdrawTxHash).slice(0, 10)}...`)

      setActionStatus(`Re-deposit: buying ${redepositTickets.toString()} ticket${redepositTickets === 1n ? '' : 's'} in Round #${roundId}...`)
      const buyTxHash = await sendTx('buyTickets', [Number(redepositTickets)], 700000n, { nonceOffset: 2, value: redepositValue })
      setActionStatus(`Re-deposit: submitted ${String(buyTxHash).slice(0, 10)}...`)

      setMainView(Number(roundId) % 2 === 1 ? 'vaultA' : 'vaultB')
      setTicketCountInput(redepositTickets.toString())
      setClaimFlow((prev) => ({ ...prev, open: false }))
      setActionStatus(`Prize claimed and re-deposited into Round #${roundId}.`)
    })
  }, [poolAddress, claimFlow.rid, claimFlow.prizeWei, ticketPrice, runSignedAction, salesOpen, roundId])

  const handleWithdrawAndConvert = useCallback(() => {
    setClaimRedirectWarningOpen(true)
  }, [])

  const handleConfirmWithdrawAndConvert = useCallback(async () => {
    if (!claimFlow.rid) {
      setActionError('Missing round to withdraw')
      return
    }

    // Open a blank window synchronously while still in user-gesture context.
    // Browsers block window.open() called after await — opening now and navigating later bypasses that.
    const newWin = window.open('about:blank', '_blank', 'noreferrer')

    if (isV2Pool && claimFlow.mode === 'winner') {
      const claimOk = await handleClaimPrize(claimFlow.rid, claimFlow.poolAddr)
      if (!claimOk) { newWin?.close(); return }
      const withdrawOk = await handleWithdraw(claimFlow.rid, claimFlow.poolAddr)
      if (!withdrawOk) { newWin?.close(); return }
      if (newWin) newWin.location.href = 'https://shmonad.xyz'
      setClaimRedirectWarningOpen(false)
      setClaimFlow((prev) => ({ ...prev, open: false }))
      setActionStatus('Tickets redeemed. Opening shmonad.xyz to convert to MON...')
      return
    }

    if (isV2Pool) {
      const ok = await handleWithdraw(claimFlow.rid, claimFlow.poolAddr)
      if (!ok) { newWin?.close(); return }
      if (newWin) newWin.location.href = 'https://shmonad.xyz'
      setClaimRedirectWarningOpen(false)
      setClaimFlow((prev) => ({ ...prev, open: false }))
      setActionStatus('Tickets redeemed. Opening shmonad.xyz to convert to MON...')
      return
    }

    if (claimFlow.mode === 'winner') {
      const ok = await runSignedAction('Claim, withdraw, and convert', async (sendTx) => {
        const claimTxHash = await sendTx('claimPrize', [BigInt(claimFlow.rid)], 500000n)
        setActionStatus(`Claim prize: submitted ${String(claimTxHash).slice(0, 10)}...`)
        setActionStatus('Prize claimed, withdrawing principal...')
        const withdrawTxHash = await sendTx('withdrawPrincipal', [BigInt(claimFlow.rid)], 500000n, { nonceOffset: 1 })
        setActionStatus(`Withdraw principal: submitted ${String(withdrawTxHash).slice(0, 10)}...`)
      }, claimFlow.poolAddr)
      if (!ok) { newWin?.close(); return }
      if (newWin) newWin.location.href = 'https://shmonad.xyz'
      setClaimRedirectWarningOpen(false)
      setClaimFlow((prev) => ({ ...prev, open: false }))
      setActionStatus('Prize and principal withdrawn. Continue MON conversion in shmonad.xyz.')
      return
    }

    const ok = await handleWithdraw(claimFlow.rid)
    if (!ok) { newWin?.close(); return }
    if (newWin) newWin.location.href = 'https://shmonad.xyz'
    setClaimRedirectWarningOpen(false)
    setClaimFlow((prev) => ({ ...prev, open: false }))
    setActionStatus('Principal withdrawn. Continue MON conversion in shmonad.xyz.')
  }, [claimFlow.mode, claimFlow.rid, claimFlow.poolAddr, handleClaimPrize, handleWithdraw, isV2Pool, runSignedAction])

  const buyTicketsShmon = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setStatus('Preparing shMON approval...')

      if (!poolAddress) throw new Error('Missing V2 pool address')
      if (!isV2Pool) throw new Error('Selected pool is not V2')
      const currentSalesOpen = roundInfo && Number(roundInfo.state) === 0 && Math.max(0, Number(roundInfo.salesEndTime ?? 0) - Math.floor(Date.now() / 1000)) > 0
      if (!currentSalesOpen) throw new Error('Deposits are closed for this round')
      const walletProvider = getWalletProvider()
      if (!walletProvider) throw new Error('Wallet required')

      const n = Number(ticketCountInput)
      if (!Number.isInteger(n) || n <= 0) throw new Error('Ticket count must be a positive integer')

      const provider = new ethers.BrowserProvider(walletProvider)
      await provider.send('eth_requestAccounts', [])
      await ensureCorrectNetwork(provider, expectedChainId)
      if (!account) throw new Error('No wallet connected')

      const readProvider = await getReadProvider()
      const pool = new ethers.Contract(poolAddress, POOL_V2_ABI, readProvider)
      const shmonAddress = await _cached(`shmon:${poolAddress}`, 86400_000 * 365, () => pool.shmon())
      const ticketPriceForShares = await _cached(`ticketPrice:${poolAddress}`, 86400_000 * 365, () => pool.getFunction('ticketPriceMON').staticCall())
      const sharesOwed = BigInt(ticketPriceForShares) * BigInt(n)
      const nonce = await fetchNonceWithRetry(account)
      const feeData = await readProvider.getFeeData()
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas

      const erc20 = new ethers.Interface(ERC20_ABI)
      const v2 = new ethers.Interface(POOL_V2_ABI)

      const approveData = erc20.encodeFunctionData('approve', [poolAddress, sharesOwed])
      const buyData = v2.encodeFunctionData('buyTicketsShmon', [n])

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
      await readProvider.waitForTransaction(buyTxHash)

      setStatus('Buy with shMON successful')
      refresh().catch(() => {})
    } catch (e) {
      setStatus('')
      setError(normalizeError(e) || 'buyTicketsShmon failed')
    } finally {
      setLoading(false)
    }
  }, [account, expectedChainId, isV2Pool, poolAddress, refresh, ticketCountInput, roundInfo])


  const setMaxTickets = useCallback(() => {
    try {
      if (!ticketPrice || ticketPrice <= 0n) return
      const available = isV2Pool && buyWithShmon ? BigInt(shmonMonBalance || 0n) : ethers.parseEther(String(balance || '0'))
      const max = available / ticketPrice
      if (max > 0n) setTicketCountInput(max > 1000000n ? '1000000' : max.toString())
    } catch {
      // ignore malformed balance state
    }
  }, [balance, buyWithShmon, isV2Pool, shmonMonBalance, ticketPrice])

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

  return (
    <div className="app-shell">
      <div className="app-container">
        {showWinnersView ? (
          <WinnersView
            onBack={() => setShowWinnersView(false)}
            winner={winnersSource.info ? shortAddr(winnersSource.info.winner) : '\u2014'}
            winnerAddress={winnersSource.info ? String(winnersSource.info.winner) : ''}
            prize={
              isUnstaking && winnersSource.info
                ? `~${Number(ethers.formatEther(winnersSource.info.yieldMON || 0n)).toFixed(4)} MON (estimated)`
                : winnersSource.info
                  ? `${Number(ethers.formatEther(winnersSource.info.yieldMON)).toFixed(4)} MON`
                  : currentPrizePool.value
            }
            participants={winnersSource.participants}
            participantCount={winnersSource.participants.length}
            winnerTickets={winnerTicketsDisplay}
            totalTickets={winnersSource.info ? Number(winnersSource.info.totalTickets) : 0}
            roundNumber={Number(winnersSource.rid) || 0}
            isUnstaking={isUnstaking}
            canClaim={canClaimPrize}
            canWithdraw={canWithdrawPrincipal}
            settlementLabel={
              isUnstaking
                ? `Round finalizing — ${formatCountdown(shownSettlementSecs)} remaining`
                : Number(winnersSource?.info?.state ?? -1) === 3
                  ? 'Settled — Withdraw Available'
                  : 'Winner Revealed'
            }
            settlementCountdown={
              Number(winnersSource?.info?.state ?? -1) === 3
                ? '00:00:00:00'
                : shownSettlementSecs > 0
                  ? formatCountdown(shownSettlementSecs)
                  : previousSettlementCountdown
            }
            onClaimPrize={() => openClaimFlow({ mode: 'winner', rid: winnersRoundId, principalWei: winnersUserPrincipalWei, prizeWei: winnersYieldWei })}
            onWithdraw={() => openClaimFlow({ mode: 'principal', rid: winnersRoundId, principalWei: winnersUserPrincipalWei, prizeWei: winnersYieldWei })}
            actionBusy={actionBusy}
            actionStatus={actionStatus}
            actionError={actionError}
          />
        ) : (
          <>
            <Header account={account} onConnect={connectWallet} currentPage={currentPage} points={pointsProfile} />
            {pointsBanner ? <div className="points-banner"><span>{pointsBanner}</span><button onClick={() => setPointsBanner(null)}>×</button></div> : null}
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
          {isV2Pool ? (
            <>
              <button
                className={`vault-label ${!vaultBPending && selectedPoolAddress.toLowerCase() === poolAddressesV2[0]?.toLowerCase() ? 'active' : ''}`}
                tabIndex={-1}
                onClick={() => { setVaultBPending(false); setSelectedPoolAddress(poolAddressesV2[0]); setMainView('current') }}
              >VAULT A</button>
              <div
                className="vault-gear-track"
                onClick={() => {
                  if (poolAddressesV2.length >= 2) {
                    setVaultBPending(false)
                    setSelectedPoolAddress(
                      selectedPoolAddress.toLowerCase() === poolAddressesV2[0]?.toLowerCase()
                        ? poolAddressesV2[1]
                        : poolAddressesV2[0]
                    )
                  } else {
                    setVaultBPending((p) => !p)
                  }
                  setMainView('current')
                }}
              >
                <div className={`vault-gear-knob ${vaultBPending || selectedPoolAddress.toLowerCase() === poolAddressesV2[1]?.toLowerCase() ? 'right' : ''}`}>⚙</div>
              </div>
              <button
                className={`vault-label ${vaultBPending || selectedPoolAddress.toLowerCase() === poolAddressesV2[1]?.toLowerCase() ? 'active' : ''}`}
                tabIndex={-1}
                onClick={() => {
                  if (poolAddressesV2.length >= 2) {
                    setVaultBPending(false)
                    setSelectedPoolAddress(poolAddressesV2[1])
                  } else {
                    setVaultBPending(true)
                  }
                  setMainView('current')
                }}
              >VAULT B</button>
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
          <button className={`vault-aux-btn ${mainView === 'previous' ? 'active' : ''}`} onClick={() => setMainView('previous')} disabled={!settledRoundInfo}>Previous Vault</button>
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
                <span>#</span><span>Round / Status</span><span>Result</span><span>Principal</span><span>Prize</span><span>Action</span>
              </div>
              {myRounds.length === 0 ? (
                <div className="participants-row rounds-row">
                  <span>—</span><span>No prior rounds found for this wallet</span><span>—</span><span>0.0000 MON</span><span>—</span><span className="action-cell">—</span>
                </div>
              ) : myRounds.map((r) => {
                const myRoundStatusLabel = r.isV2
                  ? (r.state === 0
                    ? (now < r.salesEndTime
                      ? `Deposits close in ${formatCountdown(r.salesEndTime - now)}`
                      : now < r.commitAfterTime
                        ? `Yield accruing · Drawing in ${formatCountdown(r.commitAfterTime - now)}`
                        : 'Awaiting draw')
                    : r.state === 1 ? 'Drawing'
                    : r.state === 2 ? 'Settled'
                    : r.state === 3 ? 'Skipped'
                    : r.state === 4 ? 'Cancelled'
                    : 'Unknown')
                  : (r.state === 0 ? 'Accepting Deposits'
                    : r.state === 1 ? 'Draw Pending'
                    : r.state === 2 ? 'Finalizing'
                    : 'Settled')
                const myRoundResultLabel = r.isV2
                  ? (r.state < 2 ? 'Active' : r.state === 2 ? (r.isWinner ? 'Won!' : 'No win') : 'Redeem available')
                  : (r.state < 3 ? 'Locked' : (r.isWinner ? 'Winner' : 'Participant'))
                const actionLabel = r.isV2 ? (r.isWinner && !r.prizeClaimed ? 'Claim / Redeem' : 'Redeem') : 'Claim'
                const pendingActionLabel = r.isWinner ? 'Claiming...' : 'Redeeming...'
                const prizeLabel = r.isWinner
                  ? `${r.prizeClaimed ? 'Claimed' : 'Prize'}: ${Number(ethers.formatEther(r.prizeWei || 0n)).toFixed(2)} MON`
                  : '—'
                return (
                <div className="participants-row rounds-row" key={`${r.poolAddr}:${r.rid}`}>
                  <span>{r.rid}</span>
                  <span>{poolDisplayLabel(r.poolAddr, r.isV2)} {'\u00B7'} Round #{r.rid} {'\u00B7'} {myRoundStatusLabel}</span>
                  <span>{myRoundResultLabel}</span>
                  <span>{r.principalMon} MON</span>
                  <span className={r.isWinner ? (r.prizeClaimed ? 'my-rounds-prize claimed' : 'my-rounds-prize won') : 'my-rounds-prize'}>{prizeLabel}</span>
                  <span className="action-cell">
                    {r.canWithdraw ? (
                      <button
                        className="max-btn"
                        onClick={() => openClaimFlow({
                          mode: (r.isWinner && !r.prizeClaimed) ? 'winner' : 'principal',
                          rid: r.rid,
                          poolAddr: r.poolAddr,
                          principalWei: r.principalWei || 0n,
                          prizeWei: r.prizeWei || 0n,
                        })}
                        disabled={withdrawingRid === `${r.poolAddr}:${r.rid}`}
                      >
                        {withdrawingRid === `${r.poolAddr}:${r.rid}` ? pendingActionLabel : actionLabel}
                      </button>
                    ) : r.state === 0 ? (
                      r.isV2
                        ? (now < r.salesEndTime
                          ? (
                            <button
                              className="max-btn"
                              onClick={() => setMainView('current')}
                            >
                              Deposit Now
                            </button>
                          )
                          : now < r.commitAfterTime
                            ? 'Yield accruing'
                            : 'Awaiting draw')
                        : (
                          <button
                            className="max-btn"
                            onClick={() => setMainView(Number(r.rid) % 2 === 1 ? 'vaultA' : 'vaultB')}
                          >
                            Deposit Now
                          </button>
                        )
                    ) : r.state === 3 && !r.canWithdraw ? 'Done' : 'Waiting'}
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
                        step="1"
                        value={ticketCountInput}
                        onChange={(e) => setTicketCountInput(e.target.value)}
                        disabled={!shownIsCurrentRound}
                      />
                      <span className="currency-label">tickets</span>
                    </div>
                    <div className="balance-info">
                      <span>
                        Balance: {isV2Pool && buyWithShmon ? `${formatMon(shmonMonBalance)} shMON` : `${Number(balance).toFixed(4)} MON`}
                      </span>
                      <button className="max-btn" onClick={setMaxTickets}>MAX</button>
                    </div>
                  </div>

                  <div className="balance-info">
                    <span>Price / ticket</span>
                    <span>{ethers.formatEther(ticketPrice || 0n)} MON</span>
                  </div>

                  <div className="deposit-cta-wrap">
                    {isV2Pool && (
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
                      onClick={account ? (isV2Pool && buyWithShmon ? buyTicketsShmon : buyTickets) : connectWallet}
                    >
                      {loading
                        ? 'Submitting...'
                        : isDeadRound
                          ? 'Vault Cycling — Next Round Soon'
                          : !shownIsCurrentRound
                            ? 'This Vault is Locked'
                            : !salesOpen
                              ? 'Deposits closed'
                              : !account
                                ? 'Connect Wallet to Buy'
                                : wrongNetwork
                                  ? 'Wrong network — click Buy to switch automatically'
                                  : isV2Pool
                                    ? `Buy with ${buyWithShmon ? 'shMON' : 'MON'}`
                                    : canBuyTx
                                      ? 'Buy Tickets'
                                      : 'Buy Unavailable'}
                    </button>
                    {(loading || wrongNetwork || !salesOpen || !account || !shownIsCurrentRound) && buyDisabledReason ? <p className="deposit-caption">{buyDisabledReason}</p> : null}
                  </div>

                  {status ? <p className="deposit-caption">{status}</p> : null}
                  {error ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{error}</p> : null}
                </div>
              </div>
            )}

            {drawFinished ? (
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
          />
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
                value={activeRoundInfo && (Number(activeRoundInfo.state) === 3 || isUnstaking) ? shortAddr(activeRoundInfo.winner) : '\u2014'}
                sub={activeRoundInfo && (Number(activeRoundInfo.state) === 3 || isUnstaking) ? `Winning ticket: ${activeRoundInfo.winningTicket}` : 'Revealed at settlement'}
                icon={(
                  <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h12v3a4 4 0 0 1-4 4h-1v2.08A4 4 0 0 1 16 17v2H8v-2a4 4 0 0 1 3-3.87V11h-1a4 4 0 0 1-4-4V4z"/></svg>
                )}
              />
              <StatCard
                label="Total Prize Pool"
                value={
                  activeRoundInfo && Number(activeRoundInfo.state) === 3
                    ? `${Number(ethers.formatEther(activeRoundInfo.yieldMON)).toFixed(4)} MON`
                    : isUnstaking && activeRoundInfo
                      ? `~${Number(ethers.formatEther(activeRoundInfo.yieldMON || 0n)).toFixed(4)} MON (est.)`
                      : currentPrizePool.value
                }
                sub={
                  activeRoundInfo && Number(activeRoundInfo.state) === 3
                    ? 'Final settled yield'
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
          onClaimOnly={handleClaimOnly}
          onWithdrawOnly={handleWithdrawOnly}
          onRedeposit={handleRedeposit}
          onWithdrawAndConvert={handleWithdrawAndConvert}
          onBackFromRedirectWarning={() => setClaimRedirectWarningOpen(false)}
          confirmRedirectOpen={claimRedirectWarningOpen}
          onConfirmRedirect={handleConfirmWithdrawAndConvert}
          isV2={isV2Pool}
        />
      </div>
    </div>
  )
}
