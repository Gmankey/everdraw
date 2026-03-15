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
  if (!edgeConfig) return { configured: false, enabled: false, wallets: [] }

  const parsed = new URL(edgeConfig)
  const token = parsed.searchParams.get('token')
  const basePath = `${parsed.origin}${parsed.pathname}`
  const key = process.env.EDGE_CONFIG_ALLOWLIST_KEY || 'wallet_allowlist'
  const itemUrl = `${basePath}/item/${encodeURIComponent(key)}`

  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const resp = await fetch(itemUrl, { headers })
  if (!resp.ok) return { configured: false, enabled: false, wallets: [] }

  const value = await resp.json()
  if (value == null) return { configured: false, enabled: false, wallets: [] }

  if (Array.isArray(value) || typeof value === 'string') {
    return {
      configured: true,
      enabled: true,
      wallets: normalizeWallets(value),
    }
  }

  if (typeof value === 'object') {
    const enabled = value.enabled !== false
    const wallets = normalizeWallets(value.wallets || value.addresses || [])
    return { configured: true, enabled, wallets }
  }

  return { configured: false, enabled: false, wallets: [] }
}

export default async function handler(req, res) {
  try {
    const result = await fetchEdgeConfigAllowlist()
    return res.status(200).json({
      configured: result.configured,
      enabled: result.enabled,
      wallets: result.wallets,
      source: result.configured ? 'edge-config' : 'none',
    })
  } catch (err) {
    return res.status(200).json({
      configured: false,
      enabled: false,
      wallets: [],
      source: 'none',
      error: 'allowlist_unavailable',
    })
  }
}
