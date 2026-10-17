import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Interface } from "ethers";
import {
  coverageIncidentId,
  IndependentWatcherCache,
} from "./independent-watcher-cache.mjs";

const vault = "0x0000000000000000000000000000000000000011";
const manager = "0x0000000000000000000000000000000000000022";
const alice = "0x00000000000000000000000000000000000000a1";
const zero = "0x0000000000000000000000000000000000000000";
const root = "0x" + "33".repeat(32);
const iface = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
  "event SeedReceived(uint256 indexed drawId,uint64 indexed requestId,bytes32 seed)",
  "event RootProposed(uint256 indexed drawId,bytes32 indexed root,uint32 winnerCount,uint256 totalPayout,address indexed proposer,bytes32 algorithmVersion,uint64 challengeEndsAt)",
  "event RootFinalized(uint256 indexed drawId,bytes32 indexed root,uint32 winnerCount,uint256 totalPayout)",
]);

function log(address, blockNumber, name, args) {
  const encoded = iface.encodeEventLog(iface.getEvent(name), args);
  return {
    address,
    blockNumber,
    blockHash: "0x" + blockNumber.toString(16).padStart(64, "0"),
    transactionHash: "0x" + (blockNumber + 1000).toString(16).padStart(64, "0"),
    index: 0,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function provider(logs) {
  return {
    async getBlock(blockNumber) {
      return { hash: "0x" + Number(blockNumber).toString(16).padStart(64, "0") };
    },
    async getLogs({ fromBlock, toBlock }) {
      return logs.filter((entry) => entry.blockNumber >= Number(fromBlock) && entry.blockNumber <= Number(toBlock));
    },
  };
}

test("independent cache fails closed when the discovery provider saw a proposal omitted by the security RPC", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-independent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cache = new IndependentWatcherCache({
    file: path.join(dir, "state.json"),
    chainId: 143n,
    drawManagerAddress: manager,
    vaultAddress: vault,
    fromBlock: 100,
  });
  const securityLogs = [
    log(vault, 100, "Transfer", [zero, alice, 1n]),
    log(manager, 101, "SeedReceived", [1n, 9n, root]),
  ];
  await cache.syncThrough(provider(securityLogs), 103, { chunkSize: 4 });
  assert.throws(
    () => cache.assertEvent("proposals", 1n, root),
    /missing\/mismatched proposals event/,
  );
  assert.deepEqual(cache.accounts().map((value) => value.toLowerCase()), [alice]);
  assert.equal(cache.seedBlock(1n), 101);
});

test("independent cache accepts and persists a canonically verified proposal", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-independent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, "state.json");
  const securityLogs = [
    log(vault, 100, "Transfer", [zero, alice, 1n]),
    log(manager, 101, "SeedReceived", [1n, 9n, root]),
    log(manager, 102, "RootProposed", [1n, root, 1, 1n, alice, root, 9999]),
    log(manager, 103, "RootFinalized", [1n, root, 1, 1n]),
  ];
  const cache = new IndependentWatcherCache({
    file: cacheFile,
    chainId: 143n,
    drawManagerAddress: manager,
    vaultAddress: vault,
    fromBlock: 100,
  });
  await cache.syncThrough(provider(securityLogs), 103, { chunkSize: 4 });
  assert.equal(cache.assertEvent("proposals", 1n, root).blockNumber, 102);
  const proposalEvidence = await cache.assertEvidenceCanonical(provider(securityLogs), "proposals", 1n, root);
  const finalizationEvidence = await cache.assertEvidenceCanonical(provider(securityLogs), "finalizations", 1n, root);
  cache.markVerified(1n, proposalEvidence);
  cache.markFinalizationHandled(1n, finalizationEvidence);

  const restored = new IndependentWatcherCache({
    file: cacheFile,
    chainId: 143n,
    drawManagerAddress: manager,
    vaultAddress: vault,
    fromBlock: 100,
  });
  assert.equal(restored.verifiedRoot(1n), root);
  assert.equal(restored.finalizationHandled(1n, root), true);
});

