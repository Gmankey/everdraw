function normalizeWallets(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((s) => s.trim())

  const seen = new Set()
  const out = []
  for (const entry of arr) {
    const addr = String(entry || '').trim().toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(addr)) continue
    if (seen.has(addr)) continue
    seen.add(addr)
    out.push(addr)
  }
  return out
}

async function fetchEdgeConfigAllowlist() {
  const edgeConfig = process.env.EDGE_CONFIG
  const key = process.env.EDGE_CONFIG_ALLOWLIST_KEY || 'wallet_allowlist'

  if (!edgeConfig) {
    return { configured: false, enabled: false, wallets: [], debug: { hasEdgeConfigEnv: false, key } }
  }

  let parsed
  try {
    parsed = new URL(edgeConfig)
  } catch {
    return { configured: false, enabled: false, wallets: [], debug: { hasEdgeConfigEnv: true, invalidEdgeConfigUrl: true, key } }
  }

  const token = parsed.searchParams.get('token')
  const basePath = `${parsed.origin}${parsed.pathname}`
  const itemUrl = `${basePath}/item/${encodeURIComponent(key)}`

  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const resp = await fetch(itemUrl, { headers })
  if (!resp.ok) {
    return {
      configured: false,
      enabled: false,
      wallets: [],
      debug: {
        hasEdgeConfigEnv: true,
        key,
        fetchStatus: resp.status,
        fetchOk: false,
      },
    }
  }

  const value = await resp.json()
  if (value == null) {
    return {
      configured: false,
      enabled: false,
      wallets: [],
      debug: { hasEdgeConfigEnv: true, key, fetchOk: true, valueIsNull: true },
    }
  }

  if (Array.isArray(value) || typeof value === 'string') {
    return {
      configured: true,
      enabled: true,
      wallets: normalizeWallets(value),
      debug: { hasEdgeConfigEnv: true, key, fetchOk: true, shape: typeof value === 'string' ? 'string' : 'array' },
    }
  }

  if (typeof value === 'object') {
    const enabled = value.enabled !== false
    const wallets = normalizeWallets(value.wallets || value.addresses || [])
    return {
      configured: true,
      enabled,
      wallets,
      debug: { hasEdgeConfigEnv: true, key, fetchOk: true, shape: 'object', walletCount: wallets.length },
    }
  }

  return {
    configured: false,
    enabled: false,
    wallets: [],
    debug: { hasEdgeConfigEnv: true, key, fetchOk: true, unsupportedType: typeof value },
  }
}

export default async function handler(req, res) {
  try {
    const result = await fetchEdgeConfigAllowlist()
    return res.status(200).json({
      configured: result.configured,
      enabled: result.enabled,
      wallets: result.wallets,
      source: result.configured ? 'edge-config' : 'none',
      debug: result.debug,
    })
  } catch (err) {
    return res.status(200).json({
      configured: false,
      enabled: false,
      wallets: [],
      source: 'none',
      error: 'allowlist_unavailable',
      debug: {
        hasEdgeConfigEnv: !!process.env.EDGE_CONFIG,
        key: process.env.EDGE_CONFIG_ALLOWLIST_KEY || 'wallet_allowlist',
        message: err?.message || 'unknown',
      },
    })
  }
}
