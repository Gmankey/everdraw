import assert from 'node:assert/strict';
import { getRunnerConfig } from './config.js';

const VAULT = '0x0000000000000000000000000000000000000011';
const DRAW_MANAGER = '0x0000000000000000000000000000000000000022';
const CLAIM_MANAGER = '0x0000000000000000000000000000000000000033';
const KEYS = [
  'RPC_URL',
  'INDEXER_RPC_URL',
  'POOL_ADDRESSES',
  'POOL_ADDRESS',
  'INDEXER_POOL_ADDRESS',
  'START_BLOCK',
  'INDEXER_DEPLOY_BLOCK',
  'INDEXER_CHAIN_ID',
  'CHAIN_ID',
  'INDEXER_CONFIRMATIONS',
  'V5_DEPLOYMENTS_JSON',
  'CLAIM_PROOF_INGEST_SECRET',
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function resetEnv(): void {
  for (const key of KEYS) delete process.env[key];
  process.env.RPC_URL = 'https://rpc.invalid';
  process.env.POOL_ADDRESSES = [VAULT, DRAW_MANAGER, CLAIM_MANAGER].join(',');
  process.env.START_BLOCK = '100';
  process.env.INDEXER_CHAIN_ID = '143';
  process.env.V5_DEPLOYMENTS_JSON = JSON.stringify([{
    chainId: 143,
    vaultAddress: VAULT,
    drawManagerAddress: DRAW_MANAGER,
    claimManagerAddress: CLAIM_MANAGER,
  }]);
  process.env.CLAIM_PROOF_INGEST_SECRET = 'a'.repeat(32);
}

try {
  resetEnv();
  const config = getRunnerConfig();
  assert.equal(config.confirmations, 12);
  assert.equal(config.v5Deployments.length, 1);

  resetEnv();
  delete process.env.V5_DEPLOYMENTS_JSON;
  assert.throws(() => getRunnerConfig(), /Missing V5_DEPLOYMENTS_JSON/);

  resetEnv();
  process.env.V5_DEPLOYMENTS_JSON = '[]';
  assert.throws(() => getRunnerConfig(), /at least one deployment tuple/);

  resetEnv();
  delete process.env.CLAIM_PROOF_INGEST_SECRET;
  assert.throws(() => getRunnerConfig(), /CLAIM_PROOF_INGEST_SECRET/);

  resetEnv();
  const deployment = {
    chainId: 143,
    vaultAddress: VAULT,
    drawManagerAddress: DRAW_MANAGER,
    claimManagerAddress: CLAIM_MANAGER,
  };
  process.env.V5_DEPLOYMENTS_JSON = JSON.stringify([deployment, deployment]);
  assert.throws(() => getRunnerConfig(), /Duplicate V5 deployment tuple/);

  resetEnv();
  process.env.V5_DEPLOYMENTS_JSON = JSON.stringify([{
    chainId: 10143,
    vaultAddress: VAULT,
    drawManagerAddress: DRAW_MANAGER,
    claimManagerAddress: CLAIM_MANAGER,
  }]);
  assert.throws(() => getRunnerConfig(), /V5 deployment chain mismatch/);

  resetEnv();
  process.env.INDEXER_CONFIRMATIONS = '0';
  assert.throws(() => getRunnerConfig(), /positive integer/);

  resetEnv();
  process.env.V5_DEPLOYMENTS_JSON = JSON.stringify([{
    chainId: 143,
    vaultAddress: VAULT,
    drawManagerAddress: VAULT,
    claimManagerAddress: CLAIM_MANAGER,
  }]);
  assert.throws(() => getRunnerConfig(), /Ambiguous V5 contract roles/);

  resetEnv();
  process.env.V5_DEPLOYMENTS_JSON = JSON.stringify([{
    chainId: 143,
    vaultAddress: VAULT,
    drawManagerAddress: DRAW_MANAGER,
    claimManagerAddress: '0x0000000000000000000000000000000000000044',
  }]);
  assert.throws(() => getRunnerConfig(), /missing from POOL_ADDRESSES/);
} finally {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('config.test.ts ok');
