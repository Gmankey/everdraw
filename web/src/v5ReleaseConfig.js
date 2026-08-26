import { ethers } from 'ethers'

const REQUIRED_CONTRACTS = [
  'drawManager',
  'prizeVault',
  'twabController',
  'claimManager',
  'shmonStrategy',
  'pythRandomnessOracle',
]

const CODE_ADDRESSES = [...REQUIRED_CONTRACTS, 'shmon']

export const V5_UAT_RELEASE_MANIFEST = {
  schemaVersion: 1,
  protocolVersion: 5,
  environment: 'uat',
  releaseId: 'uat-d9e85267-52978375',
  chain: {
    id: 10143,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    explorerUrl: 'https://testnet.monadexplorer.com',
  },
  deployment: {
    deployCommit: 'd9e85267d9024a0b036d72918c3aabbfdfde0960',
    startBlock: 52978375,
    addresses: {
      drawManager: '0x6e00D2ff59C494a6BC786Ec06f68229e33f6dF11',
      prizeVault: '0xC64F9F01f87Dd03ba069D93bE764751F9A21c9ae',
      twabController: '0x0039A79B7AbfB9b4C13BE31fd85ede14b0A054c4',
      claimManager: '0x42f00a926844a20BFB7E957Cd5277De9625CA2D9',
      shmonStrategy: '0x9295559E1ADdA7320Efc0826877e9220ec8A842f',
      pythRandomnessOracle: '0x20690C60E51d894e59a61171b2c2A6AEC7F75B3f',
      shmon: '0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9',
    },
  },
  services: {
    indexerUrl: 'https://everdraw-indexer-uat.fly.dev',
    claimProofUrl: '',
  },
}

function requiredString(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`Missing ${label}`)
  return normalized
}

function positiveInteger(value, label) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new Error(`Invalid ${label}: ${value}`)
  return normalized
}

