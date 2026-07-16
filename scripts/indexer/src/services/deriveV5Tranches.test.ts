import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createDeriveV5TranchesService, firstFullWeightDrawId } from './deriveV5Tranches.js';
import type { RawEventRow } from '../types/domain.js';

const db = new Database(':memory:');
applySchema(db);

const rawEventsRepo = createRawEventsRepo(db);
const v5TranchesRepo = createV5TranchesRepo(db);
const service = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo);

const vault = '0x0000000000000000000000000000000000000a11';
const drawManager = '0x0000000000000000000000000000000000000d22';
const wallet = '0x00000000000000000000000000000000000000aa';
const compoundWallet = '0x00000000000000000000000000000000000000bb';
const claimManager = '0x0000000000000000000000000000000000000c33';

function raw(partial: Partial<RawEventRow> & Pick<RawEventRow, 'eventName' | 'logIndex' | 'payload'>): RawEventRow {
  return {
    txHash: partial.txHash ?? `0x${partial.logIndex.toString(16).padStart(64, '0')}`,
    logIndex: partial.logIndex,
    blockNumber: partial.blockNumber ?? 100,
    blockHash: `0x${partial.logIndex.toString(16).padStart(64, '1')}`,
    blockTimestamp: partial.blockTimestamp ?? '2026-07-02T00:10:00.000Z',
    contractAddress: partial.contractAddress ?? vault,
    eventName: partial.eventName,
    roundId: partial.roundId ?? null,
    wallet: partial.wallet ?? wallet,
    amountMon: partial.amountMon ?? null,
    payload: partial.payload,
    finalized: partial.finalized ?? 1,
    createdAt: '2026-07-02T00:00:00.000Z',
  };
}

rawEventsRepo.upsertMany([
  raw({
    eventName: 'DrawStarted',
    logIndex: 1,
    contractAddress: drawManager,
    roundId: 7,
    payload: JSON.stringify({ drawId: 7, periodStart: 1782950400, periodEnd: 1782954000 }),
  }),
  raw({
    eventName: 'Deposit',
    logIndex: 2,
    payload: JSON.stringify({ recipient: wallet, amount: '100' }),
  }),
  raw({
    eventName: 'Deposit',
    logIndex: 3,
    blockTimestamp: '2026-07-02T00:20:00.000Z',
    payload: JSON.stringify({ recipient: wallet, amount: '50' }),
  }),
  raw({
    eventName: 'BoostDeposit',
    logIndex: 4,
    blockTimestamp: '2026-07-02T00:25:00.000Z',
    payload: JSON.stringify({ booster: wallet, amount: '40', balance: '40' }),
  }),
  raw({
    eventName: 'Withdraw',
    logIndex: 5,
    blockTimestamp: '2026-07-02T00:30:00.000Z',
    payload: JSON.stringify({ recipient: wallet, amount: '60' }),
  }),
]);

service.rebuildFromRaw();
service.rebuildFromRaw();

const tranches = v5TranchesRepo.listByWallet(wallet);
assert.equal(tranches.length, 3);

const vaultTranches = tranches.filter((row) => row.poolType === 'vault');
assert.equal(vaultTranches.length, 2);
assert.equal(vaultTranches[0].amount, '100');
assert.equal(vaultTranches[0].remainingAmount, '90');
assert.equal(vaultTranches[0].closedAt, null);
assert.equal(vaultTranches[1].amount, '50');
assert.equal(vaultTranches[1].remainingAmount, '0');
assert.equal(vaultTranches[1].closedBlockNumber, 100);

const degenTranches = tranches.filter((row) => row.poolType === 'degen');
assert.equal(degenTranches.length, 1);
assert.equal(degenTranches[0].remainingAmount, '40');
assert.equal(vaultTranches[0].startDrawId, 7);
assert.equal(firstFullWeightDrawId(vaultTranches[0].startDrawId), 8);
assert.equal(v5TranchesRepo.sumOpenRemaining(wallet, vault, 'degen'), '40');

