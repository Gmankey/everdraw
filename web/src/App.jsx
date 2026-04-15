import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ethers } from 'ethers'
import VaultAnimationTest from './components/VaultAnimationTest'
import ShmonPanel from './ShmonPanel'
import { StatsPage } from './Stats.jsx'
import { modal } from './walletModal.ts'
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
  'function roundDurationSec() view returns (uint32)',
  'function shmon() view returns (address)',
  'function buyTickets(uint32 ticketCount) payable',
  'function claimPrize(uint256 rid)',
  'function withdrawPrincipal(uint256 rid)',
  'function principalMON(uint256 rid, address user) view returns (uint256)',
  'event RoundStarted(uint256 indexed roundId, uint64 salesEndTime)',
  'event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)'
]

const ACTION_LABELS = ['None', 'Skip', 'Commit', 'Draw', 'Settle', 'Recommit']
const STATE_LABELS = ['Open', 'Committed', 'Finalizing', 'Settled']

const SHMON_ABI = [
  'function getInternalEpoch() view returns (uint64)'
]

function parsePoolAddresses() {
  const rawList = import.meta.env.VITE_POOL_ADDRESSES
  const single = import.meta.env.VITE_POOL_ADDRESS

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

function hexChainIdToDec(hexId) {
  if (!hexId) return null
  return Number.parseInt(hexId, 16)
}

function shortAddr(addr) {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
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

// Nonce management removed — wallet (MetaMask/Rabby) handles nonces correctly.
// Manual nonce injection caused persistent "invalid value for value.nonce" errors
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

function Header({ account, onConnect, currentPage }) {
  return (
    <header>
      <div className="logo">
        <img src="/favicon.png" alt="EverDraw" className="logo-img" />
        EverDraw
      </div>
      <nav className="nav-links">
        <a href="#vault" className={`nav-link ${currentPage === 'vault' ? 'active' : ''}`}>Vault</a>
        <a href="#shmon" className={`nav-link ${currentPage === 'shmon' ? 'active' : ''}`}>shMON</a>
        <a href="#stats" className={`nav-link ${currentPage === 'stats' ? 'active' : ''}`}>Stats</a>
        <a href="https://docs.everdraw.xyz" target="_blank" rel="noopener noreferrer" className="nav-link">Docs</a>
        <a href="https://x.com/everdrawing" target="_blank" rel="noopener noreferrer" className="nav-link nav-link-x" aria-label="X / Twitter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
      </nav>
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

function ClaimFlowModal({ open, mode, busy, status, error, onClose, onClaimOnly, onWithdrawOnly, onRedeposit, onWithdrawAndConvert, onBackFromRedirectWarning, confirmRedirectOpen, onConfirmRedirect }) {
  if (!open) return null

  const isWinner = mode === 'winner'
  const heroEyebrow = ''
  const heroTitle = 'How do you want to claim this round?'
  const heroBody = ''

  const options = isWinner
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
    return 'vault'
  })
  useEffect(() => {
    function onHashChange() {
      if (window.location.hash === '#stats') setCurrentPage('stats')
      else if (window.location.hash === '#shmon') setCurrentPage('shmon')
      else setCurrentPage('vault')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const poolAddresses = useMemo(() => parsePoolAddresses(), [])
  const [selectedPoolAddress, setSelectedPoolAddress] = useState(poolAddresses[0] || '')
  const poolAddress = selectedPoolAddress

  const expectedChainId = import.meta.env.VITE_CHAIN_ID ? Number(import.meta.env.VITE_CHAIN_ID) : 143
  const estimatedApyPercent = import.meta.env.VITE_ESTIMATED_APY_PERCENT ? Number(import.meta.env.VITE_ESTIMATED_APY_PERCENT) : 12
  const poolDeployBlock = import.meta.env.VITE_POOL_DEPLOY_BLOCK ? Number(import.meta.env.VITE_POOL_DEPLOY_BLOCK) : 0
  const configuredDepositWindowSec = import.meta.env.VITE_DEPOSIT_WINDOW_SEC ? Number(import.meta.env.VITE_DEPOSIT_WINDOW_SEC) : 86400

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
  const unlockAudioRef = useRef(null)
  const doorAudioRef = useRef(null)

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
        const pool = new ethers.Contract(addr, POOL_ABI, provider)
        const rid = await pool.currentRoundId()
        const info = await pool.getRoundInfo(rid)
        const state = Number(info.state)
        const salesEndTime = Number(info.salesEndTime)
        const secs = Math.max(0, salesEndTime - Math.floor(Date.now() / 1000))
        return {
          poolAddress: addr,
          roundId: rid.toString(),
          state,
          stateLabel: STATE_LABELS[state] ?? 'Unknown',
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
  }, [poolAddresses])

  const refresh = useCallback(async () => {
    if (!poolAddress) return
    if (!ethers.isAddress(poolAddress)) {
      throw new Error('Invalid VITE_POOL_ADDRESS. Use a 0x... contract address.')
    }
    const provider = await getReadProvider()
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider)

    const [
      rid,
      nextExecutable,
      price,
      duration,
      latestBlock,
      network,
      shmonAddr,
      accountBalance,
    ] = await Promise.all([
      pool.currentRoundId(),
      pool.nextExecutable(),
      pool.ticketPriceMON(),
      pool.roundDurationSec(),
      provider.getBlockNumber(),
      provider.getNetwork(),
      pool.shmon().catch(() => ethers.ZeroAddress),
      account ? provider.getBalance(account).catch(() => null) : Promise.resolve(null),
    ])

    const info = await pool.getRoundInfo(rid)

    setRoundId(rid.toString())
    setRoundInfo(info)
    setNextAction(Number(nextExecutable?.[1] ?? 0))
    setTicketPrice(price)
    setRoundDuration(Number(duration))
    setLatestBlockNumber(Number(latestBlock))
    setConnectedChainId(Number(network.chainId))

    if (accountBalance != null) {
      setBalance(ethers.formatEther(accountBalance))
    }

    try {
      if (ethers.isAddress(shmonAddr) && shmonAddr !== ethers.ZeroAddress) {
        const shmon = new ethers.Contract(shmonAddr, SHMON_ABI, provider)
        const ep = await shmon.getInternalEpoch()
        setCurrentInternalEpoch(Number(ep))
      }
    } catch {
      // Keep fallback timers if epoch endpoint is unavailable.
    }

    if (Number(rid) > 0) {
      const prevRid = Number(rid) - 1
      const prevInfo = await pool.getRoundInfo(BigInt(prevRid))
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
      const results = await Promise.all(scanRids.map((r) => pool.getRoundInfo(BigInt(r)).catch(() => null)))
      for (let i = 0; i < results.length; i++) {
        const si = results[i]
        if (si && Number(si.state) === 3 && Number(si.totalTickets) > 0) {
          sRid = scanRids[i]
          sInfo = si
          break
        }
      }
    }
    if (sRid) settledRidCacheRef.current = sRid
    setSettledRoundId(sRid ? String(sRid) : '0')
    if (sInfo) setSettledRoundInfo(sInfo)
    else setSettledRoundInfo(null)
    if (!sRid) setSettledParticipants([])
  }, [account, poolAddress])

  useEffect(() => {
    if (!poolAddress) return
    refresh().catch((e) => setError(normalizeError(e) || 'Failed to load round data'))
    refreshVaultSummaries().catch(() => {})

    const clockTick = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)

    let vaultTick = 0
    const dataRefresh = setInterval(() => {
      refresh().catch(() => {})
      if (vaultTick % 2 === 0) refreshVaultSummaries().catch(() => {})
      vaultTick += 1
    }, 30000)

    return () => {
      clearInterval(clockTick)
      clearInterval(dataRefresh)
    }
  }, [poolAddress, refresh, refreshVaultSummaries])

  const loadParticipantsForView = useCallback(async (view) => {
    if (!poolAddress || !ethers.isAddress(poolAddress)) return

    const currentRidNum = Number(roundId) || 0
    const prevRidNum = Number(previousRoundId) || 0
    const vaultARoundIdNum = currentRidNum % 2 === 1 ? currentRidNum : prevRidNum
    const vaultARoundInfoValue = currentRidNum % 2 === 1 ? roundInfo : previousRoundInfo
    const vaultBRoundIdNum = currentRidNum % 2 === 0 ? currentRidNum : prevRidNum
    const vaultBRoundInfoValue = currentRidNum % 2 === 0 ? roundInfo : previousRoundInfo

    let targetRoundId = 0
    let targetInfo = null
    let setter = null

    if (view === 'vaultA') {
      targetRoundId = vaultARoundIdNum
      targetInfo = vaultARoundInfoValue
      setter = setParticipants
    } else if (view === 'vaultB') {
      targetRoundId = vaultBRoundIdNum
      targetInfo = vaultBRoundInfoValue
      setter = setPreviousParticipants
    } else if (view === 'previous') {
      targetRoundId = Number(settledRoundId) || 0
      targetInfo = settledRoundInfo
      setter = setSettledParticipants
    } else {
      return
    }

    if (!targetRoundId || !targetInfo) {
      setter?.([])
      return
    }

    const cacheKey = `${poolAddress.toLowerCase()}:${targetRoundId}`
    const cached = participantsCacheRef.current.get(cacheKey)
    if (cached) {
      setter(cached)
      return
    }

    const inflightKey = `${view}:${cacheKey}`
    if (participantLoadRef.current.key === inflightKey) return
    participantLoadRef.current.key = inflightKey

    try {
      const provider = await getReadProvider()
      const pool = new ethers.Contract(poolAddress, POOL_ABI, provider)
      const step = 100
      const estimatedBlocksPerSecond = 2
      const scanBufferBlocks = 1000
      const latestBlock = Number(await provider.getBlockNumber())
      const deployFloor = poolDeployBlock > 0 ? poolDeployBlock : 0
      const contractDepositWindowSec = Number(roundDuration || 0)
      const fallbackDepositWindowSec = Math.min(86400, Math.max(0, configuredDepositWindowSec || 0))
      const depositWindowSec = Math.min(86400, Math.max(contractDepositWindowSec, fallbackDepositWindowSec))

      const getRoundStartBlock = async () => {
        let searchFrom = deployFloor
        let searchTo = latestBlock

        if (targetInfo?.salesEndTime) {
          const salesEnd = Number(targetInfo.salesEndTime)
          const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000) - salesEnd)
          const estimatedSalesEndBlock = Math.max(deployFloor, latestBlock - Math.ceil(secondsAgo * estimatedBlocksPerSecond))
          const depositWindowBlocks = Math.ceil(depositWindowSec * estimatedBlocksPerSecond)
          searchFrom = Math.max(deployFloor, estimatedSalesEndBlock - depositWindowBlocks - scanBufferBlocks)
          searchTo = Math.min(latestBlock, estimatedSalesEndBlock + scanBufferBlocks)
        }

        for (let from = searchFrom; from <= searchTo; from += step) {
          const to = Math.min(searchTo, from + step - 1)
          try {
            const events = await pool.queryFilter(pool.filters.RoundStarted(BigInt(targetRoundId)), from, to)
            if (events.length > 0) return Number(events[0].blockNumber)
          } catch {
            continue
          }
        }

        return null
      }

      const byWallet = new Map()
      const ingestLogs = (logs) => {
        for (const log of logs) {
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

      const roundStartBlock = await getRoundStartBlock()
      let scanFrom = deployFloor
      let scanTo = latestBlock

      if (roundStartBlock != null) {
        const depositWindowBlocks = Math.ceil(depositWindowSec * estimatedBlocksPerSecond)
        scanFrom = Math.max(deployFloor, roundStartBlock)
        scanTo = Math.min(latestBlock, roundStartBlock + depositWindowBlocks + scanBufferBlocks)
      }

      for (let from = scanFrom; from <= scanTo; from += step) {
        const to = Math.min(scanTo, from + step - 1)
        try {
          const chunk = await pool.queryFilter(pool.filters.TicketsBought(BigInt(targetRoundId)), from, to)
          ingestLogs(chunk)
        } catch {
          continue
        }
      }

      const totalTicketsNum = Number(targetInfo.totalTickets ?? 0)
      if (byWallet.size === 0 && totalTicketsNum > 0 && (scanFrom !== deployFloor || scanTo !== latestBlock)) {
        for (let from = deployFloor; from <= latestBlock; from += step) {
          const to = Math.min(latestBlock, from + step - 1)
          try {
            const chunk = await pool.queryFilter(pool.filters.TicketsBought(BigInt(targetRoundId)), from, to)
            ingestLogs(chunk)
          } catch {
            continue
          }
        }
      }

      const built = [...byWallet.values()]
        .map((p) => ({
          wallet: p.wallet,
          walletShort: shortAddr(p.wallet),
          tickets: p.tickets,
          sharePct: totalTicketsNum > 0 ? ((p.tickets / totalTicketsNum) * 100).toFixed(2) : '0.00',
          depositedMon: Number(ethers.formatEther(p.depositedWei)).toFixed(4),
        }))
        .sort((a, b) => b.tickets - a.tickets)

      participantsCacheRef.current.set(cacheKey, built)
      setter(built)
    } catch {
      setter([])
    } finally {
      if (participantLoadRef.current.key === inflightKey) {
        participantLoadRef.current.key = ''
      }
    }
  }, [poolAddress, roundId, previousRoundId, roundInfo, previousRoundInfo, settledRoundId, settledRoundInfo, poolDeployBlock, roundDuration])

  useEffect(() => {
    if (mainView === 'myrounds') return
    loadParticipantsForView(mainView).catch(() => {})
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
      const signer = await provider.getSigner(account)
      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer)

      const value = ticketPrice * BigInt(n)
      if (value === 0n) throw new Error('Ticket price not loaded yet — please wait a moment and try again')

      setStatus('Estimating gas...')
      let gasLimit
      try {
        const estimate = await pool.buyTickets.estimateGas(n, { value })
        gasLimit = (estimate * 3n) / 2n  // 1.5x buffer
      } catch (estErr) {
        // Surface the actual revert reason from the contract
        const reason = estErr?.reason || estErr?.shortMessage || estErr?.message || 'unknown'
        throw new Error(`Transaction would fail: ${reason}`)
      }

      setStatus('Waiting for wallet confirmation...')
      const tx = await pool.buyTickets(n, { value, gasLimit })
      setStatus(`Submitted: ${tx.hash.slice(0, 10)}... waiting for confirmation...`)

      await tx.wait()
      setStatus('Buy successful')
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
  }, [expectedChainId, poolAddress, refresh, ticketCountInput, ticketPrice])

  const secondsRemaining = useMemo(() => {
    if (!roundInfo) return 0
    return Math.max(0, Number(roundInfo.salesEndTime) - now)
  }, [now, roundInfo])

  const depositWindowSec = useMemo(() => {
    const fallback = Math.min(86400, Math.max(0, configuredDepositWindowSec || 86400))
    return fallback || 86400
  }, [configuredDepositWindowSec])

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

  const shownRoundId = mainView === 'vaultA' ? vaultARoundId
    : mainView === 'vaultB' ? vaultBRoundId
    : mainView === 'previous' ? settledRoundId
    : roundId
  const shownRoundInfo = mainView === 'vaultA' ? vaultARoundInfo
    : mainView === 'vaultB' ? vaultBRoundInfo
    : mainView === 'previous' ? settledRoundInfo
    : roundInfo
  const shownParticipants = mainView === 'vaultA' ? vaultAParticipants
    : mainView === 'vaultB' ? vaultBParticipants
    : mainView === 'previous' ? settledParticipants
    : participants
  const shownIsCurrentRound = shownRoundId === roundId
  const shownState = shownRoundInfo ? Number(shownRoundInfo.state) : -1
  const shownVaultLabel = mainView === 'vaultA' ? 'Vault A' : mainView === 'vaultB' ? 'Vault B' : 'Previous Vault'
  const wrongNetwork = expectedChainId && connectedChainId && expectedChainId !== connectedChainId
  const shownSecondsRemaining = shownRoundInfo ? Math.max(0, Number(shownRoundInfo.salesEndTime ?? 0) - now) : 0
  const shownSalesOpen = shownState === 0 && shownSecondsRemaining > 0
  const salesOpen = shownIsCurrentRound ? shownSalesOpen : isOpenState && secondsRemaining > 0
  const canBuyTx = !!account && shownIsCurrentRound && shownSalesOpen && !loading

  const buyDisabledReason = useMemo(() => {
    if (loading) return 'Transaction in progress'
    if (!shownIsCurrentRound) return 'Deposits are only available in the active vault'
    if (!shownSalesOpen) {
      if (shownState !== 0) return 'Sales not open in this vault state'
      return 'Sales window closed; waiting for keeper processing'
    }
    if (!account) return 'Connect wallet to deposit'
    if (wrongNetwork) return 'Wrong network — click Buy to switch automatically'
    return ''
  }, [loading, shownIsCurrentRound, shownSalesOpen, shownState, account, wrongNetwork])

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

  // Must be declared before timerCard to avoid temporal dead zone
  const isDeadRound = shownState === 3 && Number(shownRoundInfo?.totalTickets ?? 0) === 0

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

      return {
        heading: 'Yield Accruing',
        value: '00:00:00',
        sub: 'Deposits closed — funds are earning yield while awaiting draw',
        metaLabel: 'Next action',
        metaValue: shownIsCurrentRound ? (ACTION_LABELS[nextAction] ?? 'Commit') : 'Commit'
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
  }, [isDeadRound, shownState, shownSecondsRemaining, shownProgressPct, shownRoundInfo, shownSettlementSecs, shownIsCurrentRound, nextAction, currentInternalEpoch])

  const timerProgressPct = shownState === 0 ? shownProgressPct : shownState === 3 ? 100 : 50
  const timerIsClock = /^\d+:\d{2}:\d{2}:\d{2}$/.test(timerCard.value)

  const isUnstaking = shownState === 2 && shownSettlementSecs > 0 && shownSettlementSecs <= 86400
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
    let cancelled = false
    const loadPrincipal = async () => {
      if (!account || !poolAddress || !winnersRoundId) {
        if (!cancelled) setWinnersUserPrincipalWei(0n)
        return
      }
      try {
        const provider = await getReadProvider()
        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider)
        const v = await pool.principalMON(BigInt(winnersRoundId), account)
        if (!cancelled) setWinnersUserPrincipalWei(BigInt(v))
      } catch {
        if (!cancelled) setWinnersUserPrincipalWei(0n)
      }
    }
    loadPrincipal()
    return () => { cancelled = true }
  }, [account, poolAddress, winnersRoundId])

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
          const pool = new ethers.Contract(addr, POOL_ABI, provider)

          let cur = 0
          try {
            cur = Number(await pool.currentRoundId())
          } catch {
            continue
          }

          const fromRid = Math.max(0, cur - 10)
          for (let rid = fromRid; rid <= cur; rid++) {
            let info
            try {
              info = await pool.getRoundInfo(BigInt(rid))
            } catch {
              continue
            }

            let principal = 0n
            try {
              principal = await pool.principalMON(BigInt(rid), account)
            } catch {
              principal = 0n
            }

            const isWinner = account.toLowerCase() === String(info.winner || '').toLowerCase()
            if (principal > 0n || isWinner) {
              rows.push({
                rid,
                poolAddr: addr,
                state: Number(info.state),
                isWinner,
                prizeClaimed: Boolean(info.prizeClaimed),
                principalWei: principal,
                principalMon: Number(ethers.formatEther(principal)).toFixed(4),
                yieldWei: BigInt(info.yieldMON || 0n),
                canWithdraw: Number(info.state) === 3 && principal > 0n,
              })
            }
          }
        }

        rows.sort((a, b) => {
          if (b.rid !== a.rid) return b.rid - a.rid
          return a.poolAddr.localeCompare(b.poolAddr)
        })
        if (!cancelled) setMyRounds(rows)
      } catch {
        if (!cancelled) setMyRounds([])
      }
    }
    loadMyRounds()
    return () => { cancelled = true }
  }, [account, poolAddresses, roundId])

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

      const walletProvider = getWalletProvider()
      if (!walletProvider) throw new Error('Wallet required')
      if (!targetPoolAddress) throw new Error('Missing pool address')
      if (!account) throw new Error('No wallet connected')

      const provider = new ethers.BrowserProvider(walletProvider)
      await ensureCorrectNetwork(provider, expectedChainId)
      const signer = await provider.getSigner(account)
      const pool = new ethers.Contract(targetPoolAddress, POOL_ABI, signer)

      await fn(pool)
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
  }, [account, expectedChainId, poolAddress, refresh])

  const handleClaimPrize = useCallback(async (rid = winnersRoundId, targetPoolAddress = poolAddress) => {
    if (!rid) return false
    return await runSignedAction('Claim prize', async (pool) => {
      const tx = await pool.claimPrize(BigInt(rid), { gasLimit: 500000n })
      setActionStatus(`Claim prize: submitted ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
    }, targetPoolAddress)
  }, [poolAddress, winnersRoundId, runSignedAction])

  const handleWithdraw = useCallback(async (rid = winnersRoundId, targetPoolAddress = poolAddress) => {
    if (!rid) return false
    return await runSignedAction('Withdraw', async (pool) => {
      const tx = await pool.withdrawPrincipal(BigInt(rid), { gasLimit: 500000n })
      setActionStatus(`Withdraw: submitted ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
    }, targetPoolAddress)
  }, [poolAddress, winnersRoundId, runSignedAction])

  const handleWithdrawForRound = useCallback(async (rid, targetPoolAddress = poolAddress) => {
    setWithdrawingRid(`${targetPoolAddress}:${rid}`)
    try {
      await runSignedAction(`Withdraw (Round #${rid})`, async (pool) => {
        const tx = await pool.withdrawPrincipal(BigInt(rid), { gasLimit: 500000n })
        setActionStatus(`Withdraw (Round #${rid}): submitted ${tx.hash.slice(0, 10)}...`)
        await tx.wait()
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
    if (claimFlow.mode !== 'winner') {
      const ok = await handleClaimPrize(claimFlow.rid, claimFlow.poolAddr)
      if (ok) setClaimFlow((prev) => ({ ...prev, open: false }))
      return
    }
    const ok = await runSignedAction('Claim and withdraw', async (pool) => {
      const claimTx = await pool.claimPrize(BigInt(claimFlow.rid), { gasLimit: 500000n })
      setActionStatus(`Claim prize: submitted ${claimTx.hash.slice(0, 10)}...`)
      await claimTx.wait()
      setActionStatus('Prize claimed, withdrawing principal...')
      const withdrawTx = await pool.withdrawPrincipal(BigInt(claimFlow.rid), { gasLimit: 500000n })
      setActionStatus(`Withdraw principal: submitted ${withdrawTx.hash.slice(0, 10)}...`)
      await withdrawTx.wait()
    }, claimFlow.poolAddr)
    if (ok) setClaimFlow((prev) => ({ ...prev, open: false }))
  }, [claimFlow.mode, claimFlow.poolAddr, claimFlow.rid, handleClaimPrize, runSignedAction])

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

    await runSignedAction('Claim and re-deposit', async (pool) => {
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

      const claimTx = await pool.claimPrize(BigInt(claimFlow.rid), { gasLimit: 500000n })
      setActionStatus(`Claim prize: submitted ${claimTx.hash.slice(0, 10)}...`)
      await claimTx.wait()

      const withdrawTx = await pool.withdrawPrincipal(BigInt(claimFlow.rid), { gasLimit: 500000n })
      setActionStatus(`Withdraw principal: submitted ${withdrawTx.hash.slice(0, 10)}...`)
      await withdrawTx.wait()

      setActionStatus(`Re-deposit: buying ${redepositTickets.toString()} ticket${redepositTickets === 1n ? '' : 's'} in Round #${roundId}...`)
      const buyTx = await pool.buyTickets(Number(redepositTickets), {
        value: redepositValue,
        gasLimit: 700000n,
      })
      setActionStatus(`Re-deposit: submitted ${buyTx.hash.slice(0, 10)}...`)
      await buyTx.wait()

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

    if (claimFlow.mode === 'winner') {
      const ok = await runSignedAction('Claim, withdraw, and convert', async (pool) => {
        const claimTx = await pool.claimPrize(BigInt(claimFlow.rid), { gasLimit: 500000n })
        setActionStatus(`Claim prize: submitted ${claimTx.hash.slice(0, 10)}...`)
        await claimTx.wait()
        setActionStatus('Prize claimed, withdrawing principal...')
        const withdrawTx = await pool.withdrawPrincipal(BigInt(claimFlow.rid), { gasLimit: 500000n })
        setActionStatus(`Withdraw principal: submitted ${withdrawTx.hash.slice(0, 10)}...`)
        await withdrawTx.wait()
      }, claimFlow.poolAddr)

      if (!ok) return

      window.open('https://shmonad.xyz', '_blank', 'noopener,noreferrer')
      setClaimRedirectWarningOpen(false)
      setClaimFlow((prev) => ({ ...prev, open: false }))
      setActionStatus('Prize and principal withdrawn. Continue MON conversion in shmonad.xyz.')
      return
    }

    const ok = await handleWithdraw(claimFlow.rid)

    if (!ok) return

    window.open('https://shmonad.xyz', '_blank', 'noopener,noreferrer')
    setClaimRedirectWarningOpen(false)
    setClaimFlow((prev) => ({ ...prev, open: false }))
    setActionStatus('Principal withdrawn. Continue MON conversion in shmonad.xyz.')
  }, [claimFlow.mode, claimFlow.rid, handleClaimPrize, handleWithdraw])

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
            <Header account={account} onConnect={connectWallet} currentPage={currentPage} />
        {currentPage === 'stats' ? <StatsPage /> : null}
            {currentPage === 'vault' && (<>


        <h1>
          Win the Pot.
          <br />
          Or keep your lot.
        </h1>

        <section className="vault-bar">
          <button className={`vault-label ${mainView === 'vaultA' ? 'active' : ''}`} tabIndex={-1} onClick={() => setMainView('vaultA')}>VAULT A</button>
          <div className="vault-gear-track" onClick={() => setMainView(mainView === 'vaultA' ? 'vaultB' : 'vaultA')}>
            <div className={`vault-gear-knob ${mainView === 'vaultB' ? 'right' : ''}`}>⚙</div>
          </div>
          <button className={`vault-label ${mainView === 'vaultB' ? 'active' : ''}`} tabIndex={-1} onClick={() => setMainView('vaultB')}>VAULT B</button>
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
            <div className="participants-table">
              <div className="participants-row participants-header">
                <span>#</span><span>Round / Status</span><span>Result</span><span>Principal</span><span>Action</span>
              </div>
              {myRounds.length === 0 ? (
                <div className="participants-row">
                  <span>—</span><span>No prior rounds found for this wallet</span><span>—</span><span>0.0000 MON</span><span>—</span>
                </div>
              ) : myRounds.map((r) => {
                const myRoundStatusLabel = r.state === 0 ? 'Accepting Deposits'
                  : r.state === 1 ? 'Draw Pending'
                  : r.state === 2 ? 'Finalizing'
                  : 'Settled'
                const myRoundResultLabel = r.state < 3 ? 'Locked' : (r.isWinner ? 'Winner' : 'Participant')
                const actionLabel = 'Claim'
                const pendingActionLabel = r.isWinner ? 'Claiming...' : 'Claiming principal...'
                return (
                <div className="participants-row" key={r.rid}>
                  <span>{r.rid}</span>
                  <span>Round #{r.rid} {'\u00B7'} {myRoundStatusLabel}</span>
                  <span>{myRoundResultLabel}</span>
                  <span>{r.principalMon} MON</span>
                  <span>
                    {r.canWithdraw ? (
                      <button
                        className="max-btn"
                        onClick={() => openClaimFlow({
                          mode: (r.isWinner && !r.prizeClaimed) ? 'winner' : 'principal',
                          rid: r.rid,
                          poolAddr: r.poolAddr,
                          principalWei: r.principalWei || 0n,
                          prizeWei: r.yieldWei || 0n,
                        })}
                        disabled={withdrawingRid === `${r.poolAddr}:${r.rid}`}
                      >
                        {withdrawingRid === `${r.poolAddr}:${r.rid}` ? pendingActionLabel : actionLabel}
                      </button>
                    ) : r.state === 0 ? (
                      <button
                        className="max-btn"
                        onClick={() => setMainView(Number(r.rid) % 2 === 1 ? 'vaultA' : 'vaultB')}
                      >
                        Deposit Now
                      </button>
                    ) : r.state === 3 && !r.canWithdraw ? 'Done' : 'Waiting'}
                  </span>
                </div>
              )})}
            </div>
          </section>
        ) : (
          <section className="main-grid">
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
                    disabled={!shownIsCurrentRound || loading || !salesOpen}
                    onClick={account ? buyTickets : connectWallet}
                  >
                    {isDeadRound
                      ? 'Vault Cycling — Next Round Soon'
                      : !shownIsCurrentRound
                      ? 'This Vault is Locked'
                      : loading
                        ? 'Submitting...'
                        : !salesOpen
                          ? 'Buy Unavailable'
                          : !account
                            ? 'Connect Wallet to Deposit'
                            : wrongNetwork
                              ? 'Wrong network — click Buy to switch automatically'
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
        />
      </div>
    </div>
  )
}
