import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import test from 'node:test'

import {
  V5_UAT_RELEASE_MANIFEST,
  assertV5RuntimeSnapshot,
  assertV5WalletChain,
  parseV5ReleaseManifest,
  v5ReleaseConfigFromEnv,
  verifyV5WritePreconditions,
} from './v5ReleaseConfig.js'

const mainnet = {
  ...V5_UAT_RELEASE_MANIFEST,
  environment: 'mainnet',
  releaseId: 'mainnet-release',
  chain: {
    ...V5_UAT_RELEASE_MANIFEST.chain,
    id: 143,
    name: 'Monad Mainnet',
    rpcUrl: 'https://rpc.example',
    explorerUrl: 'https://explorer.example',
  },
  deployment: {
    ...V5_UAT_RELEASE_MANIFEST.deployment,
    deployCommit: 'a'.repeat(40),
    startBlock: 91_500_000,
  },
  services: {
    indexerUrl: 'https://indexer.example',
    claimProofUrl: 'https://indexer.example/api/v5/claims',
  },
}

function snapshot(config) {
  return {
    chainId: BigInt(config.chainId),
    code: {
      drawManager: '0x01',
      prizeVault: '0x01',
      twabController: '0x01',
      claimManager: '0x01',
      shmonStrategy: '0x01',
      pythRandomnessOracle: '0x01',
      shmon: '0x01',
    },
    wiring: {
      managerVault: config.prizeVault,
      managerTwab: config.twabController,
      managerClaim: config.claimManager,
      managerOracle: config.pythRandomnessOracle,
      managerPayoutToken: config.shmon,
      vaultDrawManager: config.drawManager,
      vaultStrategy: config.shmonStrategy,
      vaultTwab: config.twabController,
      vaultPayoutToken: config.shmon,
      strategyVault: config.prizeVault,
      strategyShareToken: config.shmon,
      claimCompoundVault: config.prizeVault,
      oracleConsumer: config.drawManager,
      twabRegisteredVault: true,
      claimAuthorizedSource: true,
    },
  }
}

test('UAT resolves one complete committed manifest without per-address fallbacks', () => {
  const config = v5ReleaseConfigFromEnv({ VITE_V5_UAT: 'true' })
  assert.equal(config.environment, 'uat')
  assert.equal(config.chainId, 10143)
  assert.equal(config.drawManager, V5_UAT_RELEASE_MANIFEST.deployment.addresses.drawManager)
});

test('mainnet rejects missing, malformed, mixed-environment, and mixed-address manifests', () => {
  assert.throws(
    () => v5ReleaseConfigFromEnv({ VITE_V5_ENABLED: 'true' }),
    /VITE_V5_RELEASE_MANIFEST is required/,
  )
  assert.throws(
    () => v5ReleaseConfigFromEnv({
      VITE_V5_ENABLED: 'true',
      VITE_V5_RELEASE_MANIFEST: JSON.stringify({ ...mainnet, environment: 'uat' }),
    }),
    /does not match mainnet/,
  )
  assert.throws(
    () => parseV5ReleaseManifest({
      ...mainnet,
      deployment: {
        ...mainnet.deployment,
        addresses: {
          ...mainnet.deployment.addresses,
          claimManager: mainnet.deployment.addresses.drawManager,
        },
      },
    }),
    /must be distinct/,
  )
});

test('runtime and wallet checks fail closed on wrong chain, missing code, and wrong wiring', () => {
  const config = parseV5ReleaseManifest(mainnet)
  assert.equal(assertV5RuntimeSnapshot(config, snapshot(config)), true)
  assert.equal(assertV5WalletChain(config, 143), true)

  assert.throws(
    () => assertV5RuntimeSnapshot(config, { ...snapshot(config), chainId: 10143n }),
    /does not match approved chain/,
  )
  assert.throws(
    () => assertV5RuntimeSnapshot(config, {
      ...snapshot(config),
      code: { ...snapshot(config).code, prizeVault: '0x' },
    }),
    /No bytecode/,
  )
  assert.throws(
    () => assertV5RuntimeSnapshot(config, {
      ...snapshot(config),
      wiring: { ...snapshot(config).wiring, managerVault: config.claimManager },
    }),
    /DrawManager.vault/,
  )
  assert.throws(() => assertV5WalletChain(config, 10143), /Wallet chain/)
});

test('write preconditions verify wallet, runtime, and live data before a transaction can be built', async () => {
  const config = parseV5ReleaseManifest(mainnet)
  const calls = []
  const walletProvider = {
    request: async () => {
      calls.push('wallet')
      return '0x8f'
    },
  }
  await verifyV5WritePreconditions({
    config,
    walletProvider,
    verifyRuntime: async ({ force }) => {
      assert.equal(force, true)
      calls.push('runtime')
    },
    refreshData: async () => calls.push('data'),
  })
  assert.deepEqual(calls, ['wallet', 'runtime', 'data'])

  await assert.rejects(
    verifyV5WritePreconditions({
      config,
      walletProvider: { request: async () => '0x279f' },
      verifyRuntime: async () => assert.fail('runtime verification must not run on the wrong wallet chain'),
      refreshData: async () => assert.fail('data refresh must not run on the wrong wallet chain'),
    }),
    /Wallet chain/,
  )
})
test('the V5 build preflight exits nonzero when mainnet manifest is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-v5-release-config.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      VITE_V5_ENABLED: 'true',
      VITE_V5_UAT: 'false',
      VITE_V5_RELEASE_MANIFEST: '',
    },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /VITE_V5_RELEASE_MANIFEST is required/)
});
