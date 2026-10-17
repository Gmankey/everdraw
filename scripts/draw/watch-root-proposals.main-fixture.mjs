import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Interface, JsonRpcProvider, Network } from 'ethers';
import { readActiveV5Deployment } from '../keeper/v5-deployment.mjs';
import { compute } from './compute-winners.js';

const scenario = process.argv[2];
if (!['valid', 'expired', 'deadline-mismatch', 'finalized-upgrade', 'finalized-invalid', 'finalized-advance', 'finalized-reorg-ack', 'reorg', 'idle'].includes(scenario)) {
  throw new Error(`Unknown watcher fixture scenario ${scenario}`);
}
const isFinalizedScenario = scenario.startsWith('finalized-');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'everdraw-watcher-main-'));
const deployment = readActiveV5Deployment('deployments/monad-mainnet.json', { expectedChainId: 143 });
const addresses = deployment.addresses;
const start = deployment.startBlock;
let latest = start + 4;
for (const name of [
  'DRAW_MANAGER_ADDRESS',
  'WATCHER_FROM_BLOCK',
  'V5_WATCHER_FROM_BLOCK',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'WATCHER_CLAIM_PROOF_URL',
  'WATCHER_CLAIM_PROOF_TOKEN',
  'WATCHER_ACKNOWLEDGED_COVERAGE_GAPS',
]) delete process.env[name];
Object.assign(process.env, {
  DEPLOYMENT_FILE: 'deployments/monad-mainnet.json',
  WATCHER_CHAIN_ID: '143',
  WATCHER_RPC_URL: 'http://security.invalid',
  WATCHER_HEAD_RPC_URL: 'http://head.invalid',
  WATCHER_LOGS_RPC_URL: 'http://discovery.invalid',
  WATCHER_STATE_FILE: path.join(temp, 'state.json'),
  WATCHER_INDEPENDENT_STATE_FILE: path.join(temp, 'independent.json'),
  WATCHER_HEALTHCHECKS_PING_URL: 'http://health.invalid',
  WATCHER_REQUIRE_CLAIM_PROOF_PUBLISH: 'false',
  WATCHER_LOG_CHUNK_SIZE: '100',
  WATCHER_INDEPENDENT_LOG_CHUNK_SIZE: '100',
  WATCHER_RPC_RETRY_ATTEMPTS: '1',
  WATCHER_LOG_CONCURRENCY: '1',
});

const alice = '0x00000000000000000000000000000000000000a1';
const bob = '0x00000000000000000000000000000000000000b1';
const zero = '0x0000000000000000000000000000000000000000';
const payoutToken = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c';
const seed1 = `0x${'11'.repeat(32)}`;
const seed2 = `0x${'22'.repeat(32)}`;
const now = Math.floor(Date.now() / 1000);
const eventDeadline = scenario === 'expired' || isFinalizedScenario ? now - 60 : now + 7_200;
const storedDeadline = scenario === 'deadline-mismatch' ? eventDeadline + 1 : eventDeadline;
let version = 1;
const drawInput = {
  algoVersion: 'everdraw-v5-draw-algorithm/3',
  chainId: '143',
  claimManager: addresses.claimManager,
  drawId: '1',
  drawManager: addresses.drawManager,
  vault: addresses.prizeVault,
  twabController: addresses.twabController,
  seed: seed1,
  seedBlock: start + 1,
  periodStart: '100',
  periodEnd: '200',
  totalTwab: '10',
  totalPayout: '100',
  prizeLegs: [{ token: payoutToken, amount: '100', feeAmount: '0' }],
  feeRecipients: [],
  tierBps: [10_000],
  accounts: [{ address: alice, twab: '10' }],
};
const draw2Input = {
  ...drawInput,
  drawId: '2',
  seed: seed2,
  seedBlock: start + 5,
  periodStart: '200',
  periodEnd: '300',
  accounts: [{ address: bob, twab: '10' }],
};
const draw2Root = compute(draw2Input).root;
const draw2Deadline = now + 7_200;
const proposedRoot = compute(drawInput).root;
const invalidRoot = `0x${'99'.repeat(32)}`;
let chainRoot = scenario === 'finalized-invalid' ? invalidRoot : proposedRoot;
let currentDrawId = scenario === 'idle' ? 0n : 1n;
let currentDrawStatus = isFinalizedScenario ? 4 : 3;
const abi = new Interface([
  'function vault() view returns(address)',
  'function claimManager() view returns(address)',
  'function twabController() view returns(address)',
  'function payoutToken() view returns(address)',
  'function currentDrawId() view returns(uint256)',
  'function challengeEndsAt(uint256) view returns(uint64)',
  'function draws(uint256) view returns(uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)',
  'function drawRewardLegCount(uint256) view returns(uint256)',
  'function drawFeeRecipientCount(uint256) view returns(uint256)',
  'function getTwabBetween(address,address,uint256,uint256) view returns(uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 amount)',
  'event SeedReceived(uint256 indexed drawId,uint64 indexed requestId,bytes32 seed)',
  'event RootProposed(uint256 indexed drawId,bytes32 indexed root,uint32 winnerCount,uint256 totalPayout,address indexed proposer,bytes32 algorithmVersion,uint64 challengeEndsAt)',
  'event RootFinalized(uint256 indexed drawId,bytes32 indexed root,uint32 winnerCount,uint256 totalPayout)',
]);

