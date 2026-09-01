import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createDerivePointsService } from './derivePoints.js';
import { createDeriveRoundsService } from './deriveRounds.js';
import { createDeriveV5TranchesService } from './deriveV5Tranches.js';
import { createDeriveWalletRoundsService } from './deriveWalletRounds.js';
import type { RawEventRow } from '../types/domain.js';

const db = new Database(':memory:');
applySchema(db);
const rawEventsRepo = createRawEventsRepo(db);
const roundsRepo = createRoundsRepo(db);
const walletRoundsRepo = createWalletRoundsRepo(db);
const pointsRepo = createPointsRepo(db);
const tranchesRepo = createV5TranchesRepo(db);

const vault = '0x0000000000000000000000000000000000000a11';
const drawManager = '0x0000000000000000000000000000000000000d22';
const wallet = '0x00000000000000000000000000000000000000aa';
const start = 1782950400;
const period = 3600;
const iso = (unix: number) => new Date(unix * 1000).toISOString();

function raw(input: {
  id: number;
  eventName: RawEventRow['eventName'];
  timestamp: number;
  contractAddress: string;
  roundId?: number;
  wallet?: string;
  payload: Record<string, unknown>;
}): RawEventRow {
  return {
    txHash: `0x${input.id.toString(16).padStart(64, '0')}`,
    logIndex: input.id,
    blockNumber: input.id,
    blockHash: `0x${input.id.toString(16).padStart(64, '1')}`,
    blockTimestamp: iso(input.timestamp),
    contractAddress: input.contractAddress,
    eventName: input.eventName,
    roundId: input.roundId ?? null,
    wallet: input.wallet ?? null,
    amountMon: null,
    payload: JSON.stringify(input.payload),
    finalized: 1,
    createdAt: iso(input.timestamp),
  };
}

const events: RawEventRow[] = [];
events.push(raw({
  id: 1,
  eventName: 'Deposit',
  timestamp: start,
  contractAddress: vault,
  wallet,
  payload: { recipient: wallet, amount: '1000000000000000000' },
}));
for (let drawId = 1; drawId <= 26; drawId += 1) {
  const periodStart = start + (drawId - 1) * period;
  const periodEnd = periodStart + period;
  events.push(raw({
    id: drawId * 10 + 9,
    eventName: 'DrawSkipped',
    timestamp: periodEnd,
    contractAddress: drawManager,
    roundId: drawId,
    payload: {
      drawId,
      periodStart,
      periodEnd,
      totalTwab: '1000000000000000000',
      availablePrize: '0',
      reason: 'zero prize',
    },
  }));
}
const draw26Start = start + 25 * period;
events.push(raw({
  id: 251,
  eventName: 'Deposit',
  timestamp: draw26Start,
  contractAddress: vault,
  wallet,
  payload: { recipient: wallet, amount: '100000000000000000000' },
}));
events.push(raw({
  id: 252,
  eventName: 'Withdraw',
  timestamp: draw26Start + period / 2,
  contractAddress: vault,
  wallet,
  payload: { recipient: wallet, amount: '100000000000000000000' },
}));
rawEventsRepo.upsertMany(events);

createDeriveRoundsService(rawEventsRepo, roundsRepo).rebuildFromRaw();
createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo).rebuildFromRaw();
createDeriveV5TranchesService(rawEventsRepo, tranchesRepo, walletRoundsRepo).rebuildFromRaw();

pointsRepo.ensureWallet(wallet, start);
pointsRepo.upsertWalletStreak({
  wallet,
  currentStreakWeeks: 26,
  longestStreakWeeks: 26,
  lastCheckpointUnix: start - 1,
  consecutiveNonWins: 0,
  consecutiveMissedDraws: 0,
  updatedAt: start,
});
createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo }).rebuildSettlementPoints();

const draw26 = pointsRepo.listHistory(wallet, 100).find((row) => row.roundId === 26);
assert.ok(draw26);
assert.ok(
  Math.abs(draw26.basePoints - 15.45) < 1e-9,
  `late 100 MON must remain 1x and LIFO exit must preserve the old tranche; got ${draw26.basePoints}`,
);
assert.equal(draw26.multiplierX100, 100, 'the 2x account tier must not be applied again');
assert.equal(tranchesRepo.sumOpenRemaining(wallet, vault, 'vault'), '1000000000000000000');

console.log('deriveV5AntiGaming.test.ts ok');
