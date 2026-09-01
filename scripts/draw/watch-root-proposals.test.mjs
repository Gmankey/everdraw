import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Interface } from "ethers";

import { compute } from "./compute-winners.js";
import { ingestWatcherReconstructionLogs } from "./reconstruct-watcher-input.mjs";
import {
  canCheckpointBatch,
  canonicalCheckpointMatches,
  challengeDeadlineMismatch,
  formatPrivilegedChange,
  proposalCoverageFailure,
  publishClaimProofs,
  shouldEnforceLiveWindow,
  withRpcTimeout,
} from "./watch-root-proposals.mjs";
import {
  isRangeLimitError,
  isTransientError,
  participantAccountsFromLogs,
  retryTransient,
} from "./write-watch-inputs.mjs";

test("privileged governance events identify the contract and transaction", () => {
  const message = formatPrivilegedChange({
    contractLabel: "PrizeVaultV5",
    parsed: {
      name: "OwnershipTransferStarted",
      args: [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
      ],
    },
    txHash: `0x${"ab".repeat(32)}`,
  });
  assert.match(message, /contract=PrizeVaultV5/);
  assert.match(message, /event=OwnershipTransferStarted/);
  assert.match(message, /0xabababab/);
});

test("provider startup invalid JSON is retryable", async () => {
  let calls = 0;
  const result = await retryTransient(
    async () => {
      calls++;
      if (calls < 3) throw new Error("response body is not valid JSON");
      return 123;
    },
    "test provider",
    { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  );

  assert.equal(result, 123);
  assert.equal(calls, 3);
  assert.equal(isTransientError(new Error("failed to detect network")), true);
});

test("CU rate limits back off instead of recursively splitting the block range", () => {
  const err = new Error("could not coalesce error");
  err.error = { message: "compute units per second capacity exceeded; too many requests" };

  assert.equal(isTransientError(err), true);
  assert.equal(isRangeLimitError(err), false);
  assert.equal(isRangeLimitError(new Error("eth_getLogs block range limited to 100 blocks")), true);
  assert.equal(isTransientError(Object.assign(new Error("fallback timed out"), { error: { message: "opaque provider error" } })), true);
});

test("deterministic errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls++;
        throw new Error("TWAB mismatch");
      },
      "test deterministic",
      { attempts: 6, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
    ),
    /TWAB mismatch/,
  );
  assert.equal(calls, 1);
});

test("watcher rejects a RootProposed deadline that differs from stored onchain state", () => {
  assert.equal(challengeDeadlineMismatch({ eventDeadline: 1_000n, storedDeadline: 1_000n }), false);
  assert.equal(challengeDeadlineMismatch({ eventDeadline: 1_000n, storedDeadline: 999n }), true);
});

test("proposal coverage requires five minutes of veto time", () => {
  assert.equal(
    proposalCoverageFailure({ challengeEndsAt: 1_000, observedAt: 600, minRemainingSec: 300 }),
    undefined,
  );
  assert.match(
    proposalCoverageFailure({ challengeEndsAt: 1_000, observedAt: 701, minRemainingSec: 300 }),
    /only 299 seconds remained/,
  );
});
test("bootstrap timing is not treated as live coverage and only root mismatches pin the cursor", () => {
  assert.equal(shouldEnforceLiveWindow({ lastScannedBlock: 123 }), false);
  assert.equal(shouldEnforceLiveWindow({ lastScannedBlock: 123, liveMonitoring: false }), false);
  assert.equal(shouldEnforceLiveWindow({ lastScannedBlock: 123, liveMonitoring: true }), true);
  assert.equal(canCheckpointBatch(0), true);
  assert.equal(canCheckpointBatch(1), false);
});

test("current RPC calls have a bounded timeout", async () => {
  await assert.rejects(
    withRpcTimeout(new Promise(() => {}), "watcher chain head", 5),
    /watcher chain head timed out after 5ms/,
  );
  await assert.rejects(
    Promise.resolve().then(() => withRpcTimeout(Promise.resolve(1), "invalid", 0)),
    /WATCHER_HEAD_RPC_TIMEOUT_MS must be a positive integer/,
  );
});


