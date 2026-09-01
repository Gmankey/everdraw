const PLACEHOLDER_PROJECT_IDS = new Set([
  'demo-project-id',
  'your-project-id',
  'replace-me',
])

export function resolveWalletConnectProjectId({ projectId, chainId, production }) {
  const normalized = String(projectId || '').trim()
  const placeholder = PLACEHOLDER_PROJECT_IDS.has(normalized.toLowerCase())
  if (production && Number(chainId) === 143 && (!normalized || placeholder)) {
    throw new Error('A real VITE_WALLETCONNECT_PROJECT_ID is required for a Monad mainnet build')
  }
  return normalized || 'demo-project-id'
}
