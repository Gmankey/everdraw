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
import type { RawEventRow } from '../types/domain.js';

// Regression for the V5 entries gap: the derivation must compute per-wallet, per-draw
// entries from the tranche ledger (0.005/MON/min time-weighted), apply the PER-TRANCHE
// multiplier (vault 1x / degen 2x at tenure 0), and NOT re-apply the account streak
// multiplier. This is exactly the path the old committed tests never exercised.

const db = new Database(':memory:');
applySchema(db);

const rawEventsRepo = createRawEventsRepo(db);
const roundsRepo = createRoundsRepo(db);
const walletRoundsRepo = createWalletRoundsRepo(db);
const pointsRepo = createPointsRepo(db);
const v5TranchesRepo = createV5TranchesRepo(db);

const deriveRounds = createDeriveRoundsService(rawEventsRepo, roundsRepo);
const deriveWalletRounds = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);
const deriveV5Tranches = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo, walletRoundsRepo);
const derivePoints = createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo, pointsStartUnix: 0 });

const drawManager = '0x0000000000000000000000000000000000000d22';
const claimManager = '0x0000000000000000000000000000000000000c33';
const wallet = '0x00000000000000000000000000000000000000aa';
const distributionId = '0xda651a1a74429ad1ded3bcdd697bd79960751762a782ed8b32d2a912eebcc16e';

const periodStart = 1782950400;
const periodEnd = periodStart + 3600; // 1 hour draw
const iso = (unix: number) => new Date(unix * 1000).toISOString();

function raw(partial: Partial<RawEventRow> & Pick<RawEventRow, 'eventName' | 'logIndex' | 'payload'>): RawEventRow {
  return {
    txHash: `0x${partial.logIndex.toString(16).padStart(64, '0')}`,
    logIndex: partial.logIndex,
    blockNumber: partial.blockNumber ?? 100,
    blockHash: `0x${partial.logIndex.toString(16).padStart(64, '1')}`,
    blockTimestamp: partial.blockTimestamp ?? iso(periodStart),
    contractAddress: partial.contractAddress ?? drawManager,
    eventName: partial.eventName,
    roundId: partial.roundId ?? null,
    wallet: partial.wallet ?? null,
    amountMon: partial.amountMon ?? null,
    payload: partial.payload,
    finalized: partial.finalized ?? 1,
    createdAt: iso(periodStart),
  };
}

rawEventsRepo.upsertMany([
  raw({ eventName: 'DrawStarted', logIndex: 1, roundId: 1, blockTimestamp: iso(periodStart), payload: JSON.stringify({ drawId: 1, periodStart: String(periodStart), periodEnd: String(periodEnd), totalTwab: '14000000000000000000', totalPayout: '1000000000000000000' }) }),
  // 10 MON into the vault at period start → held the full hour.
  raw({ eventName: 'Deposit', logIndex: 2, blockTimestamp: iso(periodStart), contractAddress: '0x0000000000000000000000000000000000000076', wallet, payload: JSON.stringify({ recipient: wallet, amount: '10000000000000000000' }) }),
  // 4 MON into the degen pool at period start → held the full hour.
  raw({ eventName: 'BoostDeposit', logIndex: 3, blockTimestamp: iso(periodStart), contractAddress: '0x0000000000000000000000000000000000000076', wallet, payload: JSON.stringify({ booster: wallet, amount: '4000000000000000000' }) }),
  raw({ eventName: 'SeedReceived', logIndex: 4, roundId: 1, blockTimestamp: iso(periodEnd), payload: JSON.stringify({ drawId: 1, seed: '0x01' }) }),
  raw({ eventName: 'RootProposed', logIndex: 5, roundId: 1, blockTimestamp: iso(periodEnd), payload: JSON.stringify({ drawId: 1, root: '0x02', winnerCount: 1, totalPayout: '1000000000000000000' }) }),
  raw({ eventName: 'DistributionRegistered', logIndex: 6, roundId: 1, contractAddress: claimManager, blockTimestamp: iso(periodEnd), payload: JSON.stringify({ distributionId, source: drawManager, sourceKey: `0x${'1'.padStart(64, '0')}`, root: '0x02', leafCount: 1 }) }),
  raw({ eventName: 'RootFinalized', logIndex: 7, roundId: 1, blockTimestamp: iso(periodEnd), payload: JSON.stringify({ drawId: 1, root: '0x02', winnerCount: 1, totalPayout: '1000000000000000000' }) }),
  raw({ eventName: 'ClaimPaid', logIndex: 8, contractAddress: claimManager, wallet, blockTimestamp: iso(periodEnd), payload: JSON.stringify({ distributionId, leafIndex: '0', account: wallet, token: '0x0000000000000000000000000000000000000000', amount: '1000000000000000000', kind: 0 }) }),
]);

deriveRounds.rebuildFromRaw();
deriveWalletRounds.rebuildFromRaw();
deriveV5Tranches.rebuildFromRaw();
derivePoints.rebuildSettlementPoints();

// vault entries = 0.005 * 10 * 60 = 3.0 (1x); degen = 0.005 * 4 * 60 = 1.2 (2x) = 2.4; base = 5.4
const history = pointsRepo.listHistory(wallet, 10);
const r1 = history.find((h) => h.roundId === 1);
assert.ok(r1, 'expected a points row for draw 1');
assert.ok(Math.abs(r1!.basePoints - 5.4) < 1e-6, `base should be 5.4, got ${r1!.basePoints}`);
assert.equal(r1!.multiplierX100, 100, 'account streak multiplier must NOT be applied to V5 base');
const bonuses = JSON.parse(r1!.bonusesBreakdown);
assert.equal(bonuses.win, 25000);
assert.equal(bonuses.first_deposit, 25000);
assert.equal(bonuses.prize_patron, 25000);
assert.equal(r1!.totalPoints, 75005, `total should be round(5.4)+75000=75005, got ${r1!.totalPoints}`);

console.log('deriveV5Points.test.ts ok');