const counts = {};
let health = 0;
let healthFailures = 0;
const hash = (blockNumber) => `0x${(BigInt(blockNumber) * 10n + BigInt(version)).toString(16).padStart(64, '0')}`;
function count(provider, method) {
  const key = `${provider._getConnection().url}:${method}`;
  counts[key] = (counts[key] || 0) + 1;
}
function eventLog(address, blockNumber, name, args) {
  const encoded = abi.encodeEventLog(abi.getEvent(name), args);
  return {
    address,
    blockNumber,
    blockHash: hash(blockNumber),
    transactionHash: `0x${'44'.repeat(32)}`,
    index: 0,
    logIndex: 0,
    topics: encoded.topics,
    data: encoded.data,
  };
}

JsonRpcProvider.prototype.getNetwork = async function getNetwork() {
  count(this, 'eth_chainId');
  return Network.from(143);
};
JsonRpcProvider.prototype.getCode = async function getCode() {
  count(this, 'eth_getCode');
  return '0x6000';
};
JsonRpcProvider.prototype.getBlockNumber = async function getBlockNumber() {
  count(this, 'eth_blockNumber');
  return latest;
};
JsonRpcProvider.prototype.getBlock = async function getBlock(blockNumber) {
  count(this, 'eth_getBlockByNumber');
  return { number: Number(blockNumber), hash: hash(blockNumber), timestamp: now };
};
JsonRpcProvider.prototype.getLogs = async function getLogs(filter) {
  count(this, 'eth_getLogs');
  if (this._getConnection().url.includes('discovery')) return [];
  const logs = [
    eventLog(addresses.prizeVault, start, 'Transfer', [zero, version === 1 ? alice : bob, 10n]),
    eventLog(addresses.drawManager, start + 1, 'SeedReceived', [1n, 1n, version === 1 ? seed1 : seed2]),
    eventLog(addresses.drawManager, start + 2, 'RootProposed', [1n, chainRoot, 1, 100n, alice, seed1, eventDeadline]),
  ];
  if (isFinalizedScenario) {
    logs.push(eventLog(addresses.drawManager, start + 3, 'RootFinalized', [1n, chainRoot, 1, 100n]));
  }
  if (currentDrawId === 2n && currentDrawStatus >= 2) {
    logs.push(eventLog(addresses.prizeVault, start + 5, 'Transfer', [zero, bob, 10n]));
    logs.push(eventLog(addresses.drawManager, start + 5, 'SeedReceived', [2n, 2n, seed2]));
  }
  if (currentDrawId === 2n && currentDrawStatus >= 3) {
    logs.push(eventLog(addresses.drawManager, start + 6, 'RootProposed', [2n, draw2Root, 1, 100n, bob, seed2, draw2Deadline]));
  }
  if (currentDrawId === 2n && currentDrawStatus >= 4) {
    logs.push(eventLog(addresses.drawManager, start + 7, 'RootFinalized', [2n, draw2Root, 1, 100n]));
  }
  return logs.filter((log) => log.blockNumber >= Number(filter.fromBlock) && log.blockNumber <= Number(filter.toBlock));
};
JsonRpcProvider.prototype.call = async function call(transaction) {
  const parsed = abi.parseTransaction({ data: transaction.data });
  count(this, parsed.name);
  let values;
  switch (parsed.name) {
    case 'vault': values = [addresses.prizeVault]; break;
    case 'claimManager': values = [addresses.claimManager]; break;
    case 'twabController': values = [addresses.twabController]; break;
    case 'payoutToken': values = [payoutToken]; break;
    case 'currentDrawId': values = [currentDrawId]; break;
    case 'challengeEndsAt': values = [BigInt(parsed.args[0]) === 2n ? draw2Deadline : storedDeadline]; break;
    case 'getTwabBetween': values = [parsed.args[1].toLowerCase() === (currentDrawId === 2n || version === 2 ? bob : alice) ? 10n : 0n]; break;
    case 'drawRewardLegCount':
    case 'drawFeeRecipientCount': values = [0n]; break;
    case 'draws': {
      if (BigInt(parsed.args[0]) === 2n) {
        const zeroHash = '0x' + '00'.repeat(32);
        const drawSeed = currentDrawStatus >= 2 ? seed2 : zeroHash;
        const drawRoot = currentDrawStatus >= 3 ? draw2Root : zeroHash;
        values = [200, 300, 2, drawSeed, 10, 100, 1, 0, drawRoot, currentDrawStatus >= 3 ? draw2Deadline - 28_800 : 0, bob, currentDrawStatus, 100, 0, 0];
      } else {
        values = [100, 200, 1, version === 1 ? seed1 : seed2, 10, 100, 1, 0, chainRoot, eventDeadline - 28_800, alice, isFinalizedScenario ? 4 : 3, 100, 0, 0];
      }
      break;
    }
    default: throw new Error(`Unexpected call ${parsed.name}`);
  }
  return abi.encodeFunctionResult(parsed.fragment, values);
};
global.fetch = async (url) => {
  const target = String(url);
  if (target === 'http://health.invalid') health += 1;
  else if (target === 'http://health.invalid/fail') healthFailures += 1;
  else assert.fail(`Unexpected fetch ${target}`);
  return { ok: true };
};

