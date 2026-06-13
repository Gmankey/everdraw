import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MANIFEST = resolve(__dirname, '..', 'deployments', 'monad-mainnet.json')

export function parseAddressList(value) {
  return String(value || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
    .map(normalizeAddress)
}

export function loadCanonicalKeeperPools(manifestPath = process.env.KEEPER_POOL_MANIFEST || DEFAULT_MANIFEST) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const addresses = manifest?.keeper?.activePoolAddresses
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`missing keeper.activePoolAddresses in ${manifestPath}`)
  }
  return addresses.map(normalizeAddress)
}

function normalizeAddress(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`invalid address: ${address}`)
  }
  return address
}

export function diffAddressSets(actual, expected) {
  const actualByLc = new Map(actual.map((address) => [address.toLowerCase(), address]))
  const expectedByLc = new Map(expected.map((address) => [address.toLowerCase(), address]))
  return {
    missing: expected.filter((address) => !actualByLc.has(address.toLowerCase())),
    extra: actual.filter((address) => !expectedByLc.has(address.toLowerCase())),
  }
}

export function assertCanonicalKeeperPools(actual, {
  manifestPath = process.env.KEEPER_POOL_MANIFEST || DEFAULT_MANIFEST,
  strict = String(process.env.KEEPER_POOL_RECONCILE || 'true').toLowerCase() !== 'false',
} = {}) {
  if (!strict) return { expected: [], missing: [], extra: [], strict }

  const expected = loadCanonicalKeeperPools(manifestPath)
  const { missing, extra } = diffAddressSets(actual, expected)
  if (missing.length || extra.length) {
    throw new Error(
      [
        'POOL_ADDRESSES does not match deployments/monad-mainnet.json keeper.activePoolAddresses',
        `missing=${missing.join(',') || '-'}`,
        `extra=${extra.join(',') || '-'}`,
        'Update Fly secrets or the manifest before starting the keeper.',
      ].join('; '),
    )
  }
  return { expected, missing, extra, strict }
}
