import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { Interface } from 'ethers';
import type { AbstractProvider } from 'ethers';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createIndexerStateRepo } from '../repositories/indexerStateRepo.js';
import { POOL_EVENT_ABI } from './abi.js';
import { createIndexerRunner } from './service.js';
import type { RunnerConfig } from './config.js';

const vault = '0x0000000000000000000000000000000000000a01';
const manager = '0x0000000000000000000000000000000000000a02';
const claims = '0x0000000000000000000000000000000000000a03';
const walletA = '0x00000000000000000000000000000000000000aa';
const walletB = '0x00000000000000000000000000000000000000bb';
const zero = '0x0000000000000000000000000000000000000000';
const rootA = `0x${'11'.repeat(32)}`;
const rootB = `0x${'22'.repeat(32)}`;
const distribution = `0x${'33'.repeat(32)}`;
const iface = new Interface(POOL_EVENT_ABI);

type ChainVersion = 'a' | 'b' | 'c';
type FakeLog = {
  address: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  index: number;
  topics: readonly string[];
  data: string;
};

function hash(block: number, version: ChainVersion): string {
  const variant = version === 'a' ? 1 : version === 'b' ? 2 : block === 106 ? 3 : 2;
  return `0x${(block * 10 + variant).toString(16).padStart(64, '0')}`;
}