function httpsUrl(value, label, { optional = false } = {}) {
  const normalized = String(value || '').trim()
  if (!normalized && optional) return ''
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`Invalid ${label}`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use https`)
  return parsed.toString().replace(/\/$/, '')
}

function address(value, label) {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`Invalid ${label}`)
  return ethers.getAddress(value)
}

export function parseV5ReleaseManifest(raw, { expectedEnvironment } = {}) {
  const manifest = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw)
  if (manifest?.schemaVersion !== 1) throw new Error('Unsupported V5 release manifest schema')
  if (manifest?.protocolVersion !== 5) throw new Error('Unsupported V5 protocol version')
  if (!['uat', 'mainnet'].includes(manifest?.environment)) throw new Error('Invalid V5 release environment')
  if (expectedEnvironment && manifest.environment !== expectedEnvironment) {
    throw new Error(`V5 release environment ${manifest.environment} does not match ${expectedEnvironment}`)
  }

  const chainId = positiveInteger(manifest.chain?.id, 'V5 chain id')
  if (manifest.environment === 'uat' && chainId !== 10143) throw new Error('UAT manifest must use Monad testnet chain 10143')
  if (manifest.environment === 'mainnet' && chainId !== 143) throw new Error('Mainnet manifest must use Monad mainnet chain 143')

  const addresses = {}
  for (const name of CODE_ADDRESSES) {
    addresses[name] = address(manifest.deployment?.addresses?.[name], `V5 address ${name}`)
  }
  const uniqueContracts = new Set(REQUIRED_CONTRACTS.map((name) => addresses[name].toLowerCase()))
  if (uniqueContracts.size !== REQUIRED_CONTRACTS.length) throw new Error('V5 contract addresses must be distinct')

  const deployCommit = requiredString(manifest.deployment?.deployCommit, 'V5 deploy commit')
  if (!/^[0-9a-f]{40}$/i.test(deployCommit)) throw new Error('Invalid V5 deploy commit')

  return Object.freeze({
    schemaVersion: 1,
    protocolVersion: 5,
    environment: manifest.environment,
    isUat: manifest.environment === 'uat',
    releaseId: requiredString(manifest.releaseId, 'V5 release id'),
    chainId,
    chainName: requiredString(manifest.chain?.name, 'V5 chain name'),
    nativeCurrency: {
      name: requiredString(manifest.chain?.nativeCurrency?.name, 'V5 native currency name'),
      symbol: requiredString(manifest.chain?.nativeCurrency?.symbol, 'V5 native currency symbol'),
      decimals: positiveInteger(manifest.chain?.nativeCurrency?.decimals, 'V5 native currency decimals'),
    },
    rpcUrl: httpsUrl(manifest.chain?.rpcUrl, 'V5 RPC URL'),
    explorerUrl: httpsUrl(manifest.chain?.explorerUrl, 'V5 explorer URL'),
    deployCommit: deployCommit.toLowerCase(),
    startBlock: positiveInteger(manifest.deployment?.startBlock, 'V5 start block'),
    ...addresses,
    indexerUrl: httpsUrl(manifest.services?.indexerUrl, 'V5 indexer URL'),
    claimProofUrl: httpsUrl(manifest.services?.claimProofUrl, 'V5 claim proof URL', { optional: true }),
  })
}

export function v5ReleaseConfigFromEnv(env) {
  const uat = env?.VITE_V5_UAT === 'true'
  const mainnet = env?.VITE_V5_ENABLED === 'true'
  if (uat && mainnet) throw new Error('VITE_V5_UAT and VITE_V5_ENABLED cannot both be true')
  if (!uat && !mainnet) return null

  const expectedEnvironment = uat ? 'uat' : 'mainnet'
  const raw = String(env?.VITE_V5_RELEASE_MANIFEST || '').trim()
  if (!raw && mainnet) throw new Error('VITE_V5_RELEASE_MANIFEST is required for a mainnet V5 build')
  return parseV5ReleaseManifest(raw || V5_UAT_RELEASE_MANIFEST, { expectedEnvironment })
}

function sameAddress(actual, expected, label) {
  if (!ethers.isAddress(actual) || ethers.getAddress(actual) !== expected) {
    throw new Error(`${label} does not match the approved V5 release`)
  }
}

export function assertV5RuntimeSnapshot(config, snapshot) {
  if (BigInt(snapshot?.chainId ?? 0) !== BigInt(config.chainId)) {
    throw new Error(`RPC chain ${snapshot?.chainId ?? '<missing>'} does not match approved chain ${config.chainId}`)
  }
  for (const name of CODE_ADDRESSES) {
    if (snapshot?.code?.[name] === '0x' || !snapshot?.code?.[name]) {
      throw new Error(`No bytecode for approved V5 ${name}`)
    }
  }

  const wiring = snapshot?.wiring || {}
  sameAddress(wiring.managerVault, config.prizeVault, 'DrawManager.vault')
  sameAddress(wiring.managerTwab, config.twabController, 'DrawManager.twabController')
  sameAddress(wiring.managerClaim, config.claimManager, 'DrawManager.claimManager')
  sameAddress(wiring.managerOracle, config.pythRandomnessOracle, 'DrawManager.randomnessOracle')
  sameAddress(wiring.managerPayoutToken, config.shmon, 'DrawManager.payoutToken')
  sameAddress(wiring.vaultDrawManager, config.drawManager, 'PrizeVault.drawManager')
  sameAddress(wiring.vaultStrategy, config.shmonStrategy, 'PrizeVault.strategy')
  sameAddress(wiring.vaultTwab, config.twabController, 'PrizeVault.twabController')
  sameAddress(wiring.vaultPayoutToken, config.shmon, 'PrizeVault.payoutToken')
  sameAddress(wiring.strategyVault, config.prizeVault, 'ShmonStrategy.vault')
  sameAddress(wiring.strategyShareToken, config.shmon, 'ShmonStrategy.shareToken')
  sameAddress(wiring.claimCompoundVault, config.prizeVault, 'ClaimManager.compoundVaultFor')
  sameAddress(wiring.oracleConsumer, config.drawManager, 'PythRandomnessOracle.consumer')
  if (!wiring.twabRegisteredVault) throw new Error('PrizeVault is not registered in TwabController')
  if (!wiring.claimAuthorizedSource) throw new Error('DrawManager is not authorized in ClaimManager')
  return true
}

export async function verifyV5WritePreconditions({ config, walletProvider, verifyRuntime, refreshData }) {
  const walletChainId = await walletProvider.request({ method: 'eth_chainId' })
  assertV5WalletChain(config, BigInt(walletChainId))
  await verifyRuntime({ force: true })
  await refreshData()
  return true
}
export function assertV5WalletChain(config, chainId) {
  if (BigInt(chainId) !== BigInt(config.chainId)) {
    throw new Error(`Wallet chain ${chainId} does not match approved chain ${config.chainId}`)
  }
  return true
}
