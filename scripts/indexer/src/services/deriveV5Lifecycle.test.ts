import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createDeriveRoundsService } from './deriveRounds.js';
import { createDeriveWalletRoundsService } from './deriveWalletRounds.js';
import type { RawEventRow } from '../types/domain.js';

const db = new Database(':memory:');
applySchema(db);

const rawEventsRepo = createRawEventsRepo(db);
const roundsRepo = createRoundsRepo(db);
const walletRoundsRepo = createWalletRoundsRepo(db);
const deriveRounds = createDeriveRoundsService(rawEventsRepo, roundsRepo);
const deriveWalletRounds = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);

const drawManager = '0x0000000000000000000000000000000000000d22';
const claimManager = '0x0000000000000000000000000000000000000c33';
const wallet = '0x00000000000000000000000000000000000000aa';
const deferredWinner = '0x00000000000000000000000000000000000000bb';
const feeRecipient = '0x00000000000000000000000000000000000000f1';
const secondFeeRecipient = '0x00000000000000000000000000000000000000f3';
const rewardRecipient = '0x00000000000000000000000000000000000000f2';
const distributionId = '0xda651a1a74429ad1ded3bcdd697bd79960751762a782ed8b32d2a912eebcc16e';

function raw(partial: Partial<RawEventRow> & Pick<RawEventRow, 'eventName' | 'logIndex' | 'payload'>): RawEventRow {
  return {
    txHash: `0x${partial.logIndex.toString(16).padStart(64, '0')}`,
    logIndex: partial.logIndex,
    blockNumber: partial.blockNumber ?? 100,
    blockHash: `0x${partial.logIndex.toString(16).padStart(64, '1')}`,
    blockTimestamp: partial.blockTimestamp ?? '2026-07-03T00:00:00.000Z',
    contractAddress: partial.contractAddress ?? drawManager,
    eventName: partial.eventName,
    roundId: partial.roundId ?? null,
    wallet: partial.wallet ?? null,
    amountMon: partial.amountMon ?? null,
    payload: partial.payload,
    finalized: partial.finalized ?? 1,
    createdAt: '2026-07-03T00:00:00.000Z',
  };
}

rawEventsRepo.upsertMany([
  raw({
    eventName: 'DrawStarted',
    logIndex: 1,
    roundId: 1,
    payload: JSON.stringify({
      drawId: 1,
      periodStart: '1782950476',
      periodEnd: '1782954076',
      totalTwab: '68466435339327356583',
      totalPayout: '3109263465519218066',
      requestId: '3185',
    }),
  }),
  raw({ eventName: 'SeedReceived', logIndex: 2, roundId: 1, payload: JSON.stringify({ drawId: 1, requestId: '3185', seed: '0x01' }) }),
  raw({
    eventName: 'RootProposed',
    logIndex: 3,
    roundId: 1,
    payload: JSON.stringify({ drawId: 1, root: '0x02', winnerCount: 2, totalPayout: '3109263465519218066' }),
  }),
  raw({
    eventName: 'DistributionRegistered',
    logIndex: 4,
    roundId: 1,
    contractAddress: claimManager,
    payload: JSON.stringify({ distributionId, source: drawManager, sourceKey: `0x${'1'.padStart(64, '0')}`, root: '0x02', leafCount: 6 }),
  }),
  raw({
    eventName: 'RootFinalized',
    logIndex: 5,
    roundId: 1,
    payload: JSON.stringify({ drawId: 1, root: '0x02', winnerCount: 2, totalPayout: '3109263465519218066' }),
  }),
  raw({
    eventName: 'ClaimPaid',
    logIndex: 6,
    contractAddress: claimManager,
    wallet: feeRecipient,
    payload: JSON.stringify({ distributionId, leafIndex: '2', account: feeRecipient, token: '0x0000000000000000000000000000000000000000', amount: '100', kind: 1 }),
  }),
  raw({
    eventName: 'ClaimPaid',
    logIndex: 7,
    contractAddress: claimManager,
    wallet: rewardRecipient,
    payload: JSON.stringify({ distributionId, leafIndex: '3', account: rewardRecipient, token: '0x0000000000000000000000000000000000000000', amount: '200', kind: 2 }),
  }),
  raw({
    eventName: 'PrizeCompounded',
    logIndex: 9,
    contractAddress: claimManager,
    wallet,
    payload: JSON.stringify({ distributionId, leafIndex: '0', account: wallet, amount: '3109263465519218066' }),
  }),
  raw({
    eventName: 'ClaimDeferred',
    logIndex: 10,
    contractAddress: claimManager,
    wallet: deferredWinner,
    payload: JSON.stringify({ distributionId, leafIndex: '1', account: deferredWinner, token: '0x0000000000000000000000000000000000000000', amount: '500', kind: 0 }),
  }),
  raw({
    eventName: 'DeferredClaimPaid',
    logIndex: 11,
    contractAddress: claimManager,
    wallet: deferredWinner,
    payload: JSON.stringify({ distributionId, leafIndex: '1', account: deferredWinner, token: '0x0000000000000000000000000000000000000000', amount: '500', kind: 0 }),
  }),
  raw({
    eventName: 'DrawEconomicsSnapshot',
    logIndex: 12,
    roundId: 1,
    payload: JSON.stringify({
      drawId: 1,
      grossYield: '6218526931038436132',
      sponsorYield: '0',
      feeAmount: '0',
      totalPayout: '3109263465519218066',
    }),
  }),
  raw({
    eventName: 'ClaimPaid',
    logIndex: 13,
    contractAddress: claimManager,
    wallet: secondFeeRecipient,
    payload: JSON.stringify({ distributionId, leafIndex: '4', account: secondFeeRecipient, token: '0x0000000000000000000000000000000000000000', amount: '50', kind: 1 }),
  }),
]);

deriveRounds.rebuildFromRaw();
deriveWalletRounds.rebuildFromRaw();

const [round] = roundsRepo.listAll();
assert.equal(round.roundId, 1);
assert.equal(round.poolAddress, drawManager);
assert.equal(round.state, 'settled');
assert.equal(round.winner, wallet);
assert.equal(round.winnerWalletsCount, 2);
assert.equal(round.yieldMon, '6218526931038436132');

const walletRounds = walletRoundsRepo.listByRound(1, drawManager);
assert.equal(walletRounds.length, 2);
const paidWinner = walletRounds.find((row) => row.wallet === wallet);
const paidDeferredWinner = walletRounds.find((row) => row.wallet === deferredWinner);
assert.equal(paidWinner?.won, 1);
assert.equal(paidWinner?.prizeClaimed, '3109263465519218066');
assert.equal(paidDeferredWinner?.won, 1);
assert.equal(paidDeferredWinner?.prizeClaimed, '500');
assert.equal(walletRounds.some((row) => row.wallet === feeRecipient), false);
assert.equal(walletRounds.some((row) => row.wallet === secondFeeRecipient), false);
assert.equal(walletRounds.some((row) => row.wallet === rewardRecipient), false);

console.log('deriveV5Lifecycle.test.ts ok');
