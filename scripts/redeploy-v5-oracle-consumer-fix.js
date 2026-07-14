import "dotenv/config";
import fs from "node:fs";
import hre from "hardhat";

const { ethers } = hre;

const DEPLOYMENT_FILE = "deployments/monad-testnet.json";
const TESTNET_CHAIN_ID = 10143n;
const DEFAULT_LIVE_DRAW_MANAGER = "0x5BeF7B5c5B83D56cfF32F7c66DE6D7916e9aD509";
const DEFAULT_LIVE_CLAIM_MANAGER = "0x779A01A7cc19d5E811F4077BdE97F33e8a57D202";

function readDeploymentFile() {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function writeDeploymentFile(data) {
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2) + "\n");
}

function findCurrentV5Record(data) {
  const records = (data.contracts || []).filter((entry) => entry.source === "src/v5" && entry.addresses);
  if (!records.length) throw new Error("No src/v5 deployment record found");
  return records[records.length - 1];
}

function requiredAddress(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return ethers.getAddress(value);
}

async function deploy(name, args = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log(`${name} deployed: ${address} tx=${receipt.hash}`);
  return { contract, address, tx: receipt.hash, blockNumber: receipt.blockNumber };
}

async function send(label, txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash}`);
  return { tx: receipt.hash, blockNumber: receipt.blockNumber };
}

async function assertTestnetAndSigner() {
  if (hre.network.name !== "monadTestnet") {
    throw new Error("This script is testnet-only; use --network monadTestnet");
  }
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(`Wrong chain id: got ${network.chainId}, expected ${TESTNET_CHAIN_ID}`);
  }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer configured; operator must run with PRIVATE_KEY set via hardhat.config.js");
  return deployer;
}

async function queueFix() {
  const deployer = await assertTestnetAndSigner();
  const data = readDeploymentFile();
  const current = findCurrentV5Record(data);

  const entropy = requiredAddress("PYTH_ENTROPY", current.constructorArgs?.entropy || data.addresses?.pythEntropy);
  const entropyProvider = requiredAddress(
    "PYTH_ENTROPY_PROVIDER",
    current.constructorArgs?.entropyProvider || data.addresses?.pythEntropyProvider,
  );
  const drawManagerAddress = requiredAddress("DRAW_MANAGER_ADDRESS", DEFAULT_LIVE_DRAW_MANAGER);
  const claimManagerAddress = requiredAddress("CLAIM_MANAGER_ADDRESS", DEFAULT_LIVE_CLAIM_MANAGER);
  const previousOracleAddress = requiredAddress(
    "PREVIOUS_PYTH_RANDOMNESS_ORACLE",
    current.addresses?.pythRandomnessOracle || "",
  );

  const drawManager = await ethers.getContractAt("DrawManagerV5", drawManagerAddress);
  const owner = await drawManager.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Signer ${deployer.address} is not DrawManagerV5 owner (${owner}); queueOracleChange will revert.`,
    );
  }

  const liveOracle = await drawManager.randomnessOracle();
  if (liveOracle.toLowerCase() !== previousOracleAddress.toLowerCase()) {
    console.warn(
      `Warning: deployment record oracle ${previousOracleAddress} differs from live DrawManager oracle ${liveOracle}. ` +
        "Using deployment-record entropy/provider but recording the live previous oracle.",
    );
  }

  console.log("Deploying replacement PythRandomnessOracle for current DrawManagerV5 consumer:");
  console.log({
    deployer: deployer.address,
    entropy,
    entropyProvider,
    consumer: drawManagerAddress,
    previousOracle: liveOracle,
  });

  const oracle = await deploy("PythRandomnessOracle", [entropy, entropyProvider, drawManagerAddress]);
  const queued = await send("drawManager.queueOracleChange", drawManager.queueOracleChange(oracle.address));
  const pendingOracle = await drawManager.pendingOracle();
  const pendingOracleEffectiveAt = Number(await drawManager.pendingOracleEffectiveAt());
  if (pendingOracle.toLowerCase() !== oracle.address.toLowerCase()) {
    throw new Error(`Pending oracle mismatch: expected ${oracle.address}, got ${pendingOracle}`);
  }

  const record = {
    role: "V5 UAT ADR-0043 oracle consumer fix",
    status: "oracle-change-queued",
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
    source: "src/v5",
    deployCommit: process.env.DEPLOY_COMMIT || "record-git-commit",
    adr: "decisions/0043-v5-prize-auto-compound.md",
    note:
      "Repair for ADR-0043 redeploy gap: PythRandomnessOracle.consumer is immutable, so the " +
      "new DrawManagerV5 needs a freshly deployed oracle whose consumer is the new DrawManager. " +
      "drawManager.queueOracleChange(newOracle) has been submitted; commitOracleChange() must " +
      "be called after ORACLE_CHANGE_DELAY.",
    addresses: {
      ...current.addresses,
      claimManager: claimManagerAddress,
      drawManager: drawManagerAddress,
      pythRandomnessOracle: oracle.address,
    },
    deployTxs: {
      pythRandomnessOracle: oracle.tx,
      drawManagerQueueOracleChange: queued.tx,
    },
    startBlock: Math.min(oracle.blockNumber, queued.blockNumber),
    constructorArgs: {
      ...current.constructorArgs,
      entropy,
      entropyProvider,
      oracleConsumer: drawManagerAddress,
    },
    oracleChange: {
      previousOracle: liveOracle,
      newOracle: oracle.address,
      queuedAt: new Date().toISOString(),
      effectiveAtUnix: pendingOracleEffectiveAt,
      commitRequiredAfter: new Date(pendingOracleEffectiveAt * 1000).toISOString(),
      status: "queued",
    },
    watcherSecrets: {
      drawManagerAddressSecret: "DRAW_MANAGER_ADDRESS",
      claimManagerAddressSecret: "CLAIM_MANAGER_ADDRESS",
      fromBlockSecret: "V5_WATCHER_FROM_BLOCK",
    },
  };

  data.contracts = data.contracts || [];
  data.contracts.push(record);
  writeDeploymentFile(data);

  console.log(`Recorded queued oracle fix in ${DEPLOYMENT_FILE}`);
  console.log("IMPORTANT: ORACLE_CHANGE_DELAY is 24 hours. Do not call commitOracleChange until:");
  console.log(`  ${record.oracleChange.commitRequiredAfter}`);
  console.log("After the delay, run:");
  console.log("  HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-oracle-consumer-fix.js --commit");
}

