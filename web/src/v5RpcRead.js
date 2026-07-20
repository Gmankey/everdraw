const TRANSIENT_CODES = new Set([
  'CALL_EXCEPTION',
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'TIMEOUT',
  'UNKNOWN_ERROR',
])

export const V5_NETWORK_RETRY_MESSAGE = 'Network hiccup. Retrying automatically...'

export function isTransientRpcError(error) {
  const code = String(error?.code || '').toUpperCase()
  const message = `${error?.shortMessage || ''} ${error?.message || ''}`.toLowerCase()
  return TRANSIENT_CODES.has(code)
    || message.includes('missing revert data')
    || message.includes('failed to fetch')
    || message.includes('network error')
    || message.includes('could not coalesce error')
    || message.includes('connection')
    || message.includes('timeout')
    || message.includes('429')
}

export async function withRpcReadRetry(read, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3))
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 500))
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      lastError = error
      if (!isTransientRpcError(error) || attempt === attempts) throw error
      options.onRetry?.({ attempt, error })
      await sleep(baseDelayMs * (2 ** (attempt - 1)))
    }
  }

  throw lastError
}

export function v5UserError(error, fallback = 'Something went wrong. Please try again.') {
  const code = Number(error?.code)
  const message = String(error?.shortMessage || error?.message || '')
  const lower = message.toLowerCase()
  if (code === 4001 || lower.includes('user rejected') || lower.includes('user denied')) return ''
  if (isTransientRpcError(error)) return V5_NETWORK_RETRY_MESSAGE
  if (message === 'Connect wallet first' || message === 'Insufficient balance' || message === 'shMON deposit amount is too small') return message
  return fallback
}
