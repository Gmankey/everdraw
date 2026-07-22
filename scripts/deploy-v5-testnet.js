import "dotenv/config";
import fs from "node:fs";
import hre from "hardhat";

const { ethers } = hre;

const DEPLOYMENT_FILE = "deployments/monad-testnet.json";
const TESTNET_CHAIN_ID = 10143n;

function required(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing ${name} env var`);
  return value;
}

function optionalAddress(name) {
  const value = process.env[name];
  return value && value !== ethers.ZeroAddress ? value : "";
}

function numberEnv(name, fallback) {
  const raw = process.env[name] || String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}

function hasEnv(name) {
  return process.env[name] !== undefined && process.env[name] !== "";
}

function alignmentRemainder(timestamp, offset, periodLength) {
  return (timestamp - offset) % periodLength;
}

function snapToTwabGrid(timestamp, offset, periodLength) {
  const remainder = alignmentRemainder(timestamp, offset, periodLength);
  return remainder === 0 ? timestamp : timestamp + (periodLength - remainder);
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
  return receipt.hash;
}

function readDeploymentFile() {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function writeDeploymentRecord(record) {
  const data = readDeploymentFile();
  data.contracts = data.contracts || [];
  data.contracts.push(record);
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  if (hre.network.name !== "monadTestnet") {
    throw new Error("V5 M8 deploy script is testnet-only; use --network monadTestnet");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(`Wrong chain id: got ${network.chainId}, expected ${TESTNET_CHAIN_ID}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer configured; operator must run with PRIVATE_KEY");

  const deploymentData = readDeploymentFile();
  const shmon = required("SHMON", deploymentData.addresses?.shmon);
  const entropy = required("ENTROPY", deploymentData.addresses?.pythEntropy);
  const entropyProvider = required("ENTROPY_PROVIDER", deploymentData.addresses?.pythEntropyProvider);
  const guardian = required("GUARDIAN");
  const keeper = required("KEEPER");
  const pauser = optionalAddress("PAUSER");

  const latest = await ethers.provider.getBlock("latest");
  const twabPeriodLength = numberEnv("TWAB_PERIOD_LENGTH_SEC", 3600);
  const twabPeriodOffset = numberEnv("TWAB_PERIOD_OFFSET", Number(latest.timestamp));
  const drawPeriod = numberEnv("DRAW_PERIOD_SEC", 3600);
  if (twabPeriodOffset > Number(latest.timestamp)) {
    throw new Error(`TWAB_PERIOD_OFFSET must be <= latest timestamp: offset=${twabPeriodOffset} now=${latest.timestamp}`);
  }
  if (drawPeriod % twabPeriodLength !== 0) {
    throw new Error(`DRAW_PERIOD_SEC must be a multiple of TWAB_PERIOD_LENGTH_SEC: drawPeriod=${drawPeriod}, twabPeriodLength=${twabPeriodLength}`);
  }

  const firstPeriodStartExplicit = hasEnv("FIRST_PERIOD_START");
  const firstPeriodCandidate = firstPeriodStartExplicit
    ? numberEnv("FIRST_PERIOD_START", 0)
    : Number(latest.timestamp) + numberEnv("FIRST_PERIOD_DELAY_SEC", 300);
  const firstPeriodStart = firstPeriodStartExplicit
    ? firstPeriodCandidate
    : snapToTwabGrid(firstPeriodCandidate, twabPeriodOffset, twabPeriodLength);
  if (firstPeriodStart < twabPeriodOffset) {
    throw new Error(`FIRST_PERIOD_START must be >= TWAB_PERIOD_OFFSET: firstPeriodStart=${firstPeriodStart}, offset=${twabPeriodOffset}`);
  }
  const firstPeriodStartRemainder = alignmentRemainder(firstPeriodStart, twabPeriodOffset, twabPeriodLength);
  if (firstPeriodStartRemainder !== 0) {
    throw new Error(
      `FIRST_PERIOD_START must align to TWAB grid: firstPeriodStart=${firstPeriodStart}, offset=${twabPeriodOffset}, periodLength=${twabPeriodLength}, remainder=${firstPeriodStartRemainder}`,
    );
  }

  const proposerGrace = numberEnv("PROPOSER_GRACE_PERIOD_SEC", 300);
  const challengeWindow = numberEnv("CHALLENGE_WINDOW_SEC", 900);
  const depositCap = ethers.parseEther(process.env.DEPOSIT_CAP_MON || "25000");
  const symbol = process.env.VAULT_SYMBOL || "EVRDRAW-V5-MON";

  console.log("Deploying EverDraw V5 M8 testnet stack with:");
  console.log({
    deployer: deployer.address,
    shmon,
    entropy,
    entropyProvider,
    guardian,
    keeper,
    pauser: pauser || deployer.address,
    firstPeriodStart,
    firstPeriodStartExplicit,
    firstPeriodStartRemainder,
    twabPeriodLength,
    twabPeriodOffset,
    twabOffsetAgeSec: Number(latest.timestamp) - twabPeriodOffset,
    drawPeriod,
    drawPeriodRemainder: drawPeriod % twabPeriodLength,
    proposerGrace,
    challengeWindow,
    depositCap: depositCap.toString(),
    symbol,
  });

  const twab = await deploy("EverdrawTwabController", [twabPeriodLength, twabPeriodOffset]);
  const strategy = await deploy("ShmonStrategy", [shmon]);
  const vault = await deploy("PrizeVaultV5", [twab.address, strategy.address, depositCap, symbol]);
  const claimManager = await deploy("ClaimManagerV5");

  const nonce = await deployer.getNonce();
  const predictedOracle = ethers.getCreateAddress({ from: deployer.address, nonce });
  const predictedManager = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  console.log({ predictedOracle, predictedManager });

  const oracle = await deploy("PythRandomnessOracle", [entropy, entropyProvider, predictedManager]);
  if (oracle.address.toLowerCase() !== predictedOracle.toLowerCase()) {
    throw new Error(`Oracle prediction mismatch: predicted ${predictedOracle}, got ${oracle.address}`);
  }

  const manager = await deploy("DrawManagerV5", [
    vault.address,
    twab.address,
    claimManager.address,
    oracle.address,
    guardian,
    keeper,
    firstPeriodStart,
    drawPeriod,
    proposerGrace,
    challengeWindow,
  ]);
  if (manager.address.toLowerCase() !== predictedManager.toLowerCase()) {
    throw new Error(`Manager prediction mismatch: predicted ${predictedManager}, got ${manager.address}`);
  }

  const setupTxs = {
    strategySetVault: await send("strategy.setVault", strategy.contract.setVault(vault.address)),
    twabRegisterVault: await send("twab.registerVault", twab.contract.registerVault(vault.address)),
    claimAuthorizeManager: await send(
      "claimManager.setAuthorizedSource",
      claimManager.contract.setAuthorizedSource(manager.address, true),
    ),
    claimSetCompoundVault: await send(
      "claimManager.setCompoundVault",
      claimManager.contract.setCompoundVault(manager.address, vault.address),
    ),
    vaultQueueDrawManagerChange: await send(
      "vault.queueDrawManagerChange",
      vault.contract.queueDrawManagerChange(manager.address),
    ),
  };
  if (pauser) {
    setupTxs.vaultSetPauser = await send("vault.setPauser", vault.contract.setPauser(pauser));
  }

  const pendingDrawManager = await vault.contract.pendingDrawManager();
  const pendingDrawManagerEffectiveAt = await vault.contract.pendingDrawManagerEffectiveAt();
  const configuredCompoundVault = await claimManager.contract.compoundVaultFor(manager.address);
  const vaultPayoutToken = await vault.contract.payoutToken();
  const managerPayoutToken = await manager.contract.payoutToken();
  if (pendingDrawManager.toLowerCase() !== manager.address.toLowerCase()) {
    throw new Error(`Pending draw manager mismatch: expected ${manager.address}, got ${pendingDrawManager}`);
  }
  if (configuredCompoundVault.toLowerCase() !== vault.address.toLowerCase()) {
    throw new Error(`Compound vault mismatch: expected ${vault.address}, got ${configuredCompoundVault}`);
  }
  if (vaultPayoutToken.toLowerCase() !== shmon.toLowerCase()) {
    throw new Error("Vault payout token mismatch: expected " + shmon + ", got " + vaultPayoutToken);
  }
  if (managerPayoutToken.toLowerCase() !== shmon.toLowerCase()) {
    throw new Error("Draw manager payout token mismatch: expected " + shmon + ", got " + managerPayoutToken);
  }

  const record = {
    role: "V5 M8 testnet soak",
    status: "deployed-draw-manager-queued",
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
    source: "src/v5",
    deployCommit: process.env.DEPLOY_COMMIT || "record-git-commit",
    addresses: {
      twabController: twab.address,
      shmonStrategy: strategy.address,
      prizeVault: vault.address,
      claimManager: claimManager.address,
      pythRandomnessOracle: oracle.address,
      drawManager: manager.address,
    },
    deployTxs: {
      twabController: twab.tx,
      shmonStrategy: strategy.tx,
      prizeVault: vault.tx,
      claimManager: claimManager.tx,
      pythRandomnessOracle: oracle.tx,
      drawManager: manager.tx,
      ...setupTxs,
    },
    startBlock: Math.min(twab.blockNumber, strategy.blockNumber, vault.blockNumber, claimManager.blockNumber, oracle.blockNumber, manager.blockNumber),
    constructorArgs: {
      shmon,
      entropy,
      entropyProvider,
      guardian,
      keeper,
      firstPeriodStart,
      twabPeriodLength,
      twabPeriodOffset,
      drawPeriod,
      proposerGrace,
      challengeWindow,
      depositCap: depositCap.toString(),
      symbol,
    },
    watcherSecrets: {
      drawManagerAddressSecret: "DRAW_MANAGER_ADDRESS",
      fromBlockSecret: "V5_WATCHER_FROM_BLOCK",
    },
    activation: {
      pendingDrawManager,
      effectiveAt: Number(pendingDrawManagerEffectiveAt),
      effectiveAtIso: new Date(Number(pendingDrawManagerEffectiveAt) * 1000).toISOString(),
      commitCommand:
        "HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit",
    },
  };

  writeDeploymentRecord(record);
  console.log(`Recorded V5 M8 testnet deployment in ${DEPLOYMENT_FILE}`);
  console.log("Operator next steps:");
  console.log(`- Wait until ${record.activation.effectiveAtIso} (${pendingDrawManagerEffectiveAt})`);
  console.log("- Commit: HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit");
  console.log("- Do not re-point keeper, indexer, or frontend until the commit verifies on-chain.");
  console.log(`- After commit, set DRAW_MANAGER_ADDRESS=${manager.address}`);
  console.log(`- After commit, set V5_WATCHER_FROM_BLOCK=${record.startBlock}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
