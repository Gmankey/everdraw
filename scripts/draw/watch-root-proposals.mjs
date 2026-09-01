#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { spawnSync } from "node:child_process";
import { assertCanonicalLogBatch, queryLogsChunked, retryTransient } from "./write-watch-inputs.mjs";
import { buildWatcherDrawInput, ingestWatcherReconstructionLogs } from "./reconstruct-watcher-input.mjs";
import { readActiveV5Deployment, resolveV5RuntimeTargets } from "../keeper/v5-deployment.mjs";

const RPC_URL = process.env.WATCHER_RPC_URL || process.env.RPC_URL;
const HEAD_RPC_URL = process.env.WATCHER_HEAD_RPC_URL || RPC_URL;
const HEAD_RPC_TIMEOUT_MS = Number(process.env.WATCHER_HEAD_RPC_TIMEOUT_MS || "10000");
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const EXPECTED_CHAIN_ID = BigInt(process.env.WATCHER_CHAIN_ID || "10143");
const CONFIGURED_DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const CONFIGURED_FROM_BLOCK = process.env.WATCHER_FROM_BLOCK || process.env.V5_WATCHER_FROM_BLOCK;
const STATE_FILE = process.env.WATCHER_STATE_FILE || path.join(os.tmpdir(), "everdraw-v5-watcher-state.json");
const MAX_BLOCKS_PER_RUN = Number(process.env.WATCHER_MAX_BLOCKS_PER_RUN || "250000");
const CLAIM_PROOF_URL = process.env.WATCHER_CLAIM_PROOF_URL;
const CLAIM_PROOF_TOKEN = process.env.WATCHER_CLAIM_PROOF_TOKEN;
const REQUIRE_CLAIM_PROOF_PUBLISH = process.env.WATCHER_REQUIRE_CLAIM_PROOF_PUBLISH === 'true';

