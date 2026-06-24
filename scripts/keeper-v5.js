#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, ZeroAddress, getAddress, keccak256 } from "ethers";
import { buildDrawInput } from "./draw/write-watch-inputs.mjs";
import { compute } from "./draw/compute-winners.js";

const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE || "deployments/monad-testnet.json";
const RPC_URL = process.env.KEEPER_RPC_URL || process.env.RPC_URL || process.env.MONAD_TESTNET_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const DRAW_INPUT_DIR = process.env.DRAW_INPUT_DIR || process.env.WATCHER_DRAW_INPUT_DIR || "draw-inputs";
const LOOP = process.env.KEEPER_LOOP === "true";
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS || 60_000);
const CLAIM_BATCH_SIZE = Number(process.env.CLAIM_BATCH_SIZE || 50);
const HEALTHCHECK_URL = process.env.KEEPER_HEALTHCHECK_URL;
const LOW_BALANCE_WEI = BigInt(process.env.KEEPER_LOW_BALANCE_WEI || "500000000000000000");
const abi = AbiCoder.defaultAbiCoder();

const DRAW_MANAGER_ABI = [
  "function vault() view returns (address)",
  "function twabController() view returns (address)",
  "function claimManager() view returns (address)",
  "function randomnessOracle() view returns (address)",
  "function primaryProposer() view returns (address)",
  "function nextPeriodStart() view returns (uint64)",
  "function drawPeriod() view returns (uint64)",
  "function currentDrawId() view returns (uint256)",
  "function minPrizeThreshold() view returns (uint256)",
  "function challengeWindow() view returns (uint64)",
  "function seedRequestTimeout() view returns (uint64)",
  "function seedRequestedAt(uint256) view returns (uint64)",
  "function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)",
  "function startDraw() payable returns (uint256)",
  "function rerequestSeed(uint256) payable",
  "function proposeRoot(uint256 drawId, bytes32 root, uint32 winnerCount, uint256 totalPayout)",
  "function finalizeRoot(uint256 drawId)",
];

const TWAB_ABI = [
  "function getTotalTwabBetween(address vault,uint64 startTime,uint64 endTime) view returns (uint256)",
];

const VAULT_ABI = [
  "function availableYield() view returns (uint256)",
];

const ORACLE_ABI = [
  "function getFee() view returns (uint128)",
];

const CLAIM_MANAGER_ABI = [
  "function isClaimed(bytes32 distributionId,uint256 leafIndex) view returns (bool)",
  "function claimMany(tuple(bytes32 distributionId,uint256 leafIndex,address account,address token,uint256 amount)[] leaves, bytes32[][] proofs)",
];

function readDeployment() {
  const data = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const v5 = [...(data.contracts || [])].reverse().find((entry) => entry.role === "V5 M8 testnet soak");
  if (!v5) throw new Error(`No V5 M8 testnet soak deployment in ${DEPLOYMENT_FILE}`);
  return v5;
}

function requiredAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return getAddress(value);
}

function statusName(status) {
  return ["None", "AwaitingSeed", "Seeded", "Proposed", "Finalized", "Skipped"][Number(status)] || `Unknown(${status})`;
}

// EverdrawTwabController.TimestampNotFinalized(uint256,uint256): the queried period is still
// inside the current overwrite window and not finalized. Transient — the keeper should wait
// and retry, not crash. Match the revert-data selector wherever ethers surfaces it.
const TWAB_NOT_FINALIZED_SELECTOR = "0x947ad913";
function isTwabNotFinalized(err) {
  const candidates = [
    err?.data,
    err?.info?.error?.data,
    err?.error?.data,
    err?.revert?.signature,
    err?.shortMessage,
    err?.message,
  ];
  return candidates.some(
    (c) => typeof c === "string" && c.toLowerCase().includes(TWAB_NOT_FINALIZED_SELECTOR)
  );
}

// startDraw reverts with Error("insufficient oracle fee") when msg.value < the live Pyth fee.
function isInsufficientOracleFee(err) {
  const text = [err?.reason, err?.shortMessage, err?.message, err?.revert?.args?.[0]]
    .filter((c) => typeof c === "string")
    .join(" ")
    .toLowerCase();
  return text.includes("insufficient oracle fee");
}