test("keeper and watcher independently reconstruct transfer recipients to the same total and root", () => {
  const vault = "0x0000000000000000000000000000000000000a11";
  const manager = "0x0000000000000000000000000000000000000d22";
  const alice = "0x00000000000000000000000000000000000000a1";
  const bob = "0x00000000000000000000000000000000000000b2";
  const carol = "0x00000000000000000000000000000000000000c3";
  const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 amount)"]);
  const makeLog = (from, to, amount, blockNumber, index) => {
    const encoded = transfer.encodeEventLog(transfer.getEvent("Transfer"), [from, to, amount]);
    return { address: vault, blockNumber, index, logIndex: index, topics: encoded.topics, data: encoded.data };
  };
  const logs = [
    makeLog("0x0000000000000000000000000000000000000000", alice, 100n, 10, 0),
    makeLog(alice, bob, 40n, 11, 0),
    makeLog(bob, carol, 10n, 12, 0),
  ];

  const keeperAccounts = participantAccountsFromLogs(logs);
  const watcher = ingestWatcherReconstructionLogs({
    logs,
    vaultAddress: vault,
    drawManagerAddress: manager,
  });
  assert.deepEqual(watcher.accounts, keeperAccounts);

  const twab = new Map([
    [alice.toLowerCase(), 60n],
    [bob.toLowerCase(), 30n],
    [carol.toLowerCase(), 10n],
  ]);
  const inputFor = (accounts) => ({
    drawId: "9",
    drawManager: manager,
    chainId: "10143",
    claimManager: "0x0000000000000000000000000000000000000C11",
    seed: `0x${"42".repeat(32)}`,
    totalPayout: "1000",
    prizeLegs: [{
      token: "0x0000000000000000000000000000000000000000",
      amount: "1000",
      feeAmount: "0",
    }],
    feeRecipients: [],
    tierBps: [10000],
    accounts: accounts.map((address) => ({ address, twab: twab.get(address.toLowerCase()).toString() })),
  });
  const keeperResult = compute(inputFor(keeperAccounts));
  const watcherResult = compute(inputFor(watcher.accounts));
  assert.equal(keeperResult.totalTwab, "100");
  assert.equal(watcherResult.totalTwab, "100");
  assert.equal(watcherResult.root, keeperResult.root);

  const otherChain = compute({ ...inputFor(watcher.accounts), chainId: "143" });
  const otherClaimManager = compute({
    ...inputFor(watcher.accounts),
    claimManager: "0x0000000000000000000000000000000000000C12",
  });
  assert.notEqual(otherChain.root, watcherResult.root);
  assert.notEqual(otherClaimManager.root, watcherResult.root);
});

test("watcher canonical checkpoint detects reorg replacement", async () => {
  const state = { lastScannedBlock: 99, lastScannedBlockHash: `0x${"11".repeat(32)}` };
  assert.equal(
    await canonicalCheckpointMatches({ getBlock: async () => ({ hash: `0x${"11".repeat(32)}` }) }, state),
    true,
  );
  assert.equal(
    await canonicalCheckpointMatches({ getBlock: async () => ({ hash: `0x${"22".repeat(32)}` }) }, state),
    false,
  );
});

test("mainnet watcher is independently configured and schedule-gated", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/v5-watcher-mainnet.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /vars\.V5_WATCHER_MAINNET_ENABLED == 'true'/);
  assert.match(workflow, /DEPLOYMENT_FILE: deployments\/monad-mainnet\.json/);
  assert.match(workflow, /WATCHER_CHAIN_ID: "143"/);
  assert.match(workflow, /secrets\.V5_WATCHER_MAINNET_RPC_URL/);
  assert.match(workflow, /secrets\.V5_WATCHER_MAINNET_HEAD_RPC_URL/);
  assert.match(workflow, /secrets\.V5_WATCHER_MAINNET_HEALTHCHECK_URL/);
  assert.match(workflow, /\.watcher-cache-mainnet/);
  assert.match(workflow, /if: always\(\)/);
});

