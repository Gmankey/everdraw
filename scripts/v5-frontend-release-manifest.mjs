#!/usr/bin/env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { getAddress } from 'ethers'

import { readActiveV5Deployment } from './keeper/v5-deployment.mjs'

function argument(name, { optional = false } = {}) {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? String(process.argv[index + 1] || '').trim() : ''
  if (!value && !optional) throw new Error(`Missing --${name}`)
  return value
}

export function buildV5FrontendManifest({ deployment, environment, rpcUrl, explorerUrl, indexerUrl, claimProofUrl = '' }) {
  const mainnet = environment === 'mainnet'
  if (!mainnet && environment !== 'uat') throw new Error('Environment must be mainnet or uat')
  const expectedChainId = mainnet ? 143 : 10143
  if (Number(deployment.chainId) !== expectedChainId) {
    throw new Error(`Deployment chain ${deployment.chainId} does not match ${environment}`)
  }
  const shmon = getAddress(deployment.constructorArgs?.shmon)
  return {
    schemaVersion: 1,
    protocolVersion: 5,
    environment,
    releaseId: `${environment}-${deployment.deployCommit.slice(0, 8)}-${deployment.startBlock}`,
    chain: {
      id: expectedChainId,
      name: mainnet ? 'Monad Mainnet' : 'Monad Testnet',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrl,
      explorerUrl,
    },
    deployment: {
      deployCommit: deployment.deployCommit,
      startBlock: deployment.startBlock,
      addresses: { ...deployment.addresses, shmon },
    },
    services: { indexerUrl, claimProofUrl },
  }
}

function main() {
  const environment = argument('environment')
  const chainId = environment === 'mainnet' ? 143 : environment === 'uat' ? 10143 : 0
  if (!chainId) throw new Error('Environment must be mainnet or uat')
  const deployment = readActiveV5Deployment(argument('deployment-file'), { expectedChainId: chainId })
  const manifest = buildV5FrontendManifest({
    deployment,
    environment,
    rpcUrl: argument('rpc-url'),
    explorerUrl: argument('explorer-url'),
    indexerUrl: argument('indexer-url'),
    claimProofUrl: argument('claim-proof-url', { optional: true }),
  })
  process.stdout.write(JSON.stringify(manifest))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error?.message || error)
    process.exit(1)
  }
}
