import { useCallback, useEffect, useState } from 'react'
import { ethers } from 'ethers'

const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL || 'https://everdraw-indexer.fly.dev').replace(/\/$/, '')

function shortAddr(addr) {
  if (!addr) return '—'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatMon(weiStr, decimals = 4) {
  if (!weiStr || weiStr === '0') return null
  try {
    const n = Number(ethers.formatEther(weiStr))
    return n.toFixed(decimals)
  } catch {
    return null
  }
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function OverviewCard({ label, value, sub }) {
  return (
    <div className="stats-overview-card">
      <div className="stats-overview-label">{label}</div>
      <div className="stats-overview-value">{value}</div>
      {sub && <div className="stats-overview-sub">{sub}</div>}
    </div>
  )
}

function YieldChart({ rounds }) {
  const settled = rounds
    .filter(r => r.state === 'settled' && r.yieldMon && r.yieldMon !== '0')
    .sort((a, b) => Number(a.roundId) - Number(b.roundId))

  if (settled.length === 0) {
    return (
      <div className="stats-chart-empty">
        No settled rounds with yield data yet
      </div>
    )
  }

  const yields = settled.map(r => {
    try { return Number(ethers.formatEther(r.yieldMon)) } catch { return 0 }
  })
  const maxYield = Math.max(...yields, 0.000001)

  const barW = 48
  const barGap = 20
  const chartH = 100
  const labelH = 30
  const totalW = settled.length * (barW + barGap) + barGap

  return (
    <div className="stats-chart-scroll">
      <svg
        width={Math.max(totalW, 200)}
        height={chartH + labelH + 20}
        style={{ display: 'block', minWidth: '100%' }}
      >
        {settled.map((r, i) => {
          const h = Math.max((yields[i] / maxYield) * chartH, 3)
          const x = barGap + i * (barW + barGap)
          const y = chartH - h
          return (
            <g key={r.roundId}>
              <rect
                x={x} y={y} width={barW} height={h}
                fill="#9b6dff" rx="4" opacity="0.8"
              />
              <text
                x={x + barW / 2} y={chartH + 18}
                textAnchor="middle" fill="#6b5f85" fontSize="12"
                fontFamily="Outfit, sans-serif"
              >
                R{r.roundId}
              </text>
              <text
                x={x + barW / 2} y={y - 5}
                textAnchor="middle" fill="#c4b5fd" fontSize="10"
                fontFamily="Outfit, sans-serif"
              >
                {yields[i].toFixed(5)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function stateBadgeClass(r) {
  if (r.isSkipped) return 'stats-badge stats-badge-skipped'
  if (r.state === 'settled') return 'stats-badge stats-badge-settled'
  if (r.state === 'open') return 'stats-badge stats-badge-open'
  return 'stats-badge stats-badge-pending'
}

function stateLabel(r) {
  if (r.isSkipped) return 'Skipped'
  if (r.state === 'settled') return 'Settled'
  if (r.state === 'open') return 'Open'
  return r.state.charAt(0).toUpperCase() + r.state.slice(1)
}

export function StatsPage({ indexerUrl = INDEXER_URL, networkLabel = 'Monad mainnet' }) {
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${indexerUrl}/api/rounds`)
      .then(r => {
        if (!r.ok) throw new Error(`Indexer returned ${r.status}`)
        return r.json()
      })
      .then(data => {
        setRounds(Array.isArray(data) ? data : [])
        setLastUpdated(new Date())
        setLoading(false)
      })
      .catch(e => {
        setError(`Could not reach indexer: ${e.message}`)
        setLoading(false)
      })
  }, [indexerUrl])

  useEffect(() => {
    const timeout = window.setTimeout(load, 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  // Only show rounds from mainnet launch (Apr 6 2026)
  const LAUNCH_DATE = new Date('2026-04-06T00:00:00Z')
  const visibleRounds = rounds.filter(r => {
    const d = r.openedAt ? new Date(r.openedAt) : null
    return d && d >= LAUNCH_DATE
  })

  // Derived stats
  const settled = visibleRounds.filter(r => r.state === 'settled' && !r.isSkipped)
  const active = visibleRounds.find(r => r.state === 'open')

  const totalDeposited = settled.reduce((sum, r) => {
    try { return sum + Number(ethers.formatEther(r.totalMonPaid)) } catch { return sum }
  }, 0)

  const totalPrizes = settled.reduce((sum, r) => {
    try { return sum + Number(ethers.formatEther(r.yieldMon)) } catch { return sum }
  }, 0)

  const uniqueWinners = new Set(settled.map(r => r.winner).filter(Boolean)).size

  return (
    <div className="stats-page">

      <div className="stats-hero">
        <h2 className="stats-title">Protocol Stats</h2>
        <p className="stats-subtitle">
          Live on-chain data · {networkLabel}
          {lastUpdated && (
            <span className="stats-timestamp">
              {' '}· Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </p>
        <button className="stats-refresh-btn" onClick={load} disabled={loading}>
          {loading ? 'Loading...' : '↻ Refresh'}
        </button>
      </div>

      {error && <div className="stats-error">{error}</div>}

      {!error && (
        <>
          <div className="stats-cards-grid">
            <OverviewCard
              label="Total Rounds"
              value={visibleRounds.length}
              sub="Since launch"
            />
            <OverviewCard
              label="Settled Rounds"
              value={settled.length}
              sub="Completed with prize"
            />
            <OverviewCard
              label="MON Deposited"
              value={`${totalDeposited.toFixed(4)} MON`}
              sub="Across settled rounds"
            />
            <OverviewCard
              label="Total Prizes Paid"
              value={`${totalPrizes.toFixed(6)} MON`}
              sub="Yield distributed to winners"
            />
            <OverviewCard
              label="Unique Winners"
              value={uniqueWinners || '—'}
              sub="Distinct wallets"
            />
            <OverviewCard
              label="Current Round"
              value={active ? `#${active.roundId}` : '—'}
              sub={active ? `Closes ${formatDate(active.salesEndTime)}` : 'No open round'}
            />
          </div>

          <div className="stats-section">
            <div className="stats-section-header">
              <h3>Yield Per Settled Round (MON)</h3>
              <span className="stats-section-note">Actual on-chain yield distributed</span>
            </div>
            <div className="stats-chart-wrap">
              <YieldChart rounds={visibleRounds} />
            </div>
          </div>

          <div className="stats-section">
            <div className="stats-section-header">
              <h3>Round History</h3>
              <span className="stats-section-note">{visibleRounds.length} rounds since launch</span>
            </div>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Opened</th>
                    <th>Status</th>
                    <th>Tickets</th>
                    <th>Deposited</th>
                    <th>Prize (Yield)</th>
                    <th>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: '#6b5f85' }}>
                        Loading rounds...
                      </td>
                    </tr>
                  ) : visibleRounds.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: '#6b5f85' }}>
                        No rounds since launch yet
                      </td>
                    </tr>
                  ) : visibleRounds.map(r => {
                    const deposited = formatMon(r.totalMonPaid)
                    const prize = formatMon(r.yieldMon, 6)
                    return (
                      <tr key={r.roundId}>
                        <td className="stats-td-num">{r.roundId}</td>
                        <td>{formatDate(r.openedAt)}</td>
                        <td><span className={stateBadgeClass(r)}>{stateLabel(r)}</span></td>
                        <td className="stats-td-num">{r.ticketCount || '—'}</td>
                        <td>{deposited ? `${deposited} MON` : '—'}</td>
                        <td>{prize ? `${prize} MON` : '—'}</td>
                        <td>
                          {r.winner
                            ? (
                              <a
                                href={`https://monadexplorer.com/address/${r.winner}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="stats-winner-link"
                              >
                                {shortAddr(r.winner)}
                              </a>
                            )
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