async function commitFix() {
  const deployer = await assertTestnetAndSigner();
  const data = readDeploymentFile();
  const current = findCurrentV5Record(data);
  const drawManagerAddress = requiredAddress("DRAW_MANAGER_ADDRESS", current.addresses?.drawManager || DEFAULT_LIVE_DRAW_MANAGER);
  const expectedOracle = requiredAddress("PYTH_RANDOMNESS_ORACLE", current.addresses?.pythRandomnessOracle || "");

  const drawManager = await ethers.getContractAt("DrawManagerV5", drawManagerAddress);
  const owner = await drawManager.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `Signer ${deployer.address} is not DrawManagerV5 owner (${owner}); commitOracleChange will revert.`,
    );
  }

  const pendingOracle = await drawManager.pendingOracle();
  if (pendingOracle.toLowerCase() !== expectedOracle.toLowerCase()) {
    throw new Error(`Pending oracle mismatch: expected ${expectedOracle}, got ${pendingOracle}`);
  }

  const committed = await send("drawManager.commitOracleChange", drawManager.commitOracleChange());
  const liveOracle = await drawManager.randomnessOracle();
  if (liveOracle.toLowerCase() !== expectedOracle.toLowerCase()) {
    throw new Error(`Oracle commit verification failed: expected ${expectedOracle}, got ${liveOracle}`);
  }

  current.status = "oracle-change-committed";
  current.oracleChange = {
    ...(current.oracleChange || {}),
    status: "committed",
    committedAt: new Date().toISOString(),
    commitTx: committed.tx,
    committedBlock: committed.blockNumber,
  };
  current.deployTxs = {
    ...(current.deployTxs || {}),
    drawManagerCommitOracleChange: committed.tx,
  };
  writeDeploymentFile(data);

  console.log(`Oracle committed and verified: drawManager.randomnessOracle()=${liveOracle}`);
  console.log(`Updated ${DEPLOYMENT_FILE}`);
}

const args = new Set(process.argv.slice(2));
const mode = args.has("--commit") ? "commit" : "queue";

(mode === "commit" ? commitFix() : queueFix()).catch((err) => {
  console.error(err);
  process.exit(1);
});