function encodedLog(version: ChainVersion, block: number, address: string, name: string, args: readonly unknown[]): FakeLog {
  const encoded = iface.encodeEventLog(iface.getEvent(name)!, args);
  return {
    address,
    blockNumber: block,
    blockHash: hash(block, version),
    transactionHash: `0x${(block * 100 + (version === 'a' ? 1 : version === 'b' ? 2 : 3)).toString(16).padStart(64, '0')}`,
    index: 0,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function logs(version: ChainVersion): FakeLog[] {
  const wallet = version === 'a' ? walletA : walletB;
  const amount = version === 'a' ? 10n : version === 'b' ? 20n : 30n;
  const root = version === 'a' ? rootA : rootB;
  return [
    encodedLog(version, 100, vault, 'Deposit', [wallet, amount]),
    encodedLog(version, 101, vault, 'Transfer', [wallet, version === 'a' ? walletB : walletA, 1n]),
    encodedLog(version, 102, manager, 'SeedReceived', [1n, 7n, root]),
    encodedLog(version, 103, manager, 'RootProposed', [1n, root, 1, amount, wallet, root, 2000]),
    encodedLog(version, 104, manager, 'RootFinalized', [1n, root, 1, amount]),
    encodedLog(version, 105, claims, 'ClaimPaid', [distribution, 0n, wallet, zero, amount, 0]),
    encodedLog(version, 106, claims, 'PrizeCompounded', [distribution, 0n, wallet, amount]),
  ];
}

class FakeProvider {
  version: ChainVersion = 'a';
  reorgDuringFetch = false;
  getLogsCalls = 0;
  getLogsAddressCounts: number[] = [];
  missingBlockNumber: number | null = null;

  async getBlockNumber(): Promise<number> {
    return 107;
  }

  async getBlock(blockNumber: number): Promise<{ hash: string; timestamp: number } | null> {
    if (blockNumber === this.missingBlockNumber) return null;
    return { hash: hash(blockNumber, this.version), timestamp: 1782950400 + blockNumber };
  }

  async getLogs(filter: { address: string | string[]; fromBlock: number; toBlock: number }): Promise<FakeLog[]> {
    const addresses = new Set((Array.isArray(filter.address) ? filter.address : [filter.address]).map((value) => value.toLowerCase()));
    this.getLogsAddressCounts.push(addresses.size);
    const result = logs(this.version).filter(
      (log) =>
        addresses.has(log.address.toLowerCase()) &&
        log.blockNumber >= Number(filter.fromBlock) &&
        log.blockNumber <= Number(filter.toBlock)
    );
    this.getLogsCalls += 1;
    if (this.reorgDuringFetch && this.getLogsCalls === 1) {
      this.version = 'b';
    }
    return result;
  }
}

const db = new Database(':memory:');
applySchema(db);
const rawEventsRepo = createRawEventsRepo(db);
const indexerStateRepo = createIndexerStateRepo(db);
const provider = new FakeProvider();
let rebuilds = 0;
const rebuild = () => { rebuilds += 1; };
const config: RunnerConfig = {
  rpcUrl: 'http://unused.invalid',
  chainId: 10143,
  poolAddresses: [vault, manager, claims],
  v5Deployments: [{
    chainId: 10143,
    vaultAddress: vault,
    drawManagerAddress: manager,
    claimManagerAddress: claims,
  }],
  claimProofIngestSecret: 'a'.repeat(32),
  deployBlock: 100,
  confirmations: 1,
  chunkSize: 1,
  maxBlocksPerSync: 100,
  pollIntervalMs: 1,
  pointsMinQualifyingMon: 100,
  pointsReplayMaxIdleMs: 600_000,
};
const runner = createIndexerRunner({
  config,
  rawEventsRepo,
  indexerStateRepo,
  provider: provider as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw: rebuild },
  deriveWalletRoundsService: { rebuildFromRaw: rebuild },
  deriveWalletStatsService: { rebuild },
  deriveV5TranchesService: { rebuildFromRaw: rebuild },
  derivePointsService: {
    rebuildSettlementPoints: rebuild,
    runWeeklyCheckpoint: () => ({ skipped: true, reason: 'test' }),
  } as never,
});

await runner.syncOnce();
assert.deepEqual(rawEventsRepo.getRange(100, 106).map((row) => row.eventName), [
  'Deposit',
  'Transfer',
  'SeedReceived',
  'RootProposed',
  'RootFinalized',
  'ClaimPaid',
  'PrizeCompounded',
]);
assert.equal(rawEventsRepo.getRange(100, 106)[0].wallet, walletA);
assert.deepEqual(provider.getLogsAddressCounts.slice(0, 7), Array(7).fill(3), "each chunk must use one combined address filter");

const afterInitial = rebuilds;
provider.version = 'b';
await runner.syncOnce();
const deepRows = rawEventsRepo.getRange(100, 106);
assert.equal(deepRows.length, 7);
assert.equal(deepRows[0].wallet, walletB);
assert.equal(deepRows.some((row) => row.txHash.endsWith('01')), false);
assert.ok(rebuilds >= afterInitial + 10, 'deep reorg must rebuild on rewind and after canonical rescan');

const deepStatus = await runner.getStatus();
assert.equal(deepStatus.lastScannedBlock, 106);
assert.equal(deepStatus.confirmedHead, 106);
assert.equal(deepStatus.canonicalHash, hash(106, 'b'));
assert.equal(deepStatus.rewindCount, 1);

provider.version = 'c';
await runner.syncOnce();
const shallowRows = rawEventsRepo.getRange(100, 106);
assert.equal(shallowRows.length, 7);
assert.equal(shallowRows[6].eventName, 'PrizeCompounded');
assert.equal(shallowRows[6].amountMon, '30');
assert.equal(shallowRows.some((row) => row.blockNumber === 106 && row.txHash.endsWith('02')), false);

const shallowStatus = await runner.getStatus();
assert.equal(shallowStatus.canonicalHash, hash(106, 'c'));
assert.equal(shallowStatus.rewindCount, 2);

const raceDb = new Database(':memory:');
applySchema(raceDb);
const raceRawEventsRepo = createRawEventsRepo(raceDb);
const raceProvider = new FakeProvider();
raceProvider.reorgDuringFetch = true;
const raceRunner = createIndexerRunner({
  config: { ...config, chunkSize: 7 },
  rawEventsRepo: raceRawEventsRepo,
  indexerStateRepo: createIndexerStateRepo(raceDb),
  provider: raceProvider as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw() {} },
  deriveWalletRoundsService: { rebuildFromRaw() {} },
  deriveWalletStatsService: { rebuild() {} },
  deriveV5TranchesService: { rebuildFromRaw() {} },
});

await assert.rejects(
  raceRunner.syncOnce(),
  /Canonical (log mismatch|range changed during fetch)/,
  'an in-flight reorg must reject the whole unverified chunk'
);
assert.equal(
  raceRawEventsRepo.getRange(100, 106).length,
  0,
  'chain-A rows must not survive a chain-B checkpoint race'
);
const rejectedStatus = await raceRunner.getStatus();
assert.equal(rejectedStatus.lastScannedBlock, 99, 'an unverified cursor must not advance');
assert.equal(rejectedStatus.canonicalHash, null);

raceProvider.reorgDuringFetch = false;
raceProvider.getLogsCalls = 0;
await raceRunner.syncOnce();
const recoveredRows = raceRawEventsRepo.getRange(100, 106);
assert.equal(recoveredRows.length, 7);
assert.equal(recoveredRows[0].wallet, walletB, 'retry must ingest only the canonical chain-B row');
const recoveredStatus = await raceRunner.getStatus();
assert.equal(recoveredStatus.lastScannedBlock, 106);
assert.equal(recoveredStatus.canonicalHash, hash(106, 'b'));

