#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import { spawnSync } from "node:child_process";
import { CountingJsonRpcProvider, assertCanonicalLogBatch, queryLogsChunked, redactRpcSecrets, retryTransient, rpcUsageSnapshot } from "./write-watch-inputs.mjs";
import { buildWatcherDrawInput, ingestWatcherReconstructionLogs } from "./reconstruct-watcher-input.mjs";
import { IndependentWatcherCache, rootNeedsIndependentVerification } from "./independent-watcher-cache.mjs";
import { readActiveV5Deployment, resolveV5RuntimeTargets } from "../keeper/v5-deployment.mjs";

const RPC_URL = process.env.WATCHER_RPC_URL || process.env.RPC_URL;
const HEAD_RPC_URL = process.env.WATCHER_HEAD_RPC_URL || RPC_URL;
const HEAD_RPC_TIMEOUT_MS = Number(process.env.WATCHER_HEAD_RPC_TIMEOUT_MS || "10000");
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const EXPECTED_CHAIN_ID = BigInt(process.env.WATCHER_CHAIN_ID || "10143");
const CONFIGURED_DRAW_MANAGER_ADDRESS = process.env.DRAW_MANAGER_ADDRESS;
const CONFIGURED_FROM_BLOCK = process.env.WATCHER_FROM_BLOCK || process.env.V5_WATCHER_FROM_BLOCK;
const STATE_FILE = process.env.WATCHER_STATE_FILE || path.join(os.tmpdir(), "everdraw-v5-watcher-state.json");
const INDEPENDENT_STATE_FILE = process.env.WATCHER_INDEPENDENT_STATE_FILE || `${STATE_FILE}.independent`;
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
  "function currentDrawId() view returns (uint256)",
  "function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)",
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
export function acknowledgedCoverageIncidents(value = process.env.WATCHER_ACKNOWLEDGED_COVERAGE_GAPS || "") {
  const acknowledged = new Set();
  for (const raw of String(value).split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const match = token.match(/^(\d+):(0x[0-9a-fA-F]{64})$/);
    if (!match) {
      throw new Error(
        "WATCHER_ACKNOWLEDGED_COVERAGE_GAPS must be a comma-separated list of draw:fingerprint incident tokens",
      );
    }
    acknowledged.add(BigInt(match[1]).toString() + ":" + match[2].toLowerCase());
  }
  return acknowledged;
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
  const provider = new CountingJsonRpcProvider(RPC_URL, "security");
  const headProvider = new CountingJsonRpcProvider(
    HEAD_RPC_URL,
    "canonical",
    undefined,
    undefined,
    HEAD_RPC_TIMEOUT_MS,
  );
  const headChainId = (await retryTransient(() => headProvider.getNetwork(), "watcher head chain")).chainId;
  if (headChainId !== EXPECTED_CHAIN_ID) throw new Error(`Watcher head RPC chain mismatch: ${headChainId} expected=${EXPECTED_CHAIN_ID}`);
  const chainId = headChainId;
  const headCode = await retryTransient(
    () => withRpcTimeout(headProvider.getCode(drawManagerAddress), "watcher head DrawManager bytecode"),
    "watcher head DrawManager bytecode",
  );
  if (headCode === "0x") throw new Error(`Watcher head RPC has no DrawManager bytecode at ${drawManagerAddress}`);
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
  const independentCache = new IndependentWatcherCache({
    file: INDEPENDENT_STATE_FILE,
    chainId,
    drawManagerAddress,
    vaultAddress,
    fromBlock,
  });
  let securityProviderValidated = false;
  const validateSecurityProvider = async () => {
    if (securityProviderValidated) return;
    const securityChainId = (await retryTransient(() => provider.getNetwork(), "watcher security chain")).chainId;
    if (securityChainId !== EXPECTED_CHAIN_ID) {
      throw new Error(`Watcher security RPC chain mismatch: ${securityChainId} expected=${EXPECTED_CHAIN_ID}`);
    }
    const code = await retryTransient(
      () => withRpcTimeout(provider.getCode(drawManagerAddress), "watcher security DrawManager bytecode"),
      "watcher security DrawManager bytecode",
    );
    if (code === "0x") throw new Error(`Watcher security RPC has no DrawManager bytecode at ${drawManagerAddress}`);
    securityProviderValidated = true;
  };
  const verifyIndependentRoot = async ({ drawId, root, eventKind, throughBlock }) => {
    await validateSecurityProvider();
    await independentCache.syncThrough(provider, throughBlock, { canonicalProvider: headProvider });
    const event = independentCache.assertEvent(eventKind, drawId, root);
    const seedBlock = independentCache.seedBlock(drawId);
    if (!seedBlock) throw new Error(`Independent RPC has no SeedReceived block for draw ${drawId}`);
    const input = await retryTransient(
      () => buildWatcherDrawInput({
        provider,
        drawManagerAddress,
        drawId,
        seedBlock,
        participantAccounts: independentCache.accounts(),
      }),
      `draw ${drawId} independent security-RPC reconstruction`,
    );
    const result = recompute(input);
    const evidence = await independentCache.assertEvidenceCanonical(headProvider, eventKind, drawId, root);
    const proposalEvidence = eventKind === "proposals"
      ? evidence
      : await independentCache.assertEvidenceCanonical(headProvider, "proposals", drawId, root);
    return { input, result, event, evidence, proposalEvidence };
  };
  let state = readState({ chainId, drawManagerAddress, vaultAddress, fromBlock });
  if (state && !await retryTransient(
    () => canonicalCheckpointMatches(headProvider, state),
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
  const coverageAcknowledgments = acknowledgedCoverageIncidents();
  const verifyProposal = async ({ drawId, root, throughBlock, discoveryDeadline, verificationMode = "live" }) => {
    const { result, event, proposalEvidence } = await verifyIndependentRoot({
      drawId,
      root,
      eventKind: "proposals",
      throughBlock,
    });
    checked++;
    let acceptable = true;
    const independentDeadline = Number(event.challengeEndsAt);
    const storedChallengeEndsAt = await retryTransient(
      () => withRpcTimeout(manager.challengeEndsAt(drawId), `draw ${drawId} challenge deadline`),
      `draw ${drawId} challenge deadline`,
    );
    if (discoveryDeadline != null && Number(discoveryDeadline) !== independentDeadline) {
      const message = `EverDraw V5 proposal deadline provider disagreement draw ${drawId}\ndiscovery=${discoveryDeadline}\nindependent=${independentDeadline}`;
      coverageFailures.push(message);
      rootMismatches.push(message);
      acceptable = false;
      await alarm(message);
    }
    if (challengeDeadlineMismatch({ eventDeadline: independentDeadline, storedDeadline: storedChallengeEndsAt })) {
      const message = `EverDraw V5 challenge deadline mismatch draw ${drawId}\nevent=${independentDeadline}\nonchain=${storedChallengeEndsAt}`;
      coverageFailures.push(message);
      rootMismatches.push(message);
      acceptable = false;
      await alarm(message);
    }
    console.log(`watcher draw ${drawId} storedChallengeEndsAt=${storedChallengeEndsAt}`);
    if (result.root.toLowerCase() !== String(root).toLowerCase()) {
      const message = `EverDraw V5 root mismatch draw ${drawId}\nproposed=${String(root).toLowerCase()}\nrecomputed=${result.root.toLowerCase()}\noperator action: verify and vetoRoot(${drawId}) from Ledger if confirmed`;
      coverageFailures.push(message);
      rootMismatches.push(message);
      acceptable = false;
      await alarm(message);
    }
    if (verificationMode === "live" && enforceLiveWindow) {
      const timingFailure = proposalCoverageFailure({
        challengeEndsAt: storedChallengeEndsAt,
        observedAt: Math.floor(Date.now() / 1000),
      });
      if (timingFailure) {
        const message = `EverDraw V5 watcher coverage late for draw ${drawId}: ${timingFailure}`;
        coverageFailures.push(message);
        acceptable = false;
        await alarm(message);
      }
    }
    if (acceptable && verificationMode === "live") independentCache.markVerified(drawId, proposalEvidence);
    return { result, acceptable, proposalEvidence };
  };

  if (scanFromBlock <= latest) {
    const seedTopic = iface.getEvent("SeedReceived").topicHash;
    const transferTopic = iface.getEvent("Transfer").topicHash;
    await queryLogsChunked(
      headProvider,
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
            await verifyProposal({
              drawId,
              root: proposedRoot,
              throughBlock: Number(log.blockNumber),
              discoveryDeadline: proposal.args.challengeEndsAt,
            });
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
            const { input, result: recomputed, evidence } = await verifyIndependentRoot({
              drawId,
              root: finalizedRoot,
              eventKind: "finalizations",
              throughBlock: Number(log.blockNumber),
            });
            if (recomputed.root.toLowerCase() !== finalizedRoot) {
              const message = `EverDraw V5 finalized root mismatch draw ${drawId}\nfinalized=${finalizedRoot}\nrecomputed=${recomputed.root.toLowerCase()}`;
              coverageFailures.push(message);
              rootMismatches.push(message);
              await alarm(message);
              continue;
            }
            await publishClaimProofs({ input, result: recomputed, vaultAddress });
            independentCache.markFinalizationHandled(drawId, evidence);
          }

          // Recheck immediately before persistence. Proposal reconstruction can take
          // long enough for the canonical chain to change after the initial log read.
          const verified = await assertCanonicalLogBatch(headProvider, {
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
  let currentEvidence;
  if (caughtUp) {
    const currentDrawId = await retryTransient(
      () => withRpcTimeout(manager.currentDrawId(), "watcher current draw"),
      "watcher current draw",
    );
    if (currentDrawId > 0n) {
      const currentDraw = await retryTransient(
        () => withRpcTimeout(manager.draws(currentDrawId), `watcher draw ${currentDrawId}`),
        `watcher draw ${currentDrawId}`,
      );
      await independentCache.ensureCanonical(headProvider);
      currentEvidence = { drawId: currentDrawId, root: currentDraw.root, status: Number(currentDraw.status) };
      const currentStatus = Number(currentDraw.status);
      const integrityRoot = currentStatus === 4
        ? independentCache.integrityVerifiedRoot(currentDrawId)
        : independentCache.verifiedRoot(currentDrawId);
      const needsIntegrityRecovery = rootNeedsIndependentVerification({
        status: currentStatus,
        root: currentDraw.root,
        verifiedRoot: integrityRoot,
      });
      let historicalProposal;
      if (needsIntegrityRecovery) {
        historicalProposal = await verifyProposal({
          drawId: currentDrawId,
          root: currentDraw.root,
          throughBlock: latest,
          verificationMode: currentStatus === 4 ? "historical-finalized" : "live",
        });
      }
      const finalizationHandled = currentStatus === 4
        && independentCache.finalizationHandled(currentDrawId, currentDraw.root);
      if (currentStatus === 4 && (!finalizationHandled || needsIntegrityRecovery)) {
        const { input, result, evidence } = await verifyIndependentRoot({
          drawId: currentDrawId,
          root: currentDraw.root,
          eventKind: "finalizations",
          throughBlock: latest,
        });
        if (result.root.toLowerCase() !== currentDraw.root.toLowerCase()) {
          const message = "EverDraw V5 independently discovered finalized root mismatch draw " + currentDrawId + "\nfinalized=" + currentDraw.root.toLowerCase() + "\nrecomputed=" + result.root.toLowerCase();
          coverageFailures.push(message);
          rootMismatches.push(message);
          await alarm(message);
        } else if (!historicalProposal || historicalProposal.acceptable) {
          if (needsIntegrityRecovery) {
            const recoveryEvidence = {
              proposalEvidence: historicalProposal.proposalEvidence,
              finalizationEvidence: evidence,
            };
            // Persist the incident first. A crash between these writes remains fail-closed
            // and retries reconstruction instead of losing the live-coverage gap.
            independentCache.recordCoverageIncident(currentDrawId, currentDraw.root, recoveryEvidence);
            independentCache.markHistoricalFinalizedIntegrity(currentDrawId, recoveryEvidence);
          }
          if (!finalizationHandled) {
            await publishClaimProofs({ input, result, vaultAddress });
            independentCache.markFinalizationHandled(currentDrawId, evidence);
          }
        }
      }
    }
  }
  for (const activeIncident of independentCache.activeCoverageIncidents()) {
    let incident = activeIncident;
    if (!incident.notifiedAt) {
      await alarm(
        "EverDraw V5 historical coverage gap draw " + incident.drawId + "\n"
        + "root=" + incident.root + "\n"
        + "incident=" + incident.id + "\n"
        + "finalized root integrity recovered, but timely live veto coverage is unproven\n"
        + "operator action: review and add the exact incident token to WATCHER_ACKNOWLEDGED_COVERAGE_GAPS",
      );
      independentCache.markCoverageIncidentNotified(incident.id);
      incident = independentCache.coverageIncident(incident.id);
    }
    if (coverageAcknowledgments.has(incident.id)) {
      independentCache.acknowledgeCoverageIncident(
        incident.id,
        "WATCHER_ACKNOWLEDGED_COVERAGE_GAPS:" + incident.id,
      );
      incident = independentCache.coverageIncident(incident.id);
    }
    if (!incident.acknowledgedAt) {
      coverageFailures.push("Historical finalized coverage gap awaiting acknowledgment: " + incident.id);
    }
  }
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
      () => canonicalCheckpointMatches(headProvider, {
        lastScannedBlock: runEnd,
        lastScannedBlockHash: lastCheckpointHash,
      }),
      "watcher final canonical checkpoint",
    );
    if (!finalCanonical) throw new Error(`Watcher canonical checkpoint changed at block ${runEnd}`);
    await independentCache.ensureCanonical(headProvider);
    if (currentEvidence && rootNeedsIndependentVerification({
      status: currentEvidence.status,
      root: currentEvidence.root,
      verifiedRoot: currentEvidence.status === 4
        ? independentCache.integrityVerifiedRoot(currentEvidence.drawId)
        : independentCache.verifiedRoot(currentEvidence.drawId),
    })) {
      throw new Error(`Independent proposal evidence changed before health for draw ${currentEvidence.drawId}`);
    }
    if (currentEvidence?.status === 4 && !independentCache.finalizationHandled(currentEvidence.drawId, currentEvidence.root)) {
      throw new Error(`Independent finalization evidence changed before health for draw ${currentEvidence.drawId}`);
    }
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
  console.log(`watcher rpc usage ${JSON.stringify(rpcUsageSnapshot())}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(`watcher rpc usage ${JSON.stringify(rpcUsageSnapshot())}`);
    if (!err.alreadyAlarmed) await alarm(`EverDraw V5 watcher failed: ${redactRpcSecrets(err.stack || err.message)}`);
    process.exit(1);
  });
}
