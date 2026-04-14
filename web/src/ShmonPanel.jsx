import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { EPOCH_SECONDS_ESTIMATE, formatDuration, formatUnits, useShmon } from './useShmon'

function parseInput(value) {
  try {
    if (!value || Number(value) <= 0) return 0n
    return ethers.parseEther(value)
  } catch {
    return null
  }
}

function Toast({ message, kind = 'success', onClose }) {
  if (!message) return null
  return (
    <div className={`shmon-toast ${kind}`}>
      <span>{message}</span>
      <button type="button" className="shmon-inline-btn" onClick={onClose}>Dismiss</button>
    </div>
  )
}

export default function ShmonPanel({ account, expectedChainId, getReadProvider, ensureCorrectNetwork, onConnect }) {
  const {
    loading,
    error,
    success,
    balance,
    monEquivalent,
    previewRedeem,
    epoch,
    pendingSummary,
    txBusy,
    refresh,
    requestUnstake,
    instantRedeem,
    completeUnstake,
    previewScheduledAssets,
    previewInstantAssets,
  } = useShmon({ account, expectedChainId, getReadProvider, ensureCorrectNetwork })

  const [instantInput, setInstantInput] = useState('')
  const [scheduledInput, setScheduledInput] = useState('')
  const [instantPreview, setInstantPreview] = useState(0n)
  const [scheduledPreview, setScheduledPreview] = useState(0n)
  const [localError, setLocalError] = useState('')
  const [showResetWarning, setShowResetWarning] = useState(false)
  const [dismissedSuccess, setDismissedSuccess] = useState('')

  const instantShares = useMemo(() => parseInput(instantInput), [instantInput])
  const scheduledShares = useMemo(() => parseInput(scheduledInput), [scheduledInput])

  useEffect(() => {
    let active = true
    if (instantShares && instantShares > 0n) {
      previewInstantAssets(instantShares).then((out) => {
        if (active) setInstantPreview(out)
      }).catch(() => {
        if (active) setInstantPreview(0n)
      })
    } else {
      setInstantPreview(0n)
    }
    return () => { active = false }
  }, [instantShares, previewInstantAssets])

  useEffect(() => {
    let active = true
    if (scheduledShares && scheduledShares > 0n) {
      previewScheduledAssets(scheduledShares).then((out) => {
        if (active) setScheduledPreview(out)
      }).catch(() => {
        if (active) setScheduledPreview(0n)
      })
    } else {
      setScheduledPreview(0n)
    }
    return () => { active = false }
  }, [scheduledShares, previewScheduledAssets])

  const effectiveError = localError || error
  const showSuccess = success && success !== dismissedSuccess ? success : ''

  async function handleInstant() {
    setLocalError('')
    if (!account) return onConnect?.()
    if (instantShares == null || instantShares <= 0n) return setLocalError('Enter a valid shMON amount')
    if (instantShares > balance) return setLocalError('Amount exceeds available shMON balance')
    await instantRedeem(instantShares)
    setInstantInput('')
    setDismissedSuccess('')
  }

  async function confirmScheduled() {
    setShowResetWarning(false)
    setLocalError('')
    if (scheduledShares == null || scheduledShares <= 0n) return setLocalError('Enter a valid shMON amount')
    if (scheduledShares > balance) return setLocalError('Amount exceeds available shMON balance')
    await requestUnstake(scheduledShares)
    setScheduledInput('')
    setDismissedSuccess('')
  }

  function handleScheduledClick() {
    setLocalError('')
    if (!account) return onConnect?.()
    if (scheduledShares == null || scheduledShares <= 0n) return setLocalError('Enter a valid shMON amount')
    if (scheduledShares > balance) return setLocalError('Amount exceeds available shMON balance')
    if (pendingSummary) {
      setShowResetWarning(true)
      return
    }
    confirmScheduled().catch(() => {})
  }

  async function handleComplete() {
    setLocalError('')
    await completeUnstake()
    setDismissedSuccess('')
  }

  const pendingCombined = pendingSummary && scheduledShares && scheduledShares > 0n
    ? pendingSummary.shares + scheduledShares
    : pendingSummary?.shares || 0n

  return (
    <section className="shmon-panel">
      <div className="card shmon-hero-card">
        <div>
          <div className="shmon-eyebrow">shMON direct unstake</div>
          <h2>Manage shMON to MON conversion directly</h2>
          <p className="shmon-copy">
            No EverDraw contracts here. This tab talks straight to shMON so users can instant unstake with spread,
            or schedule a free unstake and come back after the epoch wait.
          </p>
        </div>
        <div className="shmon-actions-row">
          <button type="button" className="secondary-btn" onClick={refresh} disabled={loading || txBusy}>Refresh</button>
          {!account && <button type="button" className="primary-btn" onClick={onConnect}>Connect wallet</button>}
        </div>
      </div>

      <Toast message={effectiveError} kind="error" onClose={() => setLocalError('')} />
      <Toast message={showSuccess} kind="success" onClose={() => setDismissedSuccess(success)} />

      <div className="shmon-grid">
        <div className="card shmon-card">
          <div className="section-label">Available</div>
          <div className="shmon-balance">{formatUnits(balance, 4)} shMON</div>
          <div className="shmon-subline">≈ {formatUnits(monEquivalent, 4)} MON</div>
          <div className="shmon-subline muted">Instant preview for full balance: {formatUnits(previewRedeem, 4)} MON</div>
          <div className="shmon-subline muted">Current internal epoch: {epoch ?? '—'}</div>
        </div>

        <div className="card shmon-card">
          <div className="section-label">Instant unstake</div>
          <p className="shmon-copy small">Fast exit via <code>redeem(shares, user, user)</code>. Expect roughly ~0.975% spread.</p>
          <label className="shmon-label">Amount (shMON)</label>
          <input className="shmon-input" inputMode="decimal" value={instantInput} onChange={(e) => setInstantInput(e.target.value)} placeholder="0.0" />
          <div className="shmon-preview">You receive: ≈ {formatUnits(instantPreview, 4)} MON</div>
          <button type="button" className="primary-btn" onClick={handleInstant} disabled={txBusy || loading}>Instant unstake</button>
        </div>

        <div className="card shmon-card">
          <div className="section-label">Scheduled unstake</div>
          <p className="shmon-copy small">Free exit path via <code>requestUnstake(shares)</code>, then <code>completeUnstake()</code> after ~18 to 22 hours.</p>
          <label className="shmon-label">Amount (shMON)</label>
          <input className="shmon-input" inputMode="decimal" value={scheduledInput} onChange={(e) => setScheduledInput(e.target.value)} placeholder="0.0" />
          <div className="shmon-preview">Estimated MON at completion: ≈ {formatUnits(scheduledPreview, 4)} MON</div>
          <div className="shmon-subline muted">Timing estimate uses ~{formatDuration(EPOCH_SECONDS_ESTIMATE)} epochs, actual ready time is about 18 to 22 hours.</div>
          <button type="button" className="primary-btn" onClick={handleScheduledClick} disabled={txBusy || loading}>Request scheduled unstake</button>
        </div>
      </div>

      <div className="card shmon-card pending-card">
        <div className="section-label">Pending unstake</div>
        {!pendingSummary && <div className="shmon-copy small muted">No pending scheduled unstake tracked for this wallet yet.</div>}
        {pendingSummary && (
          <>
            <div className="pending-row"><span>Pending amount</span><strong>{formatUnits(pendingSummary.shares, 4)} shMON</strong></div>
            <div className="pending-row"><span>Ready in</span><strong>{pendingSummary.isReady ? 'ready now' : `~${formatDuration(pendingSummary.secondsRemaining)}`}</strong></div>
            <div className="pending-row"><span>Completion epoch</span><strong>{pendingSummary.completionEpoch}</strong></div>
            <button type="button" className="primary-btn" disabled={!pendingSummary.isReady || txBusy} onClick={handleComplete}>Complete unstake</button>
          </>
        )}
      </div>

      {showResetWarning && pendingSummary && (
        <div className="shmon-modal-backdrop">
          <div className="card shmon-modal danger">
            <div className="section-label">Reset timer warning</div>
            <p className="shmon-copy">
              ⚠️ You already have {formatUnits(pendingSummary.shares, 4)} shMON unstaking, ready in {pendingSummary.isReady ? 'ready now' : `~${formatDuration(pendingSummary.secondsRemaining)}`}.
              Requesting a new unstake will reset the timer on your full pending amount ({formatUnits(pendingCombined, 4)} shMON) back to ~18 to 22 hours. Are you sure?
            </p>
            <div className="shmon-actions-row end">
              <button type="button" className="secondary-btn" onClick={() => setShowResetWarning(false)} autoFocus>Cancel</button>
              <button type="button" className="danger-btn" onClick={() => confirmScheduled().catch(() => {})}>Yes, reset timer</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
