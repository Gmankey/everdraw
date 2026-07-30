export class V5RuntimeAlertPolicy {
  constructor({
    crashThreshold = 3,
    crashWindowMs = 60_000,
    repeatMs = 60 * 60_000,
  } = {}) {
    this.crashThreshold = crashThreshold
    this.crashWindowMs = crashWindowMs
    this.repeatMs = repeatMs
    this.nonZeroExits = []
    this.lastAlertAt = new Map()
  }

  observeLine(line, now = Date.now()) {
    if (line.includes('CLAIM_QUARANTINED')) {
      const claimKey = line.match(/key=([^ ]+)/)?.[1] || line.trim()
      const alertKey = `claim-quarantined:${claimKey}`
      return this.#dedupe(alertKey, now)
        ? { key: alertKey, message: line.trim(), failureHealthcheck: false }
        : null
    }

    if (!line.includes('LOW_BALANCE_WARNING') && !line.includes('keeper balance low:')) return null
    return this.#dedupe('low-balance', now)
      ? { key: 'low-balance', message: line.trim(), failureHealthcheck: true }
      : null
  }

  observeExit(code, now = Date.now()) {
    if (code === 0) {
      this.nonZeroExits = []
      return null
    }

    this.nonZeroExits.push(now)
    this.nonZeroExits = this.nonZeroExits.filter((at) => now - at <= this.crashWindowMs)
    if (this.nonZeroExits.length < this.crashThreshold) return null
    return this.#dedupe('crash-loop', now)
      ? {
          key: 'crash-loop',
          message: `keeper-v5 exited non-zero ${this.nonZeroExits.length} times within ${this.crashWindowMs}ms (latest code=${code})`,
          failureHealthcheck: true,
        }
      : null
  }

  #dedupe(key, now) {
    const last = this.lastAlertAt.get(key) || 0
    if (last && now - last < this.repeatMs) return false
    this.lastAlertAt.set(key, now)
    return true
  }
}
