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
    version: 1,
    ...scope,
    lastScannedBlock: scope.fromBlock - 1,
    lastScannedBlockHash: "",
    participantAccounts: [],
    seedBlocks: {},
    proposals: {},
    finalizations: {},
    verifiedRoots: {},
    publishedFinalizations: {},
  };
}

function atomicWrite(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }) + "\n");
  fs.renameSync(temp, file);
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
        value.version !== 1
        || value.chainId !== this.scope.chainId
        || getAddress(value.drawManagerAddress) !== this.scope.drawManagerAddress
        || getAddress(value.vaultAddress) !== this.scope.vaultAddress
        || Number(value.fromBlock) !== this.scope.fromBlock
      ) return emptyState(this.scope);
      value.publishedFinalizations ||= {};
      return value;
    } catch {
      return emptyState(this.scope);
    }
  }

  async ensureCanonical(provider) {
    if (!this.state.lastScannedBlockHash || this.state.lastScannedBlock < this.scope.fromBlock) return;
    const block = await provider.getBlock(this.state.lastScannedBlock);
    if (!block?.hash || block.hash.toLowerCase() !== this.state.lastScannedBlockHash.toLowerCase()) {
      this.state = emptyState(this.scope);
      atomicWrite(this.file, this.state);
    }
  }

  async syncThrough(provider, targetBlock, {
    chunkSize = Number(process.env.WATCHER_INDEPENDENT_LOG_CHUNK_SIZE || "1000"),
  } = {}) {
    await this.ensureCanonical(provider);
    const from = Math.max(this.scope.fromBlock, Number(this.state.lastScannedBlock) + 1);
    if (from > Number(targetBlock)) return;
    const filter = {
      address: [this.scope.vaultAddress, this.scope.drawManagerAddress],
      topics: [topics],
    };
    await queryLogsChunked(
      provider,
      filter,
      from,
      Number(targetBlock),
      "watcher-independent",
      {
        chunkSize,
        concurrency: 1,
        getLogs: (start, end) => getLogsRangeDirect(provider, filter, start, end),
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
            if (parsed?.name === "RootProposed") {
              this.state.proposals[parsed.args.drawId.toString()] = {
                root: parsed.args.root.toLowerCase(),
                blockNumber: Number(log.blockNumber),
                blockHash: String(log.blockHash).toLowerCase(),
              };
            } else if (parsed?.name === "RootFinalized") {
              this.state.finalizations[parsed.args.drawId.toString()] = {
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

  markVerified(drawId, root) {
    this.state.verifiedRoots[BigInt(drawId).toString()] = String(root).toLowerCase();
    atomicWrite(this.file, this.state);
  }

  verifiedRoot(drawId) {
    return this.state.verifiedRoots[BigInt(drawId).toString()];
  }

  markFinalizationHandled(drawId, root) {
    this.state.publishedFinalizations[BigInt(drawId).toString()] = String(root).toLowerCase();
    atomicWrite(this.file, this.state);
  }

  finalizationHandled(drawId, root) {
    return this.state.publishedFinalizations[BigInt(drawId).toString()] === String(root).toLowerCase();
  }

  accounts() {
    return [...this.state.participantAccounts];
  }

  seedBlock(drawId) {
    return this.state.seedBlocks[BigInt(drawId).toString()];
  }
}