const events = v5TranchesRepo.listPositionEvents(wallet);
assert.equal(events.length, 4);
assert.deepEqual(events.map((event) => `${event.poolType}:${event.action}:${event.amount}`), [
  'vault:deposit:100',
  'vault:deposit:50',
  'degen:deposit:40',
  'vault:withdraw:60',
]);

const compoundTx = `0x${'abc'.padStart(64, '0')}`;
rawEventsRepo.upsertMany([
  raw({
    eventName: 'Deposit',
    logIndex: 9,
    txHash: compoundTx,
    contractAddress: vault,
    wallet: compoundWallet,
    payload: JSON.stringify({ recipient: compoundWallet, amount: '24' }),
  }),
  raw({
    eventName: 'PrizeCompounded',
    logIndex: 10,
    txHash: compoundTx,
    contractAddress: claimManager,
    wallet: compoundWallet,
    payload: JSON.stringify({
      distributionId: `0x${'da'.padStart(64, '0')}`,
      leafIndex: '0',
      account: compoundWallet,
      amount: '25',
    }),
  }),
  raw({
    eventName: 'Deposit',
    logIndex: 11,
    txHash: compoundTx,
    contractAddress: vault,
    wallet: compoundWallet,
    payload: JSON.stringify({ recipient: compoundWallet, amount: '14' }),
  }),
  raw({
    eventName: 'PrizeCompounded',
    logIndex: 12,
    txHash: compoundTx,
    contractAddress: claimManager,
    wallet: compoundWallet,
    payload: JSON.stringify({
      distributionId: `0x${'db'.padStart(64, '0')}`,
      leafIndex: '1',
      account: compoundWallet,
      amount: '15',
    }),
  }),
]);

service.rebuildFromRaw();

const compoundEvents = v5TranchesRepo.listPositionEvents(compoundWallet);
assert.equal(compoundEvents.length, 2);
assert.equal(compoundEvents.every((event) => event.rawEventName === 'Deposit'), true);
assert.equal(compoundEvents.every((event) => event.source === 'prize_compound'), true);
assert.deepEqual(compoundEvents.map((event) => event.amount), ['24', '14']);
const compoundTranches = v5TranchesRepo.listByWallet(compoundWallet);
assert.equal(compoundTranches.length, 2);
assert.deepEqual(compoundTranches.map((tranche) => tranche.remainingAmount), ['24', '14']);
assert.equal(compoundTranches.every((tranche) => tranche.startDrawId === 7), true);

rawEventsRepo.upsertMany([
  raw({
    eventName: 'Withdraw',
    logIndex: 6,
    blockTimestamp: '2026-07-02T00:35:00.000Z',
    payload: JSON.stringify({ recipient: wallet, amount: '90', balance: '0' }),
  }),
  raw({
    eventName: 'BoostWithdraw',
    logIndex: 7,
    blockTimestamp: '2026-07-02T00:40:00.000Z',
    payload: JSON.stringify({ booster: wallet, amount: '40', balance: '0' }),
  }),
]);

service.rebuildFromRaw();

assert.equal(v5TranchesRepo.sumOpenRemaining(wallet, vault, 'vault'), '0');
assert.equal(v5TranchesRepo.sumOpenRemaining(wallet, vault, 'degen'), '0');
const closedTranches = v5TranchesRepo.listByWallet(wallet);
assert.equal(closedTranches.every((row) => row.remainingAmount === '0' && row.closedAt != null), true);

rawEventsRepo.upsertMany([
  raw({
    eventName: 'BoostWithdraw',
    logIndex: 8,
    blockTimestamp: '2026-07-02T00:45:00.000Z',
    payload: JSON.stringify({ booster: wallet, amount: '10', balance: '999' }),
  }),
]);

assert.throws(
  () => service.rebuildFromRaw(),
  /V5 tranche balance drift after BoostWithdraw/
);

console.log('deriveV5Tranches.test.ts ok');