test("historical finalized integrity remains distinct from timely proposal verification", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-independent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, "state.json");
  const securityLogs = [
    log(vault, 100, "Transfer", [zero, alice, 1n]),
    log(manager, 101, "SeedReceived", [1n, 9n, root]),
    log(manager, 102, "RootProposed", [1n, root, 1, 1n, alice, root, 9999]),
    log(manager, 103, "RootFinalized", [1n, root, 1, 1n]),
  ];
  const cache = new IndependentWatcherCache({
    file: cacheFile,
    chainId: 143n,
    drawManagerAddress: manager,
    vaultAddress: vault,
    fromBlock: 100,
  });
  await cache.syncThrough(provider(securityLogs), 103, { chunkSize: 4 });
  const proposalEvidence = await cache.assertEvidenceCanonical(provider(securityLogs), "proposals", 1n, root);
  const finalizationEvidence = await cache.assertEvidenceCanonical(provider(securityLogs), "finalizations", 1n, root);
  const recoveryEvidence = { proposalEvidence, finalizationEvidence };
  const incidentId = coverageIncidentId(1n, root, recoveryEvidence, cache.scope);

  assert.equal(cache.verifiedRoot(1n), undefined);
  assert.equal(cache.recordCoverageIncident(1n, root, recoveryEvidence), true);
  assert.equal(cache.recordCoverageIncident(1n, root, recoveryEvidence), false);
  cache.markHistoricalFinalizedIntegrity(1n, recoveryEvidence);
  assert.equal(cache.verifiedRoot(1n), undefined, "historical recovery must not claim timely live verification");
  assert.equal(cache.historicalFinalizedRoot(1n), root);
  assert.equal(cache.integrityVerifiedRoot(1n), root);
  assert.equal(cache.coverageIncident(incidentId).notifiedAt, null);
  assert.equal(cache.markCoverageIncidentNotified(incidentId), true);
  assert.equal(cache.markCoverageIncidentNotified(incidentId), false);
  assert.equal(cache.coverageIncident(incidentId).acknowledgedAt, null);
  assert.equal(cache.acknowledgeCoverageIncident(incidentId, "test-operator"), true);
  assert.deepEqual(cache.unresolvedCoverageIncidents(), []);

  const restored = new IndependentWatcherCache({
    file: cacheFile,
    chainId: 143n,
    drawManagerAddress: manager,
    vaultAddress: vault,
    fromBlock: 100,
  });
  assert.equal(restored.integrityVerifiedRoot(1n), root);
  assert.ok(restored.coverageIncident(incidentId).notifiedAt);
  assert.equal(restored.coverageIncident(incidentId).acknowledgment, "test-operator");
});

test("coverage acknowledgment is retained only for identical canonical evidence", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-independent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, "state.json");
  const cache = new IndependentWatcherCache({
    file: cacheFile,
    chainId: 143n,
    drawManagerAddress: manager,
    vaultAddress: vault,
    fromBlock: 100,
  });
  const evidenceFor = (valueRoot, suffix) => ({
    proposalEvidence: {
      root: valueRoot,
      eventBlockNumber: 102,
      eventBlockHash: "0x" + suffix.repeat(32),
      seedBlockNumber: 101,
      seedBlockHash: "0x" + "11".repeat(32),
      seed: "0x" + "22".repeat(32),
    },
    finalizationEvidence: {
      root: valueRoot,
      eventBlockNumber: 103,
      eventBlockHash: "0x" + suffix.repeat(32),
      seedBlockNumber: 101,
      seedBlockHash: "0x" + "11".repeat(32),
      seed: "0x" + "22".repeat(32),
    },
  });
  const firstEvidence = evidenceFor(root, "44");
  const firstId = coverageIncidentId(1n, root, firstEvidence, cache.scope);
  assert.notEqual(
    coverageIncidentId(1n, root, firstEvidence, { ...cache.scope, fromBlock: 99 }),
    firstId,
    "incident acknowledgments are deployment-scoped",
  );
  cache.recordCoverageIncident(1n, root, firstEvidence);
  cache.acknowledgeCoverageIncident(firstId, "reviewed:" + firstId);

  cache.state.lastScannedBlock = 103;
  cache.state.lastScannedBlockHash = "0x" + "55".repeat(32);
  assert.equal(
    await cache.ensureCanonical({ getBlock: async () => ({ hash: "0x" + "66".repeat(32) }) }),
    false,
  );
  assert.equal(cache.recordCoverageIncident(1n, root, firstEvidence), false);
  assert.ok(cache.coverageIncident(firstId).acknowledgedAt, "identical evidence retains its reviewed resolution");
  assert.deepEqual(cache.unresolvedCoverageIncidents(), []);

  const replacementEvidence = evidenceFor(root, "77");
  const replacementId = coverageIncidentId(1n, root, replacementEvidence, cache.scope);
  assert.notEqual(replacementId, firstId);
  assert.equal(cache.recordCoverageIncident(1n, root, replacementEvidence), true);
  assert.equal(cache.coverageIncident(firstId).resolution, "replaced-by-canonical-evidence");
  assert.ok(cache.coverageIncident(firstId).supersededAt);
  assert.equal(cache.coverageIncident(replacementId).acknowledgedAt, null);
  assert.deepEqual(
    cache.unresolvedCoverageIncidents().map((incident) => incident.id),
    [replacementId],
    "same root with different canonical evidence needs a new review",
  );

  const changedRoot = "0x" + "88".repeat(32);
  const changedEvidence = evidenceFor(changedRoot, "99");
  const changedId = coverageIncidentId(1n, changedRoot, changedEvidence, cache.scope);
  assert.equal(cache.recordCoverageIncident(1n, changedRoot, changedEvidence), true);
  assert.equal(cache.coverageIncident(replacementId).resolution, "replaced-by-canonical-evidence");
  assert.equal(cache.coverageIncident(changedId).acknowledgedAt, null);
  assert.deepEqual(
    cache.unresolvedCoverageIncidents().map((incident) => incident.id),
    [changedId],
    "changed root needs a new review",
  );
});
