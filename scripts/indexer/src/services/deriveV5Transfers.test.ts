import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createV5TranchesRepo } from '../repositories/v5TranchesRepo.js';
import { createDeriveV5TranchesService, firstFullWeightDrawId } from './deriveV5Tranches.js';
import type { RawEventRow } from '../types/domain.js';

const vault = '0x0000000000000000000000000000000000000a11';
const drawManager = '0x0000000000000000000000000000000000000d22';
const sender = '0x00000000000000000000000000000000000000aa';
const recipient = '0x00000000000000000000000000000000000000bb';
const nextRecipient = '0x00000000000000000000000000000000000000cc';
const zero = '0x0000000000000000000000000000000000000000';

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
    wallet: partial.wallet ?? null,
    amountMon: partial.amountMon ?? null,
    payload: partial.payload,
    finalized: partial.finalized ?? 1,
    createdAt: '2026-07-02T00:00:00.000Z',
  };
}

const db = new Database(':memory:');
applySchema(db);
const rawEventsRepo = createRawEventsRepo(db);
const v5TranchesRepo = createV5TranchesRepo(db);
const service = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo);

rawEventsRepo.upsertMany([
  raw({
    eventName: 'DrawStarted',
    logIndex: 1,
    contractAddress: drawManager,
    roundId: 7,
    payload: JSON.stringify({ drawId: 7, periodStart: 1782950400, periodEnd: 1782954000 }),
  }),
  // ERC-20 mint events mirror the vault Deposit events and must not double-credit.
  raw({ eventName: 'Transfer', logIndex: 2, payload: JSON.stringify({ from: zero, to: sender, amount: '100' }) }),
  raw({ eventName: 'Deposit', logIndex: 3, payload: JSON.stringify({ recipient: sender, amount: '100' }) }),
  raw({
    eventName: 'Transfer',
    logIndex: 4,
    blockTimestamp: '2026-07-02T00:20:00.000Z',
    payload: JSON.stringify({ from: zero, to: sender, amount: '50' }),
  }),
  raw({
    eventName: 'Deposit',
    logIndex: 5,
    blockTimestamp: '2026-07-02T00:20:00.000Z',
    payload: JSON.stringify({ recipient: sender, amount: '50' }),
  }),
  raw({
    eventName: 'Transfer',
    logIndex: 6,
    blockTimestamp: '2026-07-02T00:30:00.000Z',
    payload: JSON.stringify({ from: sender, to: recipient, amount: '60' }),
  }),
  raw({
    eventName: 'Transfer',
    logIndex: 7,
    blockTimestamp: '2026-07-02T00:40:00.000Z',
    payload: JSON.stringify({ from: recipient, to: nextRecipient, amount: '20' }),
  }),
]);

service.rebuildFromRaw();
service.rebuildFromRaw();

const senderTranches = v5TranchesRepo.listByWallet(sender);
assert.deepEqual(senderTranches.map((row) => row.remainingAmount), ['90', '0']);
assert.equal(senderTranches[1].closedLogIndex, 6);

const recipientTranches = v5TranchesRepo.listByWallet(recipient);
assert.equal(recipientTranches.length, 1);
assert.equal(recipientTranches[0].amount, '60');
assert.equal(recipientTranches[0].remainingAmount, '40');
assert.equal(recipientTranches[0].startDrawId, 7);
assert.equal(firstFullWeightDrawId(recipientTranches[0].startDrawId), 8);

const chainedTranches = v5TranchesRepo.listByWallet(nextRecipient);
assert.equal(chainedTranches.length, 1);
assert.equal(chainedTranches[0].remainingAmount, '20');
assert.equal(chainedTranches[0].startDrawId, 7);

assert.deepEqual(
  v5TranchesRepo.listPositionEvents(sender).map((event) => [event.action, event.source, event.amount]),
  [
    ['deposit', 'user', '100'],
    ['deposit', 'user', '50'],
    ['transfer_out', 'transfer', '60'],
  ]
);
assert.deepEqual(
  v5TranchesRepo.listPositionEvents(recipient).map((event) => [event.action, event.source, event.amount]),
  [
    ['transfer_in', 'transfer', '60'],
    ['transfer_out', 'transfer', '20'],
  ]
);
assert.deepEqual(
  v5TranchesRepo.listPositionEvents(nextRecipient).map((event) => [event.action, event.source, event.amount]),
  [['transfer_in', 'transfer', '20']]
);

assert.equal(v5TranchesRepo.sumOpenRemaining(sender, vault, 'vault'), '90');
assert.equal(v5TranchesRepo.sumOpenRemaining(recipient, vault, 'vault'), '40');
assert.equal(v5TranchesRepo.sumOpenRemaining(nextRecipient, vault, 'vault'), '20');

const migrationDb = new Database(':memory:');
migrationDb.exec(`
  CREATE TABLE v5_position_events (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    block_timestamp TEXT NOT NULL,
    vault_address TEXT NOT NULL,
    wallet TEXT NOT NULL,
    pool_type TEXT NOT NULL CHECK (pool_type IN ('vault', 'degen')),
    action TEXT NOT NULL CHECK (action IN ('deposit', 'withdraw')),
    amount TEXT NOT NULL,
    balance_after TEXT,
    raw_event_name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'prize_compound')),
    PRIMARY KEY (tx_hash, log_index)
  );
`);
applySchema(migrationDb);
const migratedSql = migrationDb.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'v5_position_events'"
).get() as { sql: string };
assert.match(migratedSql.sql, /transfer_in/);
assert.match(migratedSql.sql, /PRIMARY KEY \(tx_hash, log_index, wallet\)/);
const migratedRepo = createV5TranchesRepo(migrationDb);
for (const [entryWallet, action] of [[sender, 'transfer_out'], [recipient, 'transfer_in']] as const) {
  migratedRepo.insertPositionEvent({
    txHash: `0x${'ab'.repeat(32)}`,
    logIndex: 1,
    blockNumber: 100,
    blockTimestamp: '2026-07-02T00:30:00.000Z',
    vaultAddress: vault,
    wallet: entryWallet,
    poolType: 'vault',
    action,
    amount: '10',
    balanceAfter: null,
    rawEventName: 'Transfer',
    source: 'transfer',
  });
}
assert.equal(migratedRepo.listPositionEvents(sender).length, 1);
assert.equal(migratedRepo.listPositionEvents(recipient).length, 1);

console.log('deriveV5Transfers.test.ts ok');
