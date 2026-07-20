function unix(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

export function trancheParticipatedInDraw(tranche, draw) {
  if (String(tranche?.pool_type || '').toLowerCase() !== 'vault') return false

  const drawStart = unix(draw?.openedAt)
  const drawEnd = unix(draw?.salesEndTime) ?? unix(draw?.settledAt)
  const openedAt = unix(tranche?.opened_at)
  const closedAt = unix(tranche?.closed_at)

  if (drawStart != null && drawEnd != null && openedAt != null) {
    return openedAt < drawEnd && (closedAt == null || closedAt > drawStart)
  }

  const drawId = Number(draw?.roundId)
  const startDrawId = Number(tranche?.start_draw_id)
  return tranche?.start_draw_id != null
    && Number.isFinite(drawId) && Number.isFinite(startDrawId) && startDrawId <= drawId && closedAt == null
}

export function walletParticipatedInDraw(draw, tranches, prizeWin = null) {
  if (prizeWin) return true
  return (Array.isArray(tranches) ? tranches : []).some((tranche) => trancheParticipatedInDraw(tranche, draw))
}
