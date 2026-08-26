import fs from "node:fs";
import { ZeroAddress, getAddress } from "ethers";

export const REQUIRED_V5_ADDRESSES = [
  "twabController",
  "shmonStrategy",
  "prizeVault",
  "claimManager",
  "pythRandomnessOracle",
  "drawManager",
];

const ACTIVE_STATUS = "draw-manager-committed";
const MAINNET_CHAIN_ID = 143;
const OWNERSHIP_CONTRACTS = ["twabController", "prizeVault", "claimManager", "drawManager"];

function positiveBlock(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Invalid ${label}: ${value}`);
  return number;
}

function normalizedAddress(value, label) {
  let address;
  try {
    address = getAddress(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value || "<missing>"}`);
  }
  if (address === ZeroAddress) throw new Error(`Invalid ${label}: zero address`);
  return address;
}

function transactionHash(value, label) {
  if (!/^0x[0-9a-f]{64}$/i.test(value || "")) throw new Error(`Invalid ${label}: ${value || "<missing>"}`);
  return value.toLowerCase();
}

function validateMainnetOwnership(entry) {
  if (entry.ownership?.status !== "accepted") {
    throw new Error("Activated mainnet V5 deployment is missing accepted final ownership");
  }
  const finalOwner = normalizedAddress(entry.ownership.finalOwner, "V5 final owner");
  const deployer = normalizedAddress(entry.ownership.deployer, "V5 deployment owner");
  if (finalOwner === deployer) throw new Error("V5 final owner must differ from deployment owner");

  const acceptTxs = {};
  for (const name of OWNERSHIP_CONTRACTS) {
    acceptTxs[name] = transactionHash(entry.ownership.acceptTxs?.[name], `V5 ownership acceptance tx ${name}`);
  }
  return { ...entry.ownership, finalOwner, deployer, acceptTxs };
}

function isV5Record(entry) {
  return entry?.protocolVersion === 5 || (entry?.source === "src/v5" && /^[0-9a-f]{40}$/i.test(entry?.deployCommit || ""));
}

export function selectActiveV5Deployment(data, { expectedChainId }) {
  const chainId = Number(expectedChainId);
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error(`Invalid expected chain id: ${expectedChainId}`);
  if (Number(data?.chainId) !== chainId) {
    throw new Error(`Deployment manifest chain id ${data?.chainId ?? "<missing>"} does not match expected ${chainId}`);
  }

  const active = [...(data?.contracts || [])]
    .reverse()
    .find((entry) => isV5Record(entry) && Number(entry.chainId ?? data.chainId) === chainId && entry.status === ACTIVE_STATUS);
  if (!active) {
    throw new Error(`No activated V5 deployment for chain ${chainId}; required status=${ACTIVE_STATUS}`);
  }

  const addresses = {};
  for (const name of REQUIRED_V5_ADDRESSES) {
    addresses[name] = normalizedAddress(active.addresses?.[name], `V5 deployment address ${name}`);
  }

  const ownership = chainId === MAINNET_CHAIN_ID ? validateMainnetOwnership(active) : active.ownership;

  return {
    ...active,
    chainId,
    startBlock: positiveBlock(active.startBlock, "V5 deployment startBlock"),
    addresses,
    ownership,
  };
}

export function readActiveV5Deployment(file, options) {
  if (!fs.existsSync(file)) throw new Error(`Deployment manifest not found: ${file}`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return selectActiveV5Deployment(data, options);
}

export function resolveV5RuntimeTargets(deployment, env = process.env) {
  const configuredDrawManager = env.DRAW_MANAGER_ADDRESS
    ? normalizedAddress(env.DRAW_MANAGER_ADDRESS, "DRAW_MANAGER_ADDRESS")
    : deployment.addresses.drawManager;
  const configuredClaimManager = env.CLAIM_MANAGER_ADDRESS
    ? normalizedAddress(env.CLAIM_MANAGER_ADDRESS, "CLAIM_MANAGER_ADDRESS")
    : deployment.addresses.claimManager;
  const configuredFromBlock = positiveBlock(
    env.V5_WATCHER_FROM_BLOCK || env.V5_KEEPER_FROM_BLOCK || deployment.startBlock,
    "V5 runtime from block",
  );

  if (configuredDrawManager !== deployment.addresses.drawManager) {
    throw new Error(`DRAW_MANAGER_ADDRESS ${configuredDrawManager} does not match activated deployment ${deployment.addresses.drawManager}`);
  }
  if (configuredClaimManager !== deployment.addresses.claimManager) {
    throw new Error(`CLAIM_MANAGER_ADDRESS ${configuredClaimManager} does not match activated deployment ${deployment.addresses.claimManager}`);
  }
  if (configuredFromBlock !== deployment.startBlock) {
    throw new Error(`V5 runtime from block ${configuredFromBlock} does not match activated deployment ${deployment.startBlock}`);
  }

  return {
    drawManagerAddress: configuredDrawManager,
    claimManagerAddress: configuredClaimManager,
    fromBlock: configuredFromBlock,
  };
}
