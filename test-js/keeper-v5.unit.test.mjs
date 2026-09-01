import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Interface, getAddress } from "ethers";

process.env.WATCHER_LOGS_RPC_URL = "provider";
process.env.WATCHER_LOG_CHUNK_SIZE = "1000";
process.env.WATCHER_LOG_CONCURRENCY = "1";

const { DrawInputEventCache } = await import("../scripts/draw/write-watch-inputs.mjs");
const { claimDrawIds, firstRecentDrawId } = await import("../scripts/keeper-v5.js");

const VAULT = "0x1000000000000000000000000000000000000001";
const MANAGER = "0x2000000000000000000000000000000000000002";
const ACCOUNT_A = "0x3000000000000000000000000000000000000003";
const ACCOUNT_B = "0x4000000000000000000000000000000000000004";

class FakeLogsProvider {
  constructor(logs) {
    this.logs = logs;
    this.calls = [];
  }

  async getNetwork() {
    return { chainId: 10143n };
  }

  async getBlock(blockNumber) {
    return { number: Number(blockNumber), hash: blockHash(blockNumber) };
  }

  async getLogs(filter) {
    this.calls.push({ address: filter.address, fromBlock: Number(filter.fromBlock), toBlock: Number(filter.toBlock), topics: filter.topics });
    return this.logs.filter((log) => {
      if (getAddress(log.address) !== getAddress(filter.address)) return false;
      if (log.blockNumber < Number(filter.fromBlock) || log.blockNumber > Number(filter.toBlock)) return false;
      return (filter.topics || []).every((topic, index) => {
        if (!topic) return true;
        const actual = log.topics[index]?.toLowerCase();
        return Array.isArray(topic)
          ? topic.some((candidate) => candidate.toLowerCase() === actual)
          : topic.toLowerCase() === actual;
      });
    });
  }
}

function blockHash(blockNumber) {
  return '0x' + BigInt(blockNumber).toString(16).padStart(64, '0');
}

function encodedLog({ iface, event, address, args, blockNumber, logIndex }) {
  const encoded = iface.encodeEventLog(iface.getEvent(event), args);
  return {
    address,
    blockNumber,
    blockHash: blockHash(blockNumber),
    logIndex,
    index: logIndex,
    topics: encoded.topics,
    data: encoded.data,
  };
}

test("firstRecentDrawId keeps the configured recent claim window", () => {
  assert.equal(firstRecentDrawId(0n, 5), 1n);
  assert.equal(firstRecentDrawId(1n, 5), 1n);
  assert.equal(firstRecentDrawId(5n, 5), 1n);
  assert.equal(firstRecentDrawId(6n, 5), 2n);
  assert.equal(firstRecentDrawId(12n, 5), 8n);
});

test("firstRecentDrawId rejects invalid windows", () => {
  assert.throws(() => firstRecentDrawId(12n, 0), /Invalid recent draw window/);
});

test("claimDrawIds includes old draws finalized this cycle plus the recent window", () => {
  assert.deepEqual(claimDrawIds([2n, 9n], 7n, 10n), [2n, 7n, 8n, 9n, 10n]);
});

test("DrawInputEventCache scans only new deposit and seed blocks after the initial backfill", async () => {
  const vaultIface = new Interface(["event Deposit(address indexed recipient,uint256 amount)"]);
  const managerIface = new Interface(["event SeedReceived(uint256 indexed drawId, uint64 indexed requestId, bytes32 seed)"]);
  const logs = [
    encodedLog({ iface: vaultIface, event: "Deposit", address: VAULT, args: [ACCOUNT_A, 10n], blockNumber: 120, logIndex: 0 }),
    encodedLog({ iface: managerIface, event: "SeedReceived", address: MANAGER, args: [1n, 11n, "0x" + "11".repeat(32)], blockNumber: 180, logIndex: 0 }),
    encodedLog({ iface: vaultIface, event: "Deposit", address: VAULT, args: [ACCOUNT_B, 20n], blockNumber: 240, logIndex: 0 }),
    encodedLog({ iface: managerIface, event: "SeedReceived", address: MANAGER, args: [2n, 12n, "0x" + "22".repeat(32)], blockNumber: 250, logIndex: 0 }),
  ];
  const provider = new FakeLogsProvider(logs);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-cache-test-"));
  const file = path.join(dir, "cache.json");
  const cache = new DrawInputEventCache({ file, drawManagerAddress: MANAGER });

  assert.equal(await cache.seedBlockFor({ provider, drawManagerAddress: MANAGER, vaultAddress: VAULT, drawId: 1n, fromBlock: 100, toBlock: 200 }), 180);
  assert.deepEqual(await cache.participantAccounts({ provider, drawManagerAddress: MANAGER, vaultAddress: VAULT, fromBlock: 100, toBlock: 200 }), [getAddress(ACCOUNT_A)]);
  assert.deepEqual(provider.calls.map((call) => [call.fromBlock, call.toBlock]), [[100, 200], [100, 200]]);

  assert.equal(await cache.seedBlockFor({ provider, drawManagerAddress: MANAGER, vaultAddress: VAULT, drawId: 2n, fromBlock: 100, toBlock: 260 }), 250);
  assert.deepEqual(await cache.participantAccounts({ provider, drawManagerAddress: MANAGER, vaultAddress: VAULT, fromBlock: 100, toBlock: 260 }), [getAddress(ACCOUNT_A), getAddress(ACCOUNT_B)]);
  assert.deepEqual(provider.calls.map((call) => [call.fromBlock, call.toBlock]), [[100, 200], [100, 200], [201, 260], [201, 260]]);

  const reloaded = new DrawInputEventCache({ file, drawManagerAddress: MANAGER });
  const callCountBeforeReloadedRead = provider.calls.length;
  assert.deepEqual(await reloaded.participantAccounts({ provider, drawManagerAddress: MANAGER, vaultAddress: VAULT, fromBlock: 100, toBlock: 260 }), [getAddress(ACCOUNT_A), getAddress(ACCOUNT_B)]);
  assert.equal(provider.calls.length, callCountBeforeReloadedRead);
});
