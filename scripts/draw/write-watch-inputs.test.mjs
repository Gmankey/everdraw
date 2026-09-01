import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Interface } from "ethers";

process.env.WATCHER_LOGS_RPC_URL = "provider";
const {
  DrawInputEventCache,
  participantAccountsFromLogs,
  queryLogsChunked,
} = await import("./write-watch-inputs.mjs?canonical-cache-test");

const ZERO = "0x0000000000000000000000000000000000000000";
const VAULT = "0x0000000000000000000000000000000000000A11";
const MANAGER = "0x0000000000000000000000000000000000000D22";
const ALICE = "0x00000000000000000000000000000000000000A1";
const BOB = "0x00000000000000000000000000000000000000B2";
const CAROL = "0x00000000000000000000000000000000000000C3";
const ORPHAN = "0x00000000000000000000000000000000000000D4";
const iface = new Interface([
  "event Deposit(address indexed recipient,uint256 amount)",
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
]);

function log(eventName, args, blockNumber, index) {
  const encoded = iface.encodeEventLog(iface.getEvent(eventName), args);
  return {
    address: VAULT,
    blockNumber,
    index,
    logIndex: index,
    topics: encoded.topics,
    data: encoded.data,
  };
}

test("participant discovery includes mint, burn, partial/full transfers, and transfer chains", () => {
  const logs = [
    log("Deposit", [ALICE, 100n], 10, 0),
    log("Transfer", [ZERO, ALICE, 100n], 10, 1),
    log("Transfer", [ALICE, BOB, 40n], 11, 0),
    log("Transfer", [BOB, CAROL, 40n], 12, 0),
    log("Transfer", [ALICE, BOB, 60n], 13, 0),
    log("Transfer", [CAROL, ZERO, 40n], 14, 0),
  ];

  assert.deepEqual(
    participantAccountsFromLogs(logs).map((account) => account.toLowerCase()),
    [ALICE, BOB, CAROL].map((account) => account.toLowerCase()).sort(),
  );
});

test("draw-boundary discovery excludes a recipient transferred after the seed block", () => {
  const beforeSeed = [
    log("Transfer", [ZERO, ALICE, 100n], 20, 0),
    log("Transfer", [ALICE, BOB, 50n], 21, 0),
  ];
  const afterSeed = log("Transfer", [BOB, CAROL, 10n], 22, 0);

  assert.equal(
    participantAccountsFromLogs(beforeSeed).some((account) => account.toLowerCase() === CAROL.toLowerCase()),
    false,
  );
  assert.equal(
    participantAccountsFromLogs([...beforeSeed, afterSeed]).some(
      (account) => account.toLowerCase() === CAROL.toLowerCase(),
    ),
    true,
  );
});

test("canonical-hash divergence drops orphaned accounts before replacement logs are ingested", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-transfer-cache-"));
  const file = path.join(dir, "cache.json");
  const cache = new DrawInputEventCache({ file, drawManagerAddress: MANAGER });

  cache.ingestLogs({
    chainId: 10143n,
    drawManagerAddress: MANAGER,
    vaultAddress: VAULT,
    fromBlock: 10,
    toBlock: 20,
    blockHash: `0x${"11".repeat(32)}`,
    logs: [
      log("Transfer", [ZERO, ALICE, 100n], 10, 0),
      log("Transfer", [ALICE, ORPHAN, 25n], 20, 0),
    ],
  });
  assert.equal(cache.state.participants.accounts.some((account) => account.toLowerCase() === ORPHAN.toLowerCase()), true);

  const provider = {
    async getNetwork() {
      return { chainId: 10143n };
    },
    async getBlock(blockNumber) {
      assert.equal(blockNumber, 20);
      return { hash: `0x${"22".repeat(32)}` };
    },
  };
  assert.equal(
    await cache.ensureCanonical({
      provider,
      drawManagerAddress: MANAGER,
      vaultAddress: VAULT,
      fromBlock: 10,
    }),
    false,
  );

  cache.ingestLogs({
    chainId: 10143n,
    drawManagerAddress: MANAGER,
    vaultAddress: VAULT,
    fromBlock: 10,
    toBlock: 20,
    blockHash: `0x${"22".repeat(32)}`,
    logs: [
      log("Transfer", [ZERO, ALICE, 100n], 10, 0),
      log("Transfer", [ALICE, BOB, 25n], 20, 0),
    ],
  });

  const accounts = cache.state.participants.accounts.map((account) => account.toLowerCase());
  assert.equal(accounts.includes(ORPHAN.toLowerCase()), false);
  assert.equal(accounts.includes(BOB.toLowerCase()), true);
  fs.rmSync(dir, { recursive: true, force: true });
});


test("in-flight reorg aborts before a watcher or cache batch can checkpoint", async () => {
  const hashA = `0x${"aa".repeat(32)}`;
  const hashB = `0x${"bb".repeat(32)}`;
  let canonicalHash = hashA;
  let checkpointed = false;
  const provider = {
    async getBlock(blockNumber) {
      return { number: blockNumber, hash: canonicalHash };
    },
  };

  await assert.rejects(
    queryLogsChunked(
      provider,
      { address: VAULT },
      100,
      100,
      "adversarial-reorg",
      {
        getLogs: async () => {
          canonicalHash = hashB;
          return [{
            address: VAULT,
            blockNumber: 100,
            blockHash: hashA,
            topics: [],
            data: "0x",
          }];
        },
        onBatch: async () => {
          checkpointed = true;
        },
      },
    ),
    /Canonical (range changed|log mismatch)/,
  );

  assert.equal(checkpointed, false);
});


test("event-cache writer persists no orphaned participant state during an in-flight reorg", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-cache-race-"));
  const file = path.join(dir, "cache.json");
  const cache = new DrawInputEventCache({ file, drawManagerAddress: MANAGER });
  const hashA = `0x${"ca".repeat(32)}`;
  const hashB = `0x${"cb".repeat(32)}`;
  let canonicalHash = hashA;
  const deposit = log("Deposit", [ALICE, 100n], 100, 0);
  deposit.blockHash = hashA;
  const provider = {
    async getNetwork() {
      return { chainId: 10143n };
    },
    async getBlock(blockNumber) {
      return { number: blockNumber, hash: canonicalHash };
    },
    async getLogs() {
      canonicalHash = hashB;
      return [deposit];
    },
  };

  await assert.rejects(
    cache.participantAccounts({
      provider,
      drawManagerAddress: MANAGER,
      vaultAddress: VAULT,
      fromBlock: 100,
      toBlock: 100,
    }),
    /Canonical (range changed|log mismatch)/,
  );
  assert.equal(cache.state.participants.lastScannedBlock, 99);
  assert.deepEqual(cache.state.participants.accounts, []);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