export async function publishClaimProofs({ input, result, vaultAddress, fetchImpl = fetch, url = CLAIM_PROOF_URL, token = CLAIM_PROOF_TOKEN, required = REQUIRE_CLAIM_PROOF_PUBLISH }) {
  if (!url || !token) {
    if (required) throw new Error('Watcher claim-proof publishing is required but not configured');
    return false;
  }
  const body = {
    algoVersion: result.algoVersion,
    chainId: input.chainId,
    vaultAddress,
    drawManagerAddress: input.drawManager,
    claimManagerAddress: input.claimManager,
    drawId: input.drawId,
    root: result.root,
    leafCount: result.leafCount,
    leaves: result.leaves,
  };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('claim-proof API returned HTTP ' + response.status);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const HEALTHCHECKS_PING_URL = process.env.WATCHER_HEALTHCHECKS_PING_URL;
const MIN_VETO_REMAINING_SEC = Number(process.env.WATCHER_MIN_VETO_REMAINING_SEC || "300");

const ABI = [
  "function vault() view returns (address)",
  "function challengeEndsAt(uint256) view returns (uint64)",
  "event RootProposed(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout, address indexed proposer, bytes32 algorithmVersion, uint64 challengeEndsAt)",
  "event RootFinalized(uint256 indexed drawId, bytes32 indexed root, uint32 winnerCount, uint256 totalPayout)",
  "event SeedReceived(uint256 indexed drawId, uint64 indexed requestId, bytes32 seed)",
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
  "event OwnershipTransferStarted(address indexed previousOwner,address indexed pendingOwner)",
  "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
  "event GuardianSet(address indexed guardian)",
  "event PrimaryProposerSet(address indexed primaryProposer)",
  "event FallbackProposerAllowedSet(address indexed proposer,bool allowed)",
  "event TimingChangeQueued(uint64 proposerGracePeriod,uint64 challengeWindow,uint64 vetoCooldown,uint64 effectiveAt)",
  "event TimingUpdated(uint64 proposerGracePeriod,uint64 challengeWindow,uint64 vetoCooldown)",
  "event TimingChangeCancelled()",
  "event MinPrizeThresholdUpdated(uint256 minPrizeThreshold)",
  "event DrawPeriodChangeQueued(uint64 drawPeriod,uint64 effectiveAt)",
  "event DrawPeriodChangeCommitted(uint64 drawPeriod,uint64 activationPeriodStart)",
  "event DrawPeriodChanged(uint64 previousDrawPeriod,uint64 drawPeriod,uint64 activationPeriodStart)",
  "event DrawPeriodChangeCancelled()",
  "event OracleChangeQueued(address indexed oracle,uint64 effectiveAt)",
  "event OracleChanged(address indexed oracle)",
  "event OracleChangeCancelled()",
  "event SeedRequestTimeoutUpdated(uint64 seedRequestTimeout)",
  "event FeeConfigUpdated(uint8 feeBase,uint16 totalFeeBps)",
  "event FeeRecipientsUpdated(uint16 totalFeeBps)",
  "event RewardTokenAllowedSet(address indexed token,bool allowed)",
  "event RewardTokenMinimumSet(address indexed token,uint256 minAmountPerDraw)",
  "event DepositCapUpdated(uint256 depositCap)",
  "event MinDepositUpdated(uint256 minDeposit)",
  "event Paused(address indexed by)",
  "event Unpaused(address indexed by)",
  "event PauserSet(address indexed pauser)",
  "event DrawManagerSet(address indexed drawManager)",
  "event DrawManagerChangeQueued(address indexed drawManager,uint64 effectiveAt)",
  "event DrawManagerChangeCancelled()",
  "event VaultStopped(uint64 stoppedAt)",
  "event StrategyChangeQueued(address indexed strategy,uint64 effectiveAt)",
  "event StrategyChanged(address indexed strategy)",
  "event StrategyChangeCancelled()",
  "event SourceAuthorizationSet(address indexed source,bool authorized)",
  "event CompoundVaultSet(address indexed source,address indexed vault)",
  "event VaultRegistered(address indexed vault)",
];
const PRIVILEGED_EVENT_NAMES = new Set([
  "OwnershipTransferStarted",
  "OwnershipTransferred",
  "GuardianSet",
  "PrimaryProposerSet",
  "FallbackProposerAllowedSet",
  "TimingChangeQueued",
  "TimingUpdated",
  "TimingChangeCancelled",
  "MinPrizeThresholdUpdated",
  "DrawPeriodChangeQueued",
  "DrawPeriodChangeCommitted",
  "DrawPeriodChanged",
  "DrawPeriodChangeCancelled",
  "OracleChangeQueued",
  "OracleChanged",
  "OracleChangeCancelled",
  "SeedRequestTimeoutUpdated",
  "FeeConfigUpdated",
  "FeeRecipientsUpdated",
  "RewardTokenAllowedSet",
  "RewardTokenMinimumSet",
  "DepositCapUpdated",
  "MinDepositUpdated",
  "Paused",
  "Unpaused",
  "PauserSet",
  "DrawManagerSet",
  "DrawManagerChangeQueued",
  "DrawManagerChangeCancelled",
  "VaultStopped",
  "StrategyChangeQueued",
  "StrategyChanged",
  "StrategyChangeCancelled",
  "SourceAuthorizationSet",
  "CompoundVaultSet",
  "VaultRegistered",
]);

function displayEventValue(value) {
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

export function formatPrivilegedChange({ contractLabel, parsed, txHash }) {
  const values = Array.from(parsed.args || []).map(displayEventValue).join(", ");
  return `EverDraw V5 privileged change\ncontract=${contractLabel}\nevent=${parsed.name}\nvalues=${values || "<none>"}\ntx=${txHash}`;
}

function resolveConfig() {
  if (!RPC_URL) throw new Error("WATCHER_RPC_URL/RPC_URL is required");
  const deployment = readActiveV5Deployment(DEPLOYMENT_FILE, { expectedChainId: EXPECTED_CHAIN_ID });
  const targets = resolveV5RuntimeTargets(deployment, {
    ...process.env,
    DRAW_MANAGER_ADDRESS: CONFIGURED_DRAW_MANAGER_ADDRESS,
    V5_WATCHER_FROM_BLOCK: CONFIGURED_FROM_BLOCK,
  });
  return {
    deployment,
    drawManagerAddress: targets.drawManagerAddress,
    fromBlock: targets.fromBlock,
  };
}

function readState({ chainId, drawManagerAddress, vaultAddress, fromBlock }) {
  if (!fs.existsSync(STATE_FILE)) return undefined;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (
      state.version !== 3 ||
      state.chainId !== BigInt(chainId).toString() ||
      getAddress(state.drawManagerAddress) !== drawManagerAddress ||
      getAddress(state.vaultAddress) !== vaultAddress ||
      Number(state.fromBlock) !== fromBlock ||
      !Number.isSafeInteger(Number(state.lastScannedBlock)) ||
      !Array.isArray(state.participantAccounts) ||
      typeof state.seedBlocks !== "object" ||
      state.seedBlocks == null
    ) {
      return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

function writeState({
  chainId,
  drawManagerAddress,
  vaultAddress,
  fromBlock,
  lastScannedBlock,
  lastScannedBlockHash,
  participantAccounts,
  seedBlocks,
  liveMonitoring = false,
}) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify({
      version: 3,
      chainId: BigInt(chainId).toString(),
      drawManagerAddress,
      vaultAddress,
      fromBlock,
      lastScannedBlock,
      lastScannedBlockHash,
      participantAccounts,
      seedBlocks,
      liveMonitoring,
      updatedAt: new Date().toISOString(),
    }) + "\n",
  );
  fs.renameSync(temp, STATE_FILE);
}

export async function canonicalCheckpointMatches(provider, state) {
  if (!state?.lastScannedBlockHash || Number(state.lastScannedBlock) < 1) return false;
  const block = await provider.getBlock(Number(state.lastScannedBlock));
  return block?.hash?.toLowerCase() === state.lastScannedBlockHash.toLowerCase();
}

function recompute(input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "everdraw-v5-watcher-"));
  const inputFile = path.join(dir, `${input.drawId}.json`);
  fs.writeFileSync(inputFile, JSON.stringify(input));
  const child = spawnSync("python3", ["scripts/draw/compute_winners.py", inputFile], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (child.status !== 0) throw new Error(child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

async function alarm(message) {
  console.error(message);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });
  }
  if (HEALTHCHECKS_PING_URL) {
    await fetch(`${HEALTHCHECKS_PING_URL}/fail`, { method: "POST", body: message }).catch(() => {});
  }
}

