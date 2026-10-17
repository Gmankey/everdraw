import fs from "node:fs";
import path from "node:path";
import { Interface, getAddress } from "ethers";
import {
  getLogsRangeDirect,
  queryLogsChunked,
} from "./write-watch-inputs.mjs";
import { ingestWatcherReconstructionLogs } from "./reconstruct-watcher-input.mjs";

const ABI = [
  "event Transfer(address indexed from,address indexed to,uint256 amount)",
  "event SeedReceived(uint256 indexed drawId,uint64 indexed requestId,bytes32 seed)",
  "event RootProposed(uint256 indexed drawId,bytes32 indexed root,uint32 winnerCount,uint256 totalPayout,address indexed proposer,bytes32 algorithmVersion,uint64 challengeEndsAt)",
  "event RootFinalized(uint256 indexed drawId,bytes32 indexed root,uint32 winnerCount,uint256 totalPayout)",
];
const iface = new Interface(ABI);
const topics = ["Transfer", "SeedReceived", "RootProposed", "RootFinalized"]
  .map((name) => iface.getEvent(name).topicHash);

function emptyState(scope) {
  return {
    version: 3,
    ...scope,
    lastScannedBlock: scope.fromBlock - 1,
    lastScannedBlockHash: "",
    participantAccounts: [],
    seedBlocks: {},
    seedEvidence: {},
    proposals: {},
    finalizations: {},
    verifiedRoots: {},
    historicalFinalizedRoots: {},
    coverageIncidents: {},
    publishedFinalizations: {},
  };
}

function atomicWrite(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }) + "\n");
  fs.renameSync(temp, file);
}

function evidenceMatches(marker, event, seed) {
  return Boolean(
    marker
    && event
    && seed
    && marker.root === event.root
    && marker.eventBlockNumber === event.blockNumber
    && marker.eventBlockHash === event.blockHash
    && marker.seedBlockNumber === seed.blockNumber
    && marker.seedBlockHash === seed.blockHash
    && marker.seed === seed.seed
  );
}

export function rootNeedsIndependentVerification({ status, root, verifiedRoot }) {
  return [3, 4].includes(Number(status))
    && String(root).toLowerCase() !== String(verifiedRoot || "").toLowerCase();
}

export class IndependentWatcherCache {
  constructor({ file, chainId, drawManagerAddress, vaultAddress, fromBlock }) {
    this.file = file;
    this.scope = {
      chainId: BigInt(chainId).toString(),
      drawManagerAddress: getAddress(drawManagerAddress),
      vaultAddress: getAddress(vaultAddress),
      fromBlock: Number(fromBlock),
    };
    this.state = this.read();
  }

