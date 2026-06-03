// Shared frontend RPC cache helpers.
// ADR-0009 invariant: dedupe pending Promises and let callers abort stale view reads.

export const _rpcCache = new Map()

export function abortError() {
  try {
    return new DOMException('Aborted', 'AbortError')
  } catch {
    const e = new Error('Aborted')
    e.name = 'AbortError'
    return e
  }
}

export function isAbortError(err) {
  return err?.name === 'AbortError'
}

export function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError()
}

export function withAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true })
    }),
  ])
}

export function _cached(key, ttlMs, fetcher, signal) {
  const hit = _rpcCache.get(key)
  if (hit?.value && typeof hit.value.then === 'function') return withAbort(hit.value, signal)
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.value)
  if (signal?.aborted) return Promise.reject(abortError())

  const p = Promise.resolve()
    .then(() => fetcher({ signal: undefined }))
    .then((v) => { _rpcCache.set(key, { value: v, ts: Date.now() }); return v })
    .catch((err) => {
      if (_rpcCache.get(key)?.value === p) _rpcCache.delete(key)
      throw err
    })

  _rpcCache.set(key, { value: p, ts: Date.now() })
  return withAbort(p, signal)
}

function toPlainRpcObject(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value
}

export async function getCachedRoundInfo(pool, poolAddress, rid, signal) {
  const key = `roundInfo:${poolAddress}:${rid}`
  const hit = _rpcCache.get(key)
  if (hit?.value && typeof hit.value.then === 'function') return withAbort(hit.value, signal)
  if (hit && hit.value) {
    const isSettled = Number(hit.value.state) === 3
    if (isSettled || (Date.now() - hit.ts < 8_000)) return hit.value
  }

  if (signal?.aborted) return Promise.reject(abortError())

  const p = Promise.resolve()
    .then(() => pool.getRoundInfo(rid))
    .then((info) => {
      const plainInfo = toPlainRpcObject(info)
      _rpcCache.set(key, { value: plainInfo, ts: Date.now() })
      return plainInfo
    })
    .catch((err) => {
      if (_rpcCache.get(key)?.value === p) _rpcCache.delete(key)
      throw err
    })

  _rpcCache.set(key, { value: p, ts: Date.now() })
  return withAbort(p, signal)
}
