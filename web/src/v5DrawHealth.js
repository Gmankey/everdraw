export function buildV5DrawHealth({ state, nowMs = Date.now() }) {
  const blockTime = Number(state?.block?.timestamp || 0)
  const readAtMs = Number(state?.readAtMs || 0)
  const nextPeriodStart = Number(state?.nextPeriodStart || 0n)
  const drawPeriod = Number(state?.drawPeriod || 0n)
  const isLoading = blockTime <= 0 || nextPeriodStart <= 0 || drawPeriod <= 0
  if (isLoading) {
    return { secondsRemaining: 0, isLoading, isStarting: false, isStalled: false }
  }

  const liveDriftSeconds = readAtMs > 0 ? Math.max(0, (Number(nowMs) - readAtMs) / 1000) : 0
  const now = blockTime + liveDriftSeconds
  const dueAt = nextPeriodStart + drawPeriod
  const secondsRemaining = dueAt - now
  const isDue = Boolean(state?.preview?.due) || (dueAt > 0 && secondsRemaining <= 0)
  const overdueSeconds = isDue ? Math.max(0, -secondsRemaining) : 0
  const lastAdvancedAtMs = Number(state?.lastDrawAdvancedAtMs || 0)
  const recentlyAdvanced = lastAdvancedAtMs > 0
    && Number(nowMs) - lastAdvancedAtMs <= drawPeriod * 2 * 1000
  const isStalled = isDue && drawPeriod > 0 && overdueSeconds > drawPeriod && !recentlyAdvanced

  return { secondsRemaining, isLoading, isStarting: isDue && !isStalled, isStalled }
}
