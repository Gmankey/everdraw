import "dotenv/config";
import fs from "node:fs";
import hre from "hardhat";

// Resumes setup after deployment when an RPC disconnect interrupts wiring.
// It never deploys contracts and refuses mismatched ownership, wiring,
// addresses, or deployment receipts.

const { ethers } = hre;
const DEPLOYMENT_FILE = "deployments/monad-testnet.json";
const TESTNET_CHAIN_ID = 10143n;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} env var`);
  return value;
}

async function read(label, operation, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.warn(`${label} read failed (${attempt}/${attempts}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function send(label, operation) {
  const tx = await operation();
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash}`);
  return receipt.hash;
}

function sameAddress(actual, expected) {
  return actual.toLowerCase() === expected.toLowerCase();
}

async function requireCode(label, address) {
  const code = await read(`${label}.code`, () => ethers.provider.getCode(address));
  if (code === "0x") throw new Error(`${label} has no bytecode: ${address}`);
}

async function main() {
  if (hre.network.name !== "monadTestnet") throw new Error("Recovery script is testnet-only");
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== TESTNET_CHAIN_ID) throw new Error(`Wrong chain id: ${network.chainId}`);

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No signer configured; operator must run with PRIVATE_KEY");

  const addresses = {
    twabController: ethers.getAddress(required("TWAB_CONTROLLER_ADDRESS")),
    shmonStrategy: ethers.getAddress(required("SHMON_STRATEGY_ADDRESS")),
    prizeVault: ethers.getAddress(required("PRIZE_VAULT_ADDRESS")),
    claimManager: ethers.getAddress(required("CLAIM_MANAGER_ADDRESS")),
    pythRandomnessOracle: ethers.getAddress(required("PYTH_ORACLE_ADDRESS")),
    drawManager: ethers.getAddress(required("DRAW_MANAGER_ADDRESS")),
  };
  const deployTxs = {
    twabController: required("TWAB_DEPLOY_TX"),
    shmonStrategy: required("STRATEGY_DEPLOY_TX"),
    prizeVault: required("VAULT_DEPLOY_TX"),
    claimManager: required("CLAIM_MANAGER_DEPLOY_TX"),
    pythRandomnessOracle: required("ORACLE_DEPLOY_TX"),
    drawManager: required("DRAW_MANAGER_DEPLOY_TX"),
    strategySetVault: required("STRATEGY_SET_VAULT_TX"),
    twabRegisterVault: required("TWAB_REGISTER_VAULT_TX"),
  };

  await Promise.all(Object.entries(addresses).map(([label, address]) => requireCode(label, address)));
  const vault = await ethers.getContractAt("PrizeVaultV5", addresses.prizeVault, signer);
  const strategy = await ethers.getContractAt("ShmonStrategy", addresses.shmonStrategy, signer);
  const twab = await ethers.getContractAt("EverdrawTwabController", addresses.twabController, signer);
  const claimManager = await ethers.getContractAt("ClaimManagerV5", addresses.claimManager, signer);
  const oracle = await ethers.getContractAt("PythRandomnessOracle", addresses.pythRandomnessOracle, signer);
  const manager = await ethers.getContractAt("DrawManagerV5", addresses.drawManager, signer);

  const wiring = await read("immutable wiring", () => Promise.all([
    vault.owner(),
    claimManager.owner(),
    vault.strategy(),
    vault.twabController(),
    strategy.vault(),
    twab.registeredVaults(addresses.prizeVault),
    manager.vault(),
    manager.twabController(),
    manager.claimManager(),
    manager.randomnessOracle(),
    oracle.consumer(),
  ]));
  const checks = [
    ["vault owner", wiring[0], signer.address],
    ["claim manager owner", wiring[1], signer.address],
    ["vault strategy", wiring[2], addresses.shmonStrategy],
    ["vault TWAB", wiring[3], addresses.twabController],
    ["strategy vault", wiring[4], addresses.prizeVault],
    ["manager vault", wiring[6], addresses.prizeVault],
    ["manager TWAB", wiring[7], addresses.twabController],
    ["manager claim manager", wiring[8], addresses.claimManager],
    ["manager oracle", wiring[9], addresses.pythRandomnessOracle],
    ["oracle consumer", wiring[10], addresses.drawManager],
  ];
  for (const [label, actual, expected] of checks) {
    if (!sameAddress(actual, expected)) throw new Error(`${label} mismatch: ${actual} != ${expected}`);
  }
  if (!wiring[5]) throw new Error("TWAB vault registration is missing");

  if (!(await read("authorizedSource", () => claimManager.authorizedSource(addresses.drawManager)))) {
    deployTxs.claimAuthorizeManager = await send(
      "claimManager.setAuthorizedSource",
      () => claimManager.setAuthorizedSource(addresses.drawManager, true),
    );
  }
  const compoundVault = await read("compoundVaultFor", () => claimManager.compoundVaultFor(addresses.drawManager));
  if (compoundVault === ethers.ZeroAddress) {
    deployTxs.claimSetCompoundVault = await send(
      "claimManager.setCompoundVault",
      () => claimManager.setCompoundVault(addresses.drawManager, addresses.prizeVault),
    );
  } else if (!sameAddress(compoundVault, addresses.prizeVault)) {
    throw new Error(`Unexpected compound vault: ${compoundVault}`);
  }

  const activeDrawManager = await read("drawManager", () => vault.drawManager());
  let pendingDrawManager = await read("pendingDrawManager", () => vault.pendingDrawManager());
  if (activeDrawManager === ethers.ZeroAddress && pendingDrawManager === ethers.ZeroAddress) {
    deployTxs.vaultQueueDrawManagerChange = await send(
      "vault.queueDrawManagerChange",
      () => vault.queueDrawManagerChange(addresses.drawManager),
    );
    pendingDrawManager = addresses.drawManager;
  } else if (!sameAddress(activeDrawManager, addresses.drawManager)
    && !sameAddress(pendingDrawManager, addresses.drawManager)) {
    throw new Error(`Unexpected manager: active=${activeDrawManager} pending=${pendingDrawManager}`);
  }

  const pauser = ethers.getAddress(required("PAUSER"));
  const configuredPauser = await read("pauser", () => vault.pauser());
  if (!sameAddress(configuredPauser, pauser)) {
    deployTxs.vaultSetPauser = await send("vault.setPauser", () => vault.setPauser(pauser));
  }

  const deploymentEntries = [
    ["twabController", deployTxs.twabController],
    ["shmonStrategy", deployTxs.shmonStrategy],
    ["prizeVault", deployTxs.prizeVault],
    ["claimManager", deployTxs.claimManager],
    ["pythRandomnessOracle", deployTxs.pythRandomnessOracle],
    ["drawManager", deployTxs.drawManager],
  ];
  const deploymentReceipts = await Promise.all(deploymentEntries.map(async ([label, hash]) => {
    const receipt = await read(`receipt ${hash}`, () => ethers.provider.getTransactionReceipt(hash));
    if (!receipt) throw new Error(`Missing deployment receipt: ${hash}`);
    if (receipt.status !== 1) throw new Error(`Deployment transaction reverted: ${hash}`);
    if (!receipt.contractAddress || !sameAddress(receipt.contractAddress, addresses[label])) {
      throw new Error(`${label} receipt created ${receipt.contractAddress}; expected ${addresses[label]}`);
    }
    return receipt;
  }));
  const startBlock = Math.min(...deploymentReceipts.map((receipt) => receipt.blockNumber));
  const startBlockData = await read("start block", () => ethers.provider.getBlock(startBlock));
  if (!startBlockData) throw new Error(`Missing deployment start block: ${startBlock}`);
  const pendingDrawManagerEffectiveAt = await read(
    "pendingDrawManagerEffectiveAt",
    () => vault.pendingDrawManagerEffectiveAt(),
  );
  const shmon = await read("payoutToken", () => vault.payoutToken());
  if (!sameAddress(await read("manager payoutToken", () => manager.payoutToken()), shmon)) {
    throw new Error("Vault and manager payout token mismatch");
  }

  const data = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  data.contracts ||= [];
  if (data.contracts.some((item) => sameAddress(item.addresses?.prizeVault || ethers.ZeroAddress, addresses.prizeVault))) {
    throw new Error(`Deployment record already exists for vault ${addresses.prizeVault}`);
  }
  const record = {
    role: "V5 external-audit final UAT",
    status: "deployed-draw-manager-queued",
    deployedAt: new Date(Number(startBlockData.timestamp) * 1000).toISOString(),
    recordedAt: new Date().toISOString(),
    deployedBy: signer.address,
    source: "src/v5",
    deployCommit: required("DEPLOY_COMMIT"),
    addresses,
    deployTxs,
    startBlock,
    constructorArgs: {
      shmon,
      entropy: await read("entropy", () => oracle.entropy()),
      entropyProvider: await read("provider", () => oracle.provider()),
      guardian: await read("guardian", () => manager.guardian()),
      keeper: await read("primaryProposer", () => manager.primaryProposer()),
      firstPeriodStart: Number(await read("nextPeriodStart", () => manager.nextPeriodStart())),
      twabPeriodLength: Number(await read("periodLength", () => twab.periodLength())),
      twabPeriodOffset: Number(await read("periodOffset", () => twab.periodOffset())),
      drawPeriod: Number(await read("drawPeriod", () => manager.drawPeriod())),
      proposerGrace: Number(await read("proposerGracePeriod", () => manager.proposerGracePeriod())),
      challengeWindow: Number(await read("challengeWindow", () => manager.challengeWindow())),
      depositCap: (await read("depositCap", () => vault.depositCap())).toString(),
      symbol: await read("symbol", () => vault.symbol()),
    },
    watcherSecrets: {
      drawManagerAddressSecret: "DRAW_MANAGER_ADDRESS",
      fromBlockSecret: "V5_WATCHER_FROM_BLOCK",
    },
    activation: {
      pendingDrawManager: addresses.drawManager,
      effectiveAt: Number(pendingDrawManagerEffectiveAt),
      effectiveAtIso: new Date(Number(pendingDrawManagerEffectiveAt) * 1000).toISOString(),
      commitCommand: "HARDHAT_NETWORK=monadTestnet node scripts/redeploy-v5-claim-draw-managers.js --commit",
    },
  };
  data.contracts.push(record);
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2) + "\n");

  console.log(JSON.stringify(record, null, 2));
  console.log(`Wait until ${record.activation.effectiveAtIso}, then run the recorded commit command.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
