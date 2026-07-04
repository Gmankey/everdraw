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

function raw(partial: Partial<RawEventRow> & Pick<RawEventRow, 'eventName' | 'logIndex' | 'payload'>): RawEventRow {
  return {
    txHash: `0x${partial.logIndex.toString(16).padStart(64, '0')}`,
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

rawEventsRepo.upsertMany([
  raw({
    eventName: 'BoostWithdraw',
    logIndex: 6,
    blockTimestamp: '2026-07-02T00:35:00.000Z',
    payload: JSON.stringify({ booster: wallet, amount: '10', balance: '999' }),
  }),
]);

assert.throws(
  () => service.rebuildFromRaw(),
  /V5 tranche balance drift after BoostWithdraw/
);

console.log('deriveV5Tranches.test.ts ok');
