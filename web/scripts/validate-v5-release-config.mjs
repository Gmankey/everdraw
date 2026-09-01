#!/usr/bin/env node
import process from 'node:process'
import { loadEnv } from 'vite'

import { v5ReleaseConfigFromEnv } from '../src/v5ReleaseConfig.js'
import { resolveWalletConnectProjectId } from '../src/walletProjectId.js'

try {
  const mode = process.env.MODE || process.env.NODE_ENV || 'production'
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const config = v5ReleaseConfigFromEnv(env)
  resolveWalletConnectProjectId({
    projectId: env.VITE_WALLETCONNECT_PROJECT_ID,
    chainId: config?.chainId ?? Number(env.VITE_CHAIN_ID || 143),
    production: mode === 'production',
  })
  if (config) {
    console.log(`[v5-release] ${config.environment} manifest ${config.releaseId} validated for chain ${config.chainId}`)
  }
} catch (error) {
  console.error(`[v5-release] ${error?.message || error}`)
  process.exit(1)
}
