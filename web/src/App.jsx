import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import VaultAnimationTest from './components/VaultAnimationTest'
import './App.css'

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

function Header({ account, onConnect }) {
  return (
    <header>
      <div className="logo">EverDraw</div>
      <nav className="nav-links">
        <a href="#" className="nav-link active">Vault</a>
        <a href="#" className="nav-link">Governance</a>
        <a href="#" className="nav-link">Docs</a>
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

function WinnersView({ onBack, winner, prize, participants, participantCount, winnerTickets, canClaim, canWithdraw, settlementLabel, settlementCountdown, onClaimPrize, onWithdraw, actionBusy, actionStatus, actionError }) {
  return (
    <div className="winners-view-page">
      <div className="winners-back-wrap">
        <button className="back-link" onClick={onBack}>← Back to Vault</button>
      </div>

      <div className="winners-hero">
        <h2>Draw Complete</h2>
        <p>{settlementLabel}</p>
      </div>

      <div className="winner-spotlight-card">
        <div className="winner-address">{winner}</div>
        <div className="winner-stats">
          <div>
            <span>Prize Won</span>
            <strong>{prize}</strong>
          </div>
          <div>
            <span>Ticket Count</span>
            <strong>{typeof winnerTickets === 'number' ? winnerTickets.toLocaleString() : winnerTickets}</strong>
          </div>
        </div>
        {canClaim ? <button className="btn" onClick={onClaimPrize} disabled={actionBusy}>Claim Prize</button> : null}
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
              <span>—</span><span>No participants indexed yet</span><span>0</span><span>0.00%</span><span>0.0000 MON</span>
            </div>
          ) : participants.map((p, i) => (
            <div className="participants-row" key={`${p.wallet}-${i}`}>
              <span>{i + 1}</span><span>{p.walletShort}</span><span>{p.tickets.toLocaleString()}</span><span>{p.sharePct}%</span><span>{p.depositedMon} MON</span>
            </div>
          ))}
        </div>
      </div>

      <div className="winners-actions-grid">
        <button className="btn ghost-btn" onClick={onWithdraw} disabled={actionBusy || !canWithdraw}>
          {canWithdraw ? 'Withdraw Tokens' : `Withdraw Tokens (${settlementCountdown})`}
        </button>
      </div>

      {actionStatus ? <p className="deposit-caption">{actionStatus}</p> : null}
      {actionError ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{actionError}</p> : null}
    </div>
  )
}