const initialState = {
  version: 3,
  chainId: '143',
  drawManagerAddress: addresses.drawManager,
  vaultAddress: addresses.prizeVault,
  fromBlock: start,
  lastScannedBlock: isFinalizedScenario ? latest : start - 1,
  lastScannedBlockHash: hash(isFinalizedScenario ? latest : start - 1),
  participantAccounts: isFinalizedScenario ? [alice] : [],
  seedBlocks: isFinalizedScenario ? { '1': start + 1 } : {},
  liveMonitoring: true,
};
fs.writeFileSync(process.env.WATCHER_STATE_FILE, JSON.stringify(initialState));
if (isFinalizedScenario) {
  fs.writeFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, JSON.stringify({ version: 2 }));
}
const { main } = await import('./watch-root-proposals.mjs');

if (scenario === 'valid') {
  await main();
  assert.equal(health, 1);
  assert.ok((counts['http://head.invalid:challengeEndsAt'] || 0) > 0);
} else if (scenario === 'expired' || scenario === 'deadline-mismatch') {
  await assert.rejects(main(), /coverage failure/);
  assert.equal(health, 0);
  assert.ok((counts['http://head.invalid:challengeEndsAt'] || 0) > 0);
} else if (scenario === 'finalized-advance') {
  await assert.rejects(main(), /coverage failure/);
  assert.equal(health, 0);
  const pending = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
  const incidentId = Object.keys(pending.coverageIncidents)[0];
  assert.ok(incidentId);
  currentDrawId = 2n;
  for (const [status, head] of [[1, start + 5], [2, start + 5], [3, start + 6], [4, start + 7]]) {
    currentDrawStatus = status;
    latest = head;
    await assert.rejects(main(), /coverage failure/);
    const persisted = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
    assert.equal(persisted.coverageIncidents[incidentId].acknowledgedAt, null);
    assert.equal(health, 0, 'an earlier unresolved incident must block health at status ' + status);
  }
  process.env.WATCHER_ACKNOWLEDGED_COVERAGE_GAPS = incidentId;
  await main();
  assert.equal(health, 1, 'the past-draw incident can be acknowledged after draw advancement');
} else if (scenario === 'finalized-reorg-ack') {
  await assert.rejects(main(), /coverage failure/);
  const first = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
  const firstIncidentId = Object.keys(first.coverageIncidents)[0];
  process.env.WATCHER_ACKNOWLEDGED_COVERAGE_GAPS = firstIncidentId;
  await main();
  assert.equal(health, 1);
  const oldRoot = chainRoot;
  version = 2;
  chainRoot = compute({ ...drawInput, seed: seed2, accounts: [{ address: bob, twab: '10' }] }).root;
  assert.notEqual(chainRoot, oldRoot);
  await assert.rejects(main(), /coverage failure/);
  const replacement = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
  const incidents = Object.values(replacement.coverageIncidents);
  assert.equal(incidents.length, 2, 'the superseded incident remains in the audit record');
  const oldIncident = incidents.find((incident) => incident.id === firstIncidentId);
  const newIncident = incidents.find((incident) => !incident.supersededAt);
  assert.equal(oldIncident.resolution, 'replaced-by-canonical-evidence');
  assert.ok(oldIncident.supersededAt);
  assert.notEqual(newIncident.id, firstIncidentId);
  assert.equal(newIncident.root, chainRoot);
  assert.equal(newIncident.acknowledgedAt, null);
  assert.equal(health, 1, 'the retained old token cannot approve replacement evidence');
  process.env.WATCHER_ACKNOWLEDGED_COVERAGE_GAPS = newIncident.id;
  await main();
  assert.equal(health, 2, 'replacement evidence needs its own operator acknowledgment');
} else if (scenario === 'finalized-upgrade') {
  await assert.rejects(main(), /coverage failure/);
  assert.equal(health, 0);
  assert.equal(healthFailures, 1, 'the historical coverage incident must alert once');
  const securityCallsAfterRecovery = Object.entries(counts)
    .filter(([key]) => key.startsWith('http://security.invalid:'))
    .reduce((sum, [, value]) => sum + value, 0);
  await assert.rejects(main(), /coverage failure/);
  const securityCallsAfterIdleRetry = Object.entries(counts)
    .filter(([key]) => key.startsWith('http://security.invalid:'))
    .reduce((sum, [, value]) => sum + value, 0);
  assert.equal(securityCallsAfterIdleRetry, securityCallsAfterRecovery, 'an unacknowledged idle retry must not reconstruct again');
  assert.equal(healthFailures, 1, 'an existing historical incident must not alert every cycle');
  const pending = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
  const incidentIds = Object.keys(pending.coverageIncidents);
  assert.equal(incidentIds.length, 1);
  process.env.WATCHER_ACKNOWLEDGED_COVERAGE_GAPS = incidentIds[0];
  await main();
  assert.equal(health, 1, 'health recovers only after explicit operator acknowledgment');
  const securityCallsAfterAcknowledgment = Object.entries(counts)
    .filter(([key]) => key.startsWith('http://security.invalid:'))
    .reduce((sum, [, value]) => sum + value, 0);
  assert.equal(securityCallsAfterAcknowledgment, securityCallsAfterRecovery, 'acknowledgment must not trigger reconstruction');
  const recovered = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
  assert.equal(recovered.verifiedRoots['1'], undefined, 'historical recovery must not claim timely live verification');
  assert.ok(recovered.historicalFinalizedRoots['1']);
  assert.ok(recovered.coverageIncidents[incidentIds[0]].acknowledgedAt);
} else if (scenario === 'finalized-invalid') {
  await assert.rejects(main(), /coverage failure/);
  assert.equal(health, 0);
  const rejected = JSON.parse(fs.readFileSync(process.env.WATCHER_INDEPENDENT_STATE_FILE, 'utf8'));
  assert.equal(rejected.historicalFinalizedRoots['1'], undefined);
} else if (scenario === 'reorg') {
  await main();
  assert.equal(health, 1);
  const securityScans = counts['http://security.invalid:eth_getLogs'] || 0;
  version = 2;
  assert.notEqual(compute({ ...drawInput, seed: seed2, accounts: [{ address: bob, twab: '10' }] }).root, proposedRoot);
  await assert.rejects(main(), /coverage failure/);
  assert.equal(health, 1, 'a reorg-invalidated root must not emit a second healthy heartbeat');
  assert.ok((counts['http://security.invalid:eth_getLogs'] || 0) > securityScans, 'security history must be rescanned after reorg');
} else {
  await main();
  assert.equal(health, 1);
  const securityCalls = Object.entries(counts)
    .filter(([key]) => key.startsWith('http://security.invalid:'))
    .reduce((sum, [, value]) => sum + value, 0);
  assert.equal(securityCalls, 0, 'an idle no-root cycle must not call the paid security provider');
}

console.log(JSON.stringify({ scenario, health, counts }));