async function notify(message) {
  console.warn(message);
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });
  }
}

export function challengeDeadlineMismatch({ eventDeadline, storedDeadline }) {
  return BigInt(eventDeadline) !== BigInt(storedDeadline);
}

export function proposalCoverageFailure({ challengeEndsAt, observedAt, minRemainingSec = MIN_VETO_REMAINING_SEC }) {
  const remaining = Number(challengeEndsAt) - Number(observedAt);
  if (remaining >= Number(minRemainingSec)) return undefined;
  return `only ${remaining} seconds remained in the veto window (minimum ${minRemainingSec})`;
}
export function shouldEnforceLiveWindow(state) {
  return state?.liveMonitoring === true;
}

export function canCheckpointBatch(rootMismatchCount) {
  return Number(rootMismatchCount) === 0;
}
export function withRpcTimeout(promise, label, timeoutMs = HEAD_RPC_TIMEOUT_MS) {
  if (!Number.isSafeInteger(Number(timeoutMs)) || Number(timeoutMs) < 1) {
    throw new Error("WATCHER_HEAD_RPC_TIMEOUT_MS must be a positive integer");
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), Number(timeoutMs));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function main() {
  const { deployment, drawManagerAddress, fromBlock } = resolveConfig();
  // Historical block-tag reads and reconstruction use the independent watcher RPC.
  // Current head/config reads may use a lightweight endpoint so archive stalls cannot
  // hide liveness, but they never supply participant reconstruction data.
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const provider = new JsonRpcProvider(RPC_URL);
  const headProvider = HEAD_RPC_URL === RPC_URL ? provider : new JsonRpcProvider(HEAD_RPC_URL);
  const chainId = (await retryTransient(() => provider.getNetwork(), "watcher chain")).chainId;
  const headChainId = (await retryTransient(() => headProvider.getNetwork(), "watcher head chain")).chainId;
  if (chainId !== EXPECTED_CHAIN_ID || headChainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Watcher RPC chain mismatch: reconstruction=${chainId} head=${headChainId} expected=${EXPECTED_CHAIN_ID}`);
  }
  for (const [label, candidate] of [["reconstruction", provider], ["head", headProvider]]) {
    const code = await retryTransient(
      () => withRpcTimeout(candidate.getCode(drawManagerAddress), `watcher ${label} DrawManager bytecode`),
      `watcher ${label} DrawManager bytecode`,
    );
    if (code === "0x") throw new Error(`Watcher ${label} RPC has no DrawManager bytecode at ${drawManagerAddress}`);
  }
  const latest = await retryTransient(
    () => withRpcTimeout(headProvider.getBlockNumber(), "watcher chain head"),
    "watcher chain head",
  );
  const iface = new Interface(ABI);
  const rootTopic = iface.getEvent("RootProposed").topicHash;
  const finalizedTopic = iface.getEvent("RootFinalized").topicHash;
  const privilegedTopics = new Map(
    [...PRIVILEGED_EVENT_NAMES].map((name) => [iface.getEvent(name).topicHash.toLowerCase(), name]),
  );
  const manager = new Contract(drawManagerAddress, ABI, headProvider);
  const vaultAddress = getAddress(await retryTransient(
    () => withRpcTimeout(manager.vault(), "watcher vault read"),
    "watcher vault read",
  ));
  if (vaultAddress !== deployment.addresses.prizeVault) {
    throw new Error(`Watcher DrawManager.vault ${vaultAddress} does not match activated deployment ${deployment.addresses.prizeVault}`);
  }
  const contractLabels = new Map([
    [drawManagerAddress.toLowerCase(), "DrawManagerV5"],
    [vaultAddress.toLowerCase(), "PrizeVaultV5"],
    [deployment.addresses.claimManager.toLowerCase(), "ClaimManagerV5"],
    [deployment.addresses.twabController.toLowerCase(), "EverdrawTwabController"],
  ]);
  const monitoredAddresses = [...contractLabels.keys()];
  let state = readState({ chainId, drawManagerAddress, vaultAddress, fromBlock });
  if (state && !await retryTransient(
    () => canonicalCheckpointMatches(provider, state),
    "watcher canonical checkpoint",
  )) {
    console.warn(`watcher reorg detected at block ${state.lastScannedBlock}; rebuilding from ${fromBlock}`);
    state = undefined;
  }

  const scanFromBlock = Math.max(fromBlock, Number(state?.lastScannedBlock || fromBlock - 1) + 1);
  if (!Number.isSafeInteger(MAX_BLOCKS_PER_RUN) || MAX_BLOCKS_PER_RUN < 1) throw new Error("WATCHER_MAX_BLOCKS_PER_RUN must be a positive integer");
  const runEnd = Math.min(scanFromBlock + MAX_BLOCKS_PER_RUN - 1, latest);
  let reconstruction = {
    accounts: [...(state?.participantAccounts || [])],
    seedBlocks: { ...(state?.seedBlocks || {}) },
  };
  let lastCheckpointHash = state?.lastScannedBlockHash || "";
  let checked = 0;
  const coverageFailures = [];
  const rootMismatches = [];
  const enforceLiveWindow = shouldEnforceLiveWindow(state);

  if (scanFromBlock <= latest) {
    const seedTopic = iface.getEvent("SeedReceived").topicHash;
    const transferTopic = iface.getEvent("Transfer").topicHash;
    await queryLogsChunked(
      provider,
      {
        address: monitoredAddresses,
        topics: [[rootTopic, finalizedTopic, seedTopic, transferTopic, ...privilegedTopics.keys()]],
      },
      scanFromBlock,
      runEnd,
      "watcher-events",
      {
        onBatch: async ({ windows, logs, canonical }) => {
          const batchEnd = windows[windows.length - 1][1];
          reconstruction = ingestWatcherReconstructionLogs({
            logs,
            vaultAddress,
            drawManagerAddress,
            initialAccounts: reconstruction.accounts,
            initialSeedBlocks: reconstruction.seedBlocks,
          });
          lastCheckpointHash = canonical.checkpointHash;
          const privilegedChanges = logs
            .filter((log) => privilegedTopics.has(log.topics[0]?.toLowerCase()))
            .sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0));
          for (const log of privilegedChanges) {
            const parsed = iface.parseLog(log);
            const message = formatPrivilegedChange({
              contractLabel: contractLabels.get(log.address.toLowerCase()) || getAddress(log.address),
              parsed,
              txHash: log.transactionHash,
            });
            if (enforceLiveWindow) {
              await notify(message);
            } else {
              console.log(`historical ${message.replaceAll("\n", " | ")}`);
            }
          }

          const proposals = logs
            .filter((log) => log.address.toLowerCase() === drawManagerAddress.toLowerCase() && log.topics[0]?.toLowerCase() === rootTopic.toLowerCase())
            .sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0));

          for (const log of proposals) {
            const proposal = iface.parseLog(log);
            const drawId = proposal.args.drawId.toString();
            const proposedRoot = proposal.args.root.toLowerCase();
            const storedChallengeEndsAt = await retryTransient(
              () => withRpcTimeout(manager.challengeEndsAt(drawId), `draw ${drawId} challenge deadline`),
              `draw ${drawId} challenge deadline`,
            );
            if (challengeDeadlineMismatch({
              eventDeadline: proposal.args.challengeEndsAt,
              storedDeadline: storedChallengeEndsAt,
            })) {
              const message = `EverDraw V5 challenge deadline mismatch draw ${drawId}\nevent=${proposal.args.challengeEndsAt}\nonchain=${storedChallengeEndsAt}`;
              coverageFailures.push(message);
              rootMismatches.push(message);
              await alarm(message);
            }
            console.log(`watcher draw ${drawId} storedChallengeEndsAt=${storedChallengeEndsAt}`);
            const seedBlock = reconstruction.seedBlocks[drawId];
            if (!seedBlock) throw new Error(`Watcher has no SeedReceived block for draw ${drawId}`);
            const input = await retryTransient(
              () => buildWatcherDrawInput({
                provider,
                drawManagerAddress,
                drawId,
                seedBlock,
                participantAccounts: reconstruction.accounts,
              }),
              `draw ${drawId} independent reconstruction`,
            );
            const recomputed = recompute(input);
            checked++;
            if (recomputed.root.toLowerCase() !== proposedRoot) {
              const message = `EverDraw V5 root mismatch draw ${drawId}\nproposed=${proposedRoot}\nrecomputed=${recomputed.root.toLowerCase()}\noperator action: verify and vetoRoot(${drawId}) from Ledger if confirmed`;
              coverageFailures.push(message);
              rootMismatches.push(message);
              await alarm(message);
            }
            if (enforceLiveWindow) {
              const timingFailure = proposalCoverageFailure({
                challengeEndsAt: storedChallengeEndsAt,
                observedAt: Math.floor(Date.now() / 1000),
              });
              if (timingFailure) {
                const message = `EverDraw V5 watcher coverage late for draw ${drawId}: ${timingFailure}`;
                coverageFailures.push(message);
                await alarm(message);
              }
            }
          }

          const finalizations = logs
            .filter((log) => (
              log.address.toLowerCase() === drawManagerAddress.toLowerCase()
              && log.topics[0]?.toLowerCase() === finalizedTopic.toLowerCase()
            ))
            .sort((a, b) => a.blockNumber - b.blockNumber || (a.index ?? 0) - (b.index ?? 0));

          for (const log of finalizations) {
            const finalized = iface.parseLog(log);
            const drawId = finalized.args.drawId.toString();
            const finalizedRoot = finalized.args.root.toLowerCase();
            const seedBlock = reconstruction.seedBlocks[drawId];
            if (!seedBlock) throw new Error(`Watcher has no SeedReceived block for finalized draw ${drawId}`);
            const input = await retryTransient(
              () => buildWatcherDrawInput({
                provider,
                drawManagerAddress,
                drawId,
                seedBlock,
                participantAccounts: reconstruction.accounts,
              }),
              `finalized draw ${drawId} independent reconstruction`,
            );
            const recomputed = recompute(input);
            if (recomputed.root.toLowerCase() !== finalizedRoot) {
              const message = `EverDraw V5 finalized root mismatch draw ${drawId}\nfinalized=${finalizedRoot}\nrecomputed=${recomputed.root.toLowerCase()}`;
              coverageFailures.push(message);
              rootMismatches.push(message);
              await alarm(message);
              continue;
            }
            await publishClaimProofs({ input, result: recomputed, vaultAddress });
          }

          // Recheck immediately before persistence. Proposal reconstruction can take
          // long enough for the canonical chain to change after the initial log read.
          const verified = await assertCanonicalLogBatch(provider, {
            windows,
            logs,
            boundaryHashes: canonical.boundaryHashes,
            label: "watcher:checkpoint",
          });
          lastCheckpointHash = verified.checkpointHash;

          // A root mismatch must remain at the cursor for operator resolution. A late
          // observation is still an incident, but retrying the same expired proposal
          // forever cannot restore its veto window and only creates duplicate alerts.
          if (canCheckpointBatch(rootMismatches.length)) {
            writeState({
              chainId,
              drawManagerAddress,
              vaultAddress,
              fromBlock,
              lastScannedBlock: batchEnd,
              lastScannedBlockHash: lastCheckpointHash,
              participantAccounts: reconstruction.accounts,
              seedBlocks: reconstruction.seedBlocks,
              liveMonitoring: enforceLiveWindow,
            });
          }
        },
      },
    );
  }
  const caughtUp = runEnd === latest;
  if (!caughtUp) {
    console.warn(`watcher bootstrap incomplete: cursor ${runEnd}, chain head ${latest}; healthcheck remains unconfirmed`);
  }
  if (coverageFailures.length > 0) {
    const err = new Error(`Watcher found ${coverageFailures.length} coverage failure(s)`);
    err.alreadyAlarmed = true;
    throw err;
  }
  if (caughtUp) {
    const finalCanonical = await retryTransient(
      () => canonicalCheckpointMatches(provider, {
        lastScannedBlock: runEnd,
        lastScannedBlockHash: lastCheckpointHash,
      }),
      "watcher final canonical checkpoint",
    );
    if (!finalCanonical) throw new Error(`Watcher canonical checkpoint changed at block ${runEnd}`);
    writeState({
      chainId,
      drawManagerAddress,
      vaultAddress,
      fromBlock,
      lastScannedBlock: runEnd,
      lastScannedBlockHash: lastCheckpointHash,
      participantAccounts: reconstruction.accounts,
      seedBlocks: reconstruction.seedBlocks,
      liveMonitoring: true,
    });
  }
  if (caughtUp && HEALTHCHECKS_PING_URL) await fetch(HEALTHCHECKS_PING_URL).catch(() => {});
  console.log(`watcher checked ${checked} RootProposed events through block ${runEnd} (scan start ${scanFromBlock}, chain head ${latest})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    if (!err.alreadyAlarmed) await alarm(`EverDraw V5 watcher failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}