const missingDb = new Database(':memory:');
applySchema(missingDb);
const missingRawEventsRepo = createRawEventsRepo(missingDb);
const missingIndexerStateRepo = createIndexerStateRepo(missingDb);
const missingProvider = new FakeProvider();
missingProvider.missingBlockNumber = 101;
const missingRunner = createIndexerRunner({
  config: { ...config, chunkSize: 7 },
  rawEventsRepo: missingRawEventsRepo,
  indexerStateRepo: missingIndexerStateRepo,
  provider: missingProvider as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw() {} },
  deriveWalletRoundsService: { rebuildFromRaw() {} },
  deriveWalletStatsService: { rebuild() {} },
  deriveV5TranchesService: { rebuildFromRaw() {} },
});

await assert.rejects(
  missingRunner.syncOnce(),
  /Missing canonical block metadata for supported log at block 101/,
  'missing metadata for an interior supported log must reject the entire chunk',
);
assert.equal(
  missingRawEventsRepo.getRange(100, 106).length,
  0,
  'no partial rows may commit when supported-log metadata is unavailable',
);
const missingStatus = await missingRunner.getStatus();
assert.equal(missingStatus.lastScannedBlock, 99, 'cursor must not advance past a missing supported log');
assert.equal(missingStatus.canonicalHash, null);

console.log('canonicalReorg.test.ts ok');

assert.equal(provider.getLogsCalls >= 7, true, 'combined address filters use one eth_getLogs call per block chunk');

const disagreementDb = new Database(':memory:');
applySchema(disagreementDb);
const disagreementCanonical = new FakeProvider();
const disagreementLogs = new FakeProvider();
disagreementLogs.version = 'b';
const disagreementRunner = createIndexerRunner({
  config: { ...config, chunkSize: 7, rpcRetryAttempts: 1 },
  rawEventsRepo: createRawEventsRepo(disagreementDb),
  indexerStateRepo: createIndexerStateRepo(disagreementDb),
  provider: disagreementCanonical as unknown as AbstractProvider,
  logsProvider: disagreementLogs as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw() {} },
  deriveWalletRoundsService: { rebuildFromRaw() {} },
  deriveWalletStatsService: { rebuild() {} },
});
await assert.rejects(
  disagreementRunner.syncOnce(),
  /Canonical log mismatch/,
  'logs from a provider on a different canonical view must not advance the cursor',
);
assert.equal((await disagreementRunner.getStatus()).lastScannedBlock, 99);

const errorDb = new Database(':memory:');
applySchema(errorDb);
const errorProvider = new FakeProvider();
errorProvider.getLogs = async () => { throw new Error('RPC unavailable'); };
const errorRunner = createIndexerRunner({
  config: { ...config, chunkSize: 7, rpcRetryAttempts: 1 },
  rawEventsRepo: createRawEventsRepo(errorDb),
  indexerStateRepo: createIndexerStateRepo(errorDb),
  provider: new FakeProvider() as unknown as AbstractProvider,
  logsProvider: errorProvider as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw() {} },
  deriveWalletRoundsService: { rebuildFromRaw() {} },
  deriveWalletStatsService: { rebuild() {} },
});
await assert.rejects(
  errorRunner.syncOnce(),
  /RPC unavailable/,
  'an RPC error must not be interpreted as an empty log result',
);
assert.equal((await errorRunner.getStatus()).lastScannedBlock, 99);

class RangeLimitedProvider extends FakeProvider {
  async getLogs(filter: { address: string | string[]; fromBlock: number; toBlock: number }): Promise<FakeLog[]> {
    if (Number(filter.toBlock) - Number(filter.fromBlock) > 1) {
      throw new Error('eth_getLogs block range limited to 2 blocks');
    }
    return super.getLogs(filter);
  }
}

const adaptiveDb = new Database(':memory:');
applySchema(adaptiveDb);
const adaptiveRunner = createIndexerRunner({
  config: { ...config, chunkSize: 7, rpcRetryAttempts: 1 },
  rawEventsRepo: createRawEventsRepo(adaptiveDb),
  indexerStateRepo: createIndexerStateRepo(adaptiveDb),
  provider: new FakeProvider() as unknown as AbstractProvider,
  logsProvider: new RangeLimitedProvider() as unknown as AbstractProvider,
  deriveRoundsService: { rebuildFromRaw() {} },
  deriveWalletRoundsService: { rebuildFromRaw() {} },
  deriveWalletStatsService: { rebuild() {} },
});
await adaptiveRunner.syncOnce();
assert.equal((await adaptiveRunner.getStatus()).lastScannedBlock, 106);
assert.equal(
  createRawEventsRepo(adaptiveDb).getRange(100, 106).length,
  7,
  'adaptive range splitting must preserve every event',
);