  read() {
    if (!fs.existsSync(this.file)) return emptyState(this.scope);
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (
        value.version !== 3
        || value.chainId !== this.scope.chainId
        || getAddress(value.drawManagerAddress) !== this.scope.drawManagerAddress
        || getAddress(value.vaultAddress) !== this.scope.vaultAddress
        || Number(value.fromBlock) !== this.scope.fromBlock
      ) return emptyState(this.scope);
      return value;
    } catch {
      return emptyState(this.scope);
    }
  }

  async ensureCanonical(canonicalProvider) {
    if (!this.state.lastScannedBlockHash || this.state.lastScannedBlock < this.scope.fromBlock) return true;
    const block = await canonicalProvider.getBlock(this.state.lastScannedBlock);
    if (block?.hash?.toLowerCase() === this.state.lastScannedBlockHash.toLowerCase()) return true;
    this.state = emptyState(this.scope);
    atomicWrite(this.file, this.state);
    return false;
  }

  async syncThrough(logProvider, targetBlock, {
    canonicalProvider = logProvider,
    chunkSize = Number(process.env.WATCHER_INDEPENDENT_LOG_CHUNK_SIZE || "1000"),
  } = {}) {
    await this.ensureCanonical(canonicalProvider);
    const from = Math.max(this.scope.fromBlock, Number(this.state.lastScannedBlock) + 1);
    if (from > Number(targetBlock)) return;
    const filter = {
      address: [this.scope.vaultAddress, this.scope.drawManagerAddress],
      topics: [topics],
    };
    await queryLogsChunked(
      canonicalProvider,
      filter,
      from,
      Number(targetBlock),
      "watcher-independent",
      {
        chunkSize,
        concurrency: 1,
        getLogs: (start, end) => getLogsRangeDirect(logProvider, filter, start, end),
        onBatch: async ({ windows, logs, canonical }) => {
          const reconstructed = ingestWatcherReconstructionLogs({
            logs,
            vaultAddress: this.scope.vaultAddress,
            drawManagerAddress: this.scope.drawManagerAddress,
            initialAccounts: this.state.participantAccounts,
            initialSeedBlocks: this.state.seedBlocks,
          });
          for (const log of logs) {
            if (getAddress(log.address) !== this.scope.drawManagerAddress) continue;
            const parsed = iface.parseLog(log);
            const drawId = parsed?.args?.drawId?.toString();
            if (parsed?.name === "SeedReceived") {
              this.state.seedEvidence[drawId] = {
                seed: parsed.args.seed.toLowerCase(),
                blockNumber: Number(log.blockNumber),
                blockHash: String(log.blockHash).toLowerCase(),
              };
            } else if (parsed?.name === "RootProposed") {
              this.state.proposals[drawId] = {
                root: parsed.args.root.toLowerCase(),
                challengeEndsAt: Number(parsed.args.challengeEndsAt),
                blockNumber: Number(log.blockNumber),
                blockHash: String(log.blockHash).toLowerCase(),
              };
            } else if (parsed?.name === "RootFinalized") {
              this.state.finalizations[drawId] = {
                root: parsed.args.root.toLowerCase(),
                blockNumber: Number(log.blockNumber),
                blockHash: String(log.blockHash).toLowerCase(),
              };
            }
          }
          this.state.participantAccounts = reconstructed.accounts;
          this.state.seedBlocks = reconstructed.seedBlocks;
          this.state.lastScannedBlock = windows[windows.length - 1][1];
          this.state.lastScannedBlockHash = canonical.checkpointHash;
          atomicWrite(this.file, this.state);
        },
      },
    );
  }

  assertEvent(kind, drawId, root) {
    const key = BigInt(drawId).toString();
    const event = this.state[kind]?.[key];
    if (!event || event.root !== String(root).toLowerCase()) {
      throw new Error(`Independent RPC missing/mismatched ${kind} event for draw ${key}`);
    }
    return event;
  }

  async assertEvidenceCanonical(canonicalProvider, kind, drawId, root) {
    const key = BigInt(drawId).toString();
    const event = this.assertEvent(kind, key, root);
    const seed = this.state.seedEvidence[key];
    if (!seed) throw new Error(`Independent RPC has no canonical seed evidence for draw ${key}`);
    const [eventBlock, seedBlock, checkpoint] = await Promise.all([
      canonicalProvider.getBlock(event.blockNumber),
      canonicalProvider.getBlock(seed.blockNumber),
      canonicalProvider.getBlock(this.state.lastScannedBlock),
    ]);
    if (eventBlock?.hash?.toLowerCase() !== event.blockHash) {
      throw new Error(`Independent ${kind} evidence is non-canonical for draw ${key}`);
    }
    if (seedBlock?.hash?.toLowerCase() !== seed.blockHash) {
      throw new Error(`Independent seed evidence is non-canonical for draw ${key}`);
    }
    if (checkpoint?.hash?.toLowerCase() !== this.state.lastScannedBlockHash.toLowerCase()) {
      this.state = emptyState(this.scope);
      atomicWrite(this.file, this.state);
      throw new Error(`Independent checkpoint changed while verifying draw ${key}`);
    }
    return {
      root: event.root,
      eventBlockNumber: event.blockNumber,
      eventBlockHash: event.blockHash,
      seedBlockNumber: seed.blockNumber,
      seedBlockHash: seed.blockHash,
      seed: seed.seed,
    };
  }

  markVerified(drawId, evidence) {
    this.state.verifiedRoots[BigInt(drawId).toString()] = evidence;
    atomicWrite(this.file, this.state);
  }

  verifiedRoot(drawId) {
    const key = BigInt(drawId).toString();
    const marker = this.state.verifiedRoots[key];
    return evidenceMatches(marker, this.state.proposals[key], this.state.seedEvidence[key])
      ? marker.root
      : undefined;
  }

  markHistoricalFinalizedIntegrity(drawId, { proposalEvidence, finalizationEvidence }) {
    const key = BigInt(drawId).toString();
    this.state.historicalFinalizedRoots[key] = {
      root: proposalEvidence.root,
      proposalEvidence,
      finalizationEvidence,
      recoveredAt: new Date().toISOString(),
    };
    atomicWrite(this.file, this.state);
  }

  historicalFinalizedRoot(drawId) {
    const key = BigInt(drawId).toString();
    const marker = this.state.historicalFinalizedRoots[key];
    if (!marker || marker.root !== marker.proposalEvidence?.root || marker.root !== marker.finalizationEvidence?.root) {
      return undefined;
    }
    const proposalMatches = evidenceMatches(
      marker.proposalEvidence,
      this.state.proposals[key],
      this.state.seedEvidence[key],
    );
    const finalizationMatches = evidenceMatches(
      marker.finalizationEvidence,
      this.state.finalizations[key],
      this.state.seedEvidence[key],
    );
    return proposalMatches && finalizationMatches ? marker.root : undefined;
  }

  integrityVerifiedRoot(drawId) {
    return this.verifiedRoot(drawId) || this.historicalFinalizedRoot(drawId);
  }

  recordCoverageIncident(drawId, root, evidence) {
    const key = BigInt(drawId).toString();
    const normalizedRoot = String(root).toLowerCase();
    const existing = this.state.coverageIncidents[key];
    if (existing?.root === normalizedRoot) return false;
    this.state.coverageIncidents[key] = {
      root: normalizedRoot,
      kind: "historical-finalized-integrity-recovery",
      evidence,
      detectedAt: new Date().toISOString(),
      notifiedAt: null,
      acknowledgedAt: null,
      acknowledgment: null,
    };
    atomicWrite(this.file, this.state);
    return true;
  }

  markCoverageIncidentNotified(drawId, root) {
    const key = BigInt(drawId).toString();
    const incident = this.state.coverageIncidents[key];
    if (!incident || incident.root !== String(root).toLowerCase() || incident.notifiedAt) return false;
    incident.notifiedAt = new Date().toISOString();
    atomicWrite(this.file, this.state);
    return true;
  }

  acknowledgeCoverageIncident(drawId, root, acknowledgment) {
    const key = BigInt(drawId).toString();
    const incident = this.state.coverageIncidents[key];
    if (!incident || incident.root !== String(root).toLowerCase() || incident.acknowledgedAt) return false;
    incident.acknowledgedAt = new Date().toISOString();
    incident.acknowledgment = String(acknowledgment);
    atomicWrite(this.file, this.state);
    return true;
  }

  coverageIncident(drawId, root) {
    const incident = this.state.coverageIncidents[BigInt(drawId).toString()];
    return incident?.root === String(root).toLowerCase() ? { ...incident } : undefined;
  }

  markFinalizationHandled(drawId, evidence) {
    this.state.publishedFinalizations[BigInt(drawId).toString()] = evidence;
    atomicWrite(this.file, this.state);
  }

  finalizationHandled(drawId, root) {
    const key = BigInt(drawId).toString();
    const marker = this.state.publishedFinalizations[key];
    return marker?.root === String(root).toLowerCase()
      && evidenceMatches(marker, this.state.finalizations[key], this.state.seedEvidence[key]);
  }

  accounts() {
    return [...this.state.participantAccounts];
  }

  seedBlock(drawId) {
    return this.state.seedBlocks[BigInt(drawId).toString()];
  }
}