test("workflow uses configured logs RPC and a five-minute cadence", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/v5-watcher.yml", import.meta.url), "utf8");
  const watcher = fs.readFileSync(new URL("./watch-root-proposals.mjs", import.meta.url), "utf8");
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflow, /secrets\.V5_WATCHER_UAT_LOGS_RPC_URL \|\| secrets\.V5_WATCHER_UAT_RPC_URL/);
  assert.doesNotMatch(workflow, /WATCHER_LOGS_RPC_URL: https:\/\/testnet-rpc\.monad\.xyz/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /WATCHER_HEAD_RPC_URL: https:\/\/testnet-rpc\.monad\.xyz/);
  assert.match(workflow, /WATCHER_HEAD_RPC_TIMEOUT_MS: "10000"/);
  assert.match(watcher, /buildWatcherDrawInput\(\{\s*provider,/);
  assert.doesNotMatch(watcher, /DrawInputEventCache|buildDrawInput/);
  assert.match(watcher, /headProvider\.getBlockNumber\(\)/);
  assert.match(watcher, /shouldEnforceLiveWindow\(state\)/);
  assert.match(watcher, /canCheckpointBatch\(rootMismatches\.length\)/);
  assert.match(watcher, /TimingChangeQueued/);
  assert.match(watcher, /PrimaryProposerSet/);
  assert.match(watcher, /FallbackProposerAllowedSet/);
  assert.match(watcher, /RewardTokenMinimumSet/);
  assert.match(watcher, /OwnershipTransferStarted/);
  assert.match(watcher, /StrategyChangeQueued/);
  assert.match(watcher, /SourceAuthorizationSet/);
  assert.match(watcher, /address: monitoredAddresses/);
  assert.match(watcher, /if \(enforceLiveWindow\)/);
  assert.match(watcher, /liveMonitoring: true/);
  assert.match(workflow, /WATCHER_JOB_DURATION_SEC: "3000"/);
  assert.match(workflow, /WATCHER_POLL_INTERVAL_SEC: "60"/);
  assert.match(workflow, /WATCHER_MAX_STALE_SUCCESS_SEC: "600"/);
  assert.match(workflow, /while \(\( SECONDS < deadline \)\)/);
  assert.match(workflow, /WATCHER_CYCLE_TIMEOUT_SEC: "480"/);
  assert.match(workflow, /WATCHER_SHUTDOWN_RESERVE_SEC: "180"/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=15s/);
  assert.match(workflow, /SECONDS - last_success > WATCHER_MAX_STALE_SUCCESS_SEC/);
});


test('publishes matched claim proofs with bearer authentication', async () => {
  let request;
  const published = await publishClaimProofs({
    input: {
      chainId: '143',
      drawManager: '0x0000000000000000000000000000000000000022',
      claimManager: '0x0000000000000000000000000000000000000033',
      drawId: '9',
    },
    result: {
      algoVersion: 'everdraw-v5-draw-algorithm/3',
      root: '0x' + '11'.repeat(32),
      leafCount: 1,
      leaves: [{ leafIndex: '0', proof: [] }],
    },
    vaultAddress: '0x0000000000000000000000000000000000000011',
    url: 'https://indexer.example/api/internal/v5/claim-proofs',
    token: 'test-secret',
    required: true,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(published, true);
  assert.equal(request.options.headers.authorization, 'Bearer test-secret');
  assert.equal(JSON.parse(request.options.body).drawId, '9');
});

test('fails closed when proof publication is required but unconfigured', async () => {
  await assert.rejects(
    publishClaimProofs({ input: {}, result: {}, vaultAddress: '', url: '', token: '', required: true }),
    /required but not configured/,
  );
});


test("claim-proof publication is gated by RootFinalized, not RootProposed", () => {
  const source = fs.readFileSync("scripts/draw/watch-root-proposals.mjs", "utf8");
  assert.match(source, /event RootFinalized\(uint256 indexed drawId/);
  const finalizationBranch = source.indexOf("const finalizations = logs");
  const publication = source.indexOf("await publishClaimProofs({ input, result: recomputed, vaultAddress })");
  assert.ok(finalizationBranch >= 0);
  assert.ok(publication > finalizationBranch);
  assert.equal(source.match(/await publishClaimProofs\(\{ input, result: recomputed, vaultAddress \}\)/g)?.length, 1);
});
