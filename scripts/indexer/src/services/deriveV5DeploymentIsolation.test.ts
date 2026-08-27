import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createDeriveRoundsService } from './deriveRounds.js';
import { createDeriveWalletRoundsService } from './deriveWalletRounds.js';
import { createDeriveV5TranchesService } from './deriveV5Tranches.js';
import { createDerivePointsService } from './derivePoints.js';
import type { RawEventRow, V5DeploymentScope } from '../types/domain.js';

const db = new Database(':memory:');
applySchema(db);
const rawEventsRepo = createRawEventsRepo(db);
const roundsRepo = createRoundsRepo(db);
const walletRoundsRepo = createWalletRoundsRepo(db);
const pointsRepo = createPointsRepo(db);
const tranchesRepo = createV5TranchesRepo(db);

const wallet = '0x00000000000000000000000000000000000000aa';
const stackA: V5DeploymentScope = {
  chainId: 10143,
  vaultAddress: '0x0000000000000000000000000000000000000a01',
  drawManagerAddress: '0x0000000000000000000000000000000000000a02',
  claimManagerAddress: '0x0000000000000000000000000000000000000a03',
};
const stackB: V5DeploymentScope = {
  chainId: 10143,
  vaultAddress: '0x0000000000000000000000000000000000000b01',
  drawManagerAddress: '0x0000000000000000000000000000000000000b02',
  claimManagerAddress: '0x0000000000000000000000000000000000000b03',
};
const periodStart = 1782950400;
const periodEnd = periodStart + 3600;
const iso = (unix: number) => new Date(unix * 1000).toISOString();

function raw(input: {
  stack: V5DeploymentScope;
  suffix: number;
  eventName: RawEventRow['eventName'];
  contractAddress: string;
  payload: Record<string, unknown>;
  wallet?: string | null;
  roundId?: number | null;
  timestamp?: number;
}): RawEventRow {
  const tag = input.stack === stackA ? 0xa000 : 0xb000;
  const id = tag + input.suffix;
  return {
    txHash: `0x${id.toString(16).padStart(64, '0')}`,
    logIndex: input.suffix,
    blockNumber: 100 + input.suffix,
    blockHash: `0x${id.toString(16).padStart(64, '1')}`,
    blockTimestamp: iso(input.timestamp ?? periodStart),
    contractAddress: input.contractAddress,
    eventName: input.eventName,
    roundId: input.roundId ?? null,
    wallet: input.wallet ?? null,
    amountMon: null,
    payload: JSON.stringify(input.payload),
    finalized: 1,
    createdAt: iso(periodStart),
  };
}

function stackEvents(stack: V5DeploymentScope, depositWei: string, distributionId: string): RawEventRow[] {
  return [
    raw({ stack, suffix: 1, eventName: 'DrawStarted', contractAddress: stack.drawManagerAddress, roundId: 1, payload: { drawId: 1, periodStart, periodEnd, totalTwab: depositWei, totalPayout: '1000' } }),
    raw({ stack, suffix: 2, eventName: 'Deposit', contractAddress: stack.vaultAddress, wallet, payload: { recipient: wallet, amount: depositWei } }),
    raw({ stack, suffix: 3, eventName: 'SeedReceived', contractAddress: stack.drawManagerAddress, roundId: 1, timestamp: periodEnd, payload: { drawId: 1, requestId: '1', seed: '0x01' } }),
    raw({ stack, suffix: 4, eventName: 'RootProposed', contractAddress: stack.drawManagerAddress, roundId: 1, timestamp: periodEnd, payload: { drawId: 1, root: '0x02', winnerCount: 1, totalPayout: '1000' } }),
    raw({ stack, suffix: 5, eventName: 'DistributionRegistered', contractAddress: stack.claimManagerAddress, roundId: 1, timestamp: periodEnd, payload: { distributionId, source: stack.drawManagerAddress, sourceKey: '0x01', root: '0x02', leafCount: 1 } }),
    raw({ stack, suffix: 6, eventName: 'RootFinalized', contractAddress: stack.drawManagerAddress, roundId: 1, timestamp: periodEnd, payload: { drawId: 1, root: '0x02', winnerCount: 1, totalPayout: '1000' } }),
    raw({ stack, suffix: 7, eventName: 'ClaimPaid', contractAddress: stack.claimManagerAddress, wallet, timestamp: periodEnd, payload: { distributionId, leafIndex: '0', account: wallet, token: '0x0000000000000000000000000000000000000000', amount: '1000', kind: 0 } }),
  ];
}

rawEventsRepo.upsertMany([
  ...stackEvents(stackA, '10000000000000000000', `0x${'aa'.padStart(64, '0')}`),
  ...stackEvents(stackB, '20000000000000000000', `0x${'bb'.padStart(64, '0')}`),
]);

const deriveRounds = createDeriveRoundsService(rawEventsRepo, roundsRepo);
const deriveWalletRounds = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);
const deriveTranches = createDeriveV5TranchesService(
  rawEventsRepo,
  tranchesRepo,
  walletRoundsRepo,
  [stackA, stackB]
);
const derivePoints = createDerivePointsService({
  pointsRepo,
  roundsRepo,
  walletRoundsRepo,
  pointsStartUnix: 0,
});

deriveRounds.rebuildFromRaw();
deriveWalletRounds.rebuildFromRaw();
deriveTranches.rebuildFromRaw();
derivePoints.rebuildSettlementPoints();

const tranches = tranchesRepo.listByWallet(wallet);
assert.equal(tranches.length, 2);
assert.deepEqual(
  tranches.map((row) => [row.vaultAddress, row.remainingAmount]),
  [
    [stackA.vaultAddress, '10000000000000000000'],
    [stackB.vaultAddress, '20000000000000000000'],
  ]
);

const roundA = roundsRepo.listAll().find((row) => row.poolAddress === stackA.drawManagerAddress);
const roundB = roundsRepo.listAll().find((row) => row.poolAddress === stackB.drawManagerAddress);
assert.equal(roundA?.winner, wallet);
assert.equal(roundB?.winner, wallet);

const walletRoundA = walletRoundsRepo.listByRound(1, stackA.drawManagerAddress)[0];
const walletRoundB = walletRoundsRepo.listByRound(1, stackB.drawManagerAddress)[0];
assert.ok(Math.abs((walletRoundA.v5ResolvedBase ?? 0) - 3) < 1e-9);
assert.ok(Math.abs((walletRoundB.v5ResolvedBase ?? 0) - 6) < 1e-9);

const points = pointsRepo.listHistory(wallet, 10);
assert.equal(points.length, 2);
assert.equal(points.find((row) => row.poolAddress === stackA.drawManagerAddress)?.basePoints, 3);
assert.equal(points.find((row) => row.poolAddress === stackB.drawManagerAddress)?.basePoints, 6);

const positionEvents = tranchesRepo.listPositionEvents(wallet);
assert.equal(positionEvents.filter((row) => row.vaultAddress === stackA.vaultAddress).length, 1);
assert.equal(positionEvents.filter((row) => row.vaultAddress === stackB.vaultAddress).length, 1);

console.log('deriveV5DeploymentIsolation.test.ts ok');