// Pad the oracle fee to absorb the dynamic (per-block) Pyth component. The contract refunds
// any excess on the real-draw path, so over-paying is safe; under-paying reverts.
function bufferedOracleFee(fee) {
  return (BigInt(fee) * 3n) / 2n; // +50%
}

async function send(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label} sent ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} reverted: ${tx.hash}`);
  console.log(`${label} mined ${receipt.hash} gas=${receipt.gasUsed}`);
  return receipt;
}

async function ping(ok, message = "") {
  if (!HEALTHCHECK_URL) return;
  const url = ok ? HEALTHCHECK_URL : `${HEALTHCHECK_URL}/fail`;
  await fetch(url, { method: "POST", body: message }).catch(() => {});
}

function distributionIdFor(drawManagerAddress, drawId) {
  return keccak256(abi.encode(["address", "bytes32"], [drawManagerAddress, `0x${BigInt(drawId).toString(16).padStart(64, "0")}`]));
}

function computeWithPythonParity(input) {
  const result = compute(input);
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "everdraw-v5-keeper-"));
  const tmp = path.join(tmpDir, `${input.drawId}.json`);
  fs.writeFileSync(tmp, JSON.stringify(input));
  const child = spawnSync("python3", ["scripts/draw/compute_winners.py", tmp], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (child.status !== 0) throw new Error(`python root recompute failed\n${child.stderr || child.stdout}`);
  const py = JSON.parse(child.stdout);
  if (py.root.toLowerCase() !== result.root.toLowerCase() || py.leaves.length !== result.leaves.length) {
    throw new Error(`JS/Python root parity failed: js=${result.root} py=${py.root}`);
  }
  return result;
}

async function buildAndPersistInput(provider, drawManagerAddress, drawId, fromBlock) {
  const toBlock = await provider.getBlockNumber();
  const input = await buildDrawInput({ provider, drawManagerAddress, drawId: BigInt(drawId), fromBlock, toBlock });
  fs.mkdirSync(DRAW_INPUT_DIR, { recursive: true });
  const inputFile = path.join(DRAW_INPUT_DIR, `${drawId}.json`);
  fs.writeFileSync(inputFile, JSON.stringify(input, null, 2) + "\n");
  return { input, inputFile };
}

async function maybeStartDraw({ manager, provider, signer, fromBlock }) {
  const latest = await provider.getBlock("latest");
  const nextPeriodStart = await manager.nextPeriodStart();
  const drawPeriod = await manager.drawPeriod();
  const periodEnd = Number(nextPeriodStart + drawPeriod);
  if (latest.timestamp < periodEnd) {
    console.log(`startDraw not due: now=${latest.timestamp} periodEnd=${periodEnd}`);
    return false;
  }

  const vaultAddress = getAddress(await manager.vault());
  const twabAddress = getAddress(await manager.twabController());
  const oracleAddress = getAddress(await manager.randomnessOracle());
  const twab = new Contract(twabAddress, TWAB_ABI, provider);
  const vault = new Contract(vaultAddress, VAULT_ABI, provider);
  const oracle = new Contract(oracleAddress, ORACLE_ABI, provider);
  const [availableYield, minPrizeThreshold] = await Promise.all([
    vault.availableYield(),
    manager.minPrizeThreshold(),
  ]);

  // getTotalTwabBetween can revert for two very different reasons:
  //  1. Empty / never-deposited period: no TWAB observations -> bare require(false), data "0x".
  //     Valid state — startDraw skips the empty period cleanly on-chain (ADR-0036 §3.4).
  //     Treat as zero TWAB and proceed to startDraw.
  //  2. TimestampNotFinalized (selector 0x947ad913): the period's TWAB is not finalized yet
  //     (still inside the current overwrite window). This is transient — wait and retry next
  //     loop. Do NOT call startDraw; it would revert with the same error and crash the keeper.
  let totalTwab = 0n;
  try {
    totalTwab = await twab.getTotalTwabBetween(vaultAddress, nextPeriodStart, nextPeriodStart + drawPeriod);
  } catch (err) {
    if (isTwabNotFinalized(err)) {
      console.log(`startDraw deferred: TWAB period not finalized yet — will retry next loop`);
      return false;
    }
    console.log(`getTotalTwabBetween reverted (empty/no-observation period) — treating as zero TWAB: ${err.shortMessage || err.message}`);
    totalTwab = 0n;
  }

  // Off-chain prediction of "is this a real draw" can disagree with the contract's on-chain
  // computation (finalization timing / boundary cases). So we predict a fee here, but also
  // self-correct below if the contract says the fee is insufficient.
  let value = 0n;
  if (totalTwab !== 0n && availableYield !== 0n && availableYield >= minPrizeThreshold) {
    value = bufferedOracleFee(await oracle.getFee());
  }
  try {
    await send("startDraw", manager.connect(signer).startDraw({ value }));
  } catch (err) {
    if (isTwabNotFinalized(err)) {
      console.log(`startDraw deferred: TWAB period not finalized yet (at submit) — will retry next loop`);
      return false;
    }
    if (isInsufficientOracleFee(err)) {
      // The contract committed to a REAL draw (it only checks the fee after passing the skip
      // guards) but our predicted value was too low (we guessed skip, or the dynamic Pyth fee
      // ticked up). Retry with a buffered fee. Excess is refunded on the real-draw path, and a
      // skip can never reach the fee check, so no value is ever stranded on a skip.
      const buffered = bufferedOracleFee(await oracle.getFee());
      console.log(`startDraw: insufficient oracle fee — retrying with buffered fee ${buffered}`);
      await send("startDraw", manager.connect(signer).startDraw({ value: buffered }));
    } else {
      throw err;
    }
  }
  console.log(`startDraw completed using fromBlock=${fromBlock}`);
  return true;
}

async function maybeRerequestSeed({ manager, signer, provider, drawId, draw }) {
  if (Number(draw.status) !== 1) return false;
  const latest = await provider.getBlock("latest");
  const requestedAt = await manager.seedRequestedAt(drawId);
  const timeout = await manager.seedRequestTimeout();
  if (requestedAt === 0n || BigInt(latest.timestamp) < requestedAt + timeout) {
    console.log(`draw ${drawId} awaiting seed`);
    return false;
  }
  const oracle = new Contract(await manager.randomnessOracle(), ORACLE_ABI, provider);
  const fee = await oracle.getFee();
  await send(`rerequestSeed(${drawId})`, manager.connect(signer).rerequestSeed(drawId, { value: fee }));
  return true;
}

async function maybePropose({ manager, signer, provider, drawManagerAddress, drawId, fromBlock }) {
  const draw = await manager.draws(drawId);
  if (Number(draw.status) !== 2) return false;
  const primaryProposer = getAddress(await manager.primaryProposer());
  if (primaryProposer !== ZeroAddress && primaryProposer.toLowerCase() !== signer.address.toLowerCase()) {
    console.log(`not primary proposer: signer=${signer.address} primary=${primaryProposer}`);
    return false;
  }

  const { input, inputFile } = await buildAndPersistInput(provider, drawManagerAddress, drawId, fromBlock);
  const result = computeWithPythonParity(input);
  if (result.leaves.length === 0) throw new Error(`draw ${drawId} computed zero leaves`);
  await send(
    `proposeRoot(${drawId})`,
    manager.connect(signer).proposeRoot(drawId, result.root, result.leafCount, result.totalPayout),
  );
  console.log(`proposed draw ${drawId}: root=${result.root} leaves=${result.leafCount} input=${inputFile}`);
  return true;
}

async function maybeFinalize({ manager, signer, provider, drawId }) {
  const draw = await manager.draws(drawId);
  if (Number(draw.status) !== 3) return false;
  const latest = await provider.getBlock("latest");
  const challengeWindow = await manager.challengeWindow();
  const finalizeAfter = Number(draw.proposedAt + challengeWindow);
  if (latest.timestamp < finalizeAfter) {
    console.log(`draw ${drawId} challenge window active until ${finalizeAfter}`);
    return false;
  }
  await send(`finalizeRoot(${drawId})`, manager.connect(signer).finalizeRoot(drawId));
  return true;
}

async function maybeClaim({ manager, signer, provider, drawManagerAddress, claimManagerAddress, drawId, fromBlock }) {
  const draw = await manager.draws(drawId);
  if (Number(draw.status) !== 4) return false;
  const { input, inputFile } = await buildAndPersistInput(provider, drawManagerAddress, drawId, fromBlock);
  const result = computeWithPythonParity(input);
  const claimManager = new Contract(claimManagerAddress, CLAIM_MANAGER_ABI, provider);
  const distributionId = distributionIdFor(drawManagerAddress, drawId);
  const pending = [];
  const proofs = [];
  for (const leaf of result.leaves) {
    const claimed = await claimManager.isClaimed(distributionId, leaf.leafIndex);
    if (claimed) continue;
    pending.push({
      distributionId,
      leafIndex: leaf.leafIndex,
      account: leaf.account,
      token: leaf.token,
      amount: leaf.amount,
    });
    proofs.push(leaf.proof);
  }
  if (pending.length === 0) {
    console.log(`draw ${drawId} all leaves already claimed (${inputFile})`);
    return false;
  }
  for (let i = 0; i < pending.length; i += CLAIM_BATCH_SIZE) {
    const leaves = pending.slice(i, i + CLAIM_BATCH_SIZE);
    const batchProofs = proofs.slice(i, i + CLAIM_BATCH_SIZE);
    await send(`claimMany(${drawId}) batch ${i / CLAIM_BATCH_SIZE + 1}`, claimManager.connect(signer).claimMany(leaves, batchProofs));
  }
  return true;
}

async function runOnce() {
  if (!RPC_URL) throw new Error("Missing KEEPER_RPC_URL/RPC_URL/MONAD_TESTNET_RPC_URL");
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY for keeper signer");
  const deployment = readDeployment();
  const drawManagerAddress = requiredAddress("DRAW_MANAGER_ADDRESS", deployment.addresses.drawManager);
  const claimManagerAddress = requiredAddress("CLAIM_MANAGER_ADDRESS", deployment.addresses.claimManager);
  const fromBlock = Number(process.env.V5_WATCHER_FROM_BLOCK || process.env.V5_KEEPER_FROM_BLOCK || deployment.startBlock || 0);
  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);
  const manager = new Contract(drawManagerAddress, DRAW_MANAGER_ABI, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== 10143n) throw new Error(`wrong chain id ${network.chainId}; expected Monad testnet 10143`);
  const balance = await provider.getBalance(signer.address);
  if (balance < LOW_BALANCE_WEI) throw new Error(`keeper balance low: ${signer.address} balance=${balance}`);

  let acted = await maybeStartDraw({ manager, provider, signer, fromBlock });
  const currentDrawId = await manager.currentDrawId();
  if (currentDrawId === 0n) {
    console.log("no draw exists yet");
    return acted;
  }
  const firstDrawToReconcile = currentDrawId > 5n ? currentDrawId - 5n : 1n;
  for (let drawId = firstDrawToReconcile; drawId <= currentDrawId; drawId++) {
    const draw = await manager.draws(drawId);
    console.log(`draw ${drawId} status=${statusName(draw.status)}`);
    acted = await maybeRerequestSeed({ manager, signer, provider, drawId, draw }) || acted;
    acted = await maybePropose({ manager, signer, provider, drawManagerAddress, drawId, fromBlock }) || acted;
    acted = await maybeFinalize({ manager, signer, provider, drawId }) || acted;
    acted = await maybeClaim({ manager, signer, provider, drawManagerAddress, claimManagerAddress, drawId, fromBlock }) || acted;
  }
  await ping(true);
  return acted;
}

async function main() {
  do {
    try {
      const acted = await runOnce();
      console.log(`keeper loop ok acted=${acted}`);
    } catch (err) {
      await ping(false, err.stack || err.message);
      throw err;
    }
    if (LOOP) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (LOOP);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