export default function App() {
  const poolAddresses = useMemo(() => parsePoolAddresses(), [])
  const [selectedPoolAddress, setSelectedPoolAddress] = useState(poolAddresses[0] || '')
  const poolAddress = selectedPoolAddress

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
  const [actionStatus, setActionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const [myRounds, setMyRounds] = useState([])
  const [vaultSummaries, setVaultSummaries] = useState([])
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

    const rid = await pool.currentRoundId()
    const info = await pool.getRoundInfo(rid)
    const [, action] = await pool.nextExecutable()
    const price = await pool.ticketPriceMON()
    const duration = await pool.roundDurationSec()

    setRoundId(rid.toString())
    setRoundInfo(info)
    setNextAction(Number(action))
    setTicketPrice(price)
    setRoundDuration(Number(duration))

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

      const totalTicketsNum = Number(totalTicketsRaw ?? 0)
      return [...byWallet.values()]
        .map((p) => ({
          wallet: p.wallet,
          walletShort: shortAddr(p.wallet),
          tickets: p.tickets,
          sharePct: totalTicketsNum > 0 ? ((p.tickets / totalTicketsNum) * 100).toFixed(2) : '0.00',
          depositedMon: Number(ethers.formatEther(p.depositedWei)).toFixed(4),
        }))
        .sort((a, b) => b.tickets - a.tickets)
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
  }, [account, poolAddress, poolDeployBlock])

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
      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer)

      const value = ticketPrice * BigInt(n)
      const tx = await pool.buyTickets(n, { value })
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
  }, [expectedChainId, poolAddress, refresh, ticketCountInput, ticketPrice])

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
  const canBuyTx = !!account && !wrongNetwork && salesOpen && !loading

  const buyDisabledReason = useMemo(() => {
    if (loading) return 'Transaction in progress'
    if (!salesOpen) {
      if (!isOpenState) return 'Sales not open in current round state'
      return 'Sales window closed; waiting for keeper processing'
    }
    if (!account) return 'Connect wallet to deposit'
    if (wrongNetwork) return `Wrong network (need ${expectedChainId})`
    return ''
  }, [loading, salesOpen, isOpenState, account, wrongNetwork, expectedChainId])

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
  }, [currentState, nextAction, progressPct, secondsRemaining, roundInfo, settlementSecondsRemaining, currentInternalEpoch])

  const timerProgressPct = currentState === 0 ? progressPct : currentState === 3 ? 100 : 50
  const timerIsClock = /^\d+:\d{2}:\d{2}:\d{2}$/.test(timerCard.value)
  const drawFinished = currentState === 3 || (currentState >= 2 && !!roundInfo && roundInfo.winner !== ethers.ZeroAddress)
  const previousRoundVisible = previousRoundInfo && Number(previousRoundInfo.totalTickets) > 0 && Number(previousRoundInfo.state) >= 2
  const activeRoundInfo = mainView === 'previous' && previousRoundInfo ? previousRoundInfo : roundInfo
  const activeRoundId = mainView === 'previous' && previousRoundInfo ? previousRoundId : roundId

  useEffect(() => {
    if (!drawFinished && !previousRoundVisible) setShowWinnersView(false)
  }, [drawFinished, previousRoundVisible])

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

  const winnersSource = mainView === 'previous' && previousRoundInfo
    ? { rid: previousRoundId, info: previousRoundInfo, participants: previousParticipants }
    : drawFinished
      ? { rid: roundId, info: roundInfo, participants }
      : previousRoundVisible
        ? { rid: previousRoundId, info: previousRoundInfo, participants: previousParticipants }
        : { rid: roundId, info: roundInfo, participants }

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
      if (!account || !poolAddress || !roundId) {
        if (!cancelled) setMyRounds([])
        return
      }
      try {
        const provider = await getReadProvider()
        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider)
        const cur = Number(roundId)
        const rows = []

        // Scan a wider range so older participation still appears in "My Rounds".
        const fromRid = Math.max(0, cur - 120)
        for (let rid = fromRid; rid <= cur; rid++) {
          let info
          try {
            info = await pool.getRoundInfo(BigInt(rid))
          } catch {
            continue
          }

          // Some states/contracts may revert here; treat as 0 so one bad round doesn't wipe the list.
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
              state: Number(info.state),
              isWinner,
              principalMon: Number(ethers.formatEther(principal)).toFixed(4),
              canWithdraw: Number(info.state) === 3 && principal > 0n,
            })
          }
        }
        rows.sort((a, b) => b.rid - a.rid)
        if (!cancelled) setMyRounds(rows)
      } catch {
        if (!cancelled) setMyRounds([])
      }
    }
    loadMyRounds()
    return () => { cancelled = true }
  }, [account, poolAddress, roundId])

  const runSignedAction = useCallback(async (label, fn) => {
    try {
      setActionBusy(true)
      setActionError('')
      setActionStatus(`${label}: preparing...`)

      if (!window.ethereum) throw new Error('Wallet required')
      if (!poolAddress) throw new Error('Missing pool address')

      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const network = await provider.getNetwork()
      if (expectedChainId && Number(network.chainId) !== expectedChainId) {
        throw new Error(`Wrong network: connected ${Number(network.chainId)}, expected ${expectedChainId}`)
      }
      const signer = await provider.getSigner()
      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer)
      await fn(pool)
      await refresh()
      setActionStatus(`${label}: success ✅`)
    } catch (e) {
      setActionStatus('')
      setActionError(normalizeError(e) || `${label} failed`)
    } finally {
      setActionBusy(false)
    }
  }, [expectedChainId, poolAddress, refresh])

  const handleClaimPrize = useCallback(async () => {
    if (!winnersRoundId) return
    await runSignedAction('Claim prize', async (pool) => {
      const tx = await pool.claimPrize(BigInt(winnersRoundId))
      setActionStatus(`Claim prize: submitted ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
    })
  }, [winnersRoundId, runSignedAction])

  const handleWithdraw = useCallback(async () => {
    if (!winnersRoundId) return
    await runSignedAction('Withdraw', async (pool) => {
      const tx = await pool.withdrawPrincipal(BigInt(winnersRoundId))
      setActionStatus(`Withdraw: submitted ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
    })
  }, [winnersRoundId, runSignedAction])

  const handleWithdrawForRound = useCallback(async (rid) => {
    await runSignedAction(`Withdraw (Round #${rid})`, async (pool) => {
      const tx = await pool.withdrawPrincipal(BigInt(rid))
      setActionStatus(`Withdraw (Round #${rid}): submitted ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
    })
  }, [runSignedAction])

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
            prize={winnersSource.info ? `${Number(ethers.formatEther(winnersSource.info.yieldMON)).toFixed(4)} MON` : currentPrizePool.value}
            participants={winnersSource.participants}
            participantCount={winnersSource.participants.length}
            winnerTickets={winnerTicketsDisplay}
            canClaim={canClaimPrize}
            canWithdraw={canWithdrawPrincipal}
            settlementLabel={Number(winnersSource?.info?.state ?? -1) === 3 ? 'Settled — Withdraw Available' : 'Winner Drawn - Vault Awaiting Settlement'}
            settlementCountdown={previousSettlementCountdown}
            onClaimPrize={handleClaimPrize}
            onWithdraw={handleWithdraw}
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
        <Header account={account} onConnect={connectWallet} />

        {vaultSummaries.length > 1 ? (
          <section className="vault-switcher">
            {vaultSummaries.map((v) => (
              <button
                key={v.poolAddress}
                className={`vault-switch-card ${v.poolAddress.toLowerCase() === poolAddress.toLowerCase() ? 'active' : ''}`}
                onClick={() => setSelectedPoolAddress(v.poolAddress)}
              >
                <div className="vault-switch-title">
                  <span>{shortAddr(v.poolAddress)}</span>
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
              ) : myRounds.map((r) => (
                <div className="participants-row" key={r.rid}>
                  <span>{r.rid}</span>
                  <span>Round #{r.rid} · {STATE_LABELS[r.state] || 'Unknown'}</span>
                  <span>{r.isWinner ? 'Winner' : 'Participant'}</span>
                  <span>{r.principalMon} MON</span>
                  <span>
                    {r.canWithdraw ? (
                      <button
                        className="max-btn"
                        onClick={() => handleWithdrawForRound(r.rid)}
                        disabled={actionBusy}
                      >
                        {actionBusy ? 'Withdrawing...' : 'Withdraw'}
                      </button>
                    ) : 'Waiting'}
                  </span>
                </div>
              ))}
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
                    disabled={mainView !== 'current' || loading || wrongNetwork || !salesOpen}
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
                            : wrongNetwork
                              ? `Wrong network (need ${expectedChainId})`
                              : canBuyTx
                                ? 'Buy Tickets'
                                : 'Buy Unavailable'}
                  </button>
                  {(loading || wrongNetwork || !salesOpen || !account || mainView !== 'current') && buyDisabledReason ? <p className="deposit-caption">{buyDisabledReason}</p> : null}
                </div>

                {status ? <p className="deposit-caption">{status}</p> : null}
                {error ? <p className="deposit-caption" style={{ color: '#ff8ea1' }}>{error}</p> : null}
              </div>
            </div>

            {(mainView === 'previous' || drawFinished) ? (
              <VaultAnimationTest onComplete={() => setShowWinnersView(true)} />
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

        <section className="stats-grid two-col">
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
            value={activeRoundInfo && Number(activeRoundInfo.state) === 3 ? `${Number(ethers.formatEther(activeRoundInfo.yieldMON)).toFixed(4)} MON` : currentPrizePool.value}
            sub={activeRoundInfo && Number(activeRoundInfo.state) === 3 ? 'Final settled yield' : currentPrizePool.sub}
            icon={(
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17h2.59l3.7-3.71 3 3L17.59 11H20v2h-1.59l-6.12 6.12-3-3L7 18.41V21H3v-4zM14 3h7v7h-2V6.41l-5.29 5.3-1.42-1.42 5.3-5.29H14V3z"/></svg>
            )}
          />
        </section>
      </div>
    </div>
  )
}
