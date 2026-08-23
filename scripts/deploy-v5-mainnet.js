import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import hre from "hardhat";
import {
  MAINNET_CHAIN_ID,
  CHALLENGE_WINDOW_SECONDS,
  WEEK_SECONDS,
  assertFixedLaunchParameters,
  deriveWeeklyCadence,
  findLatestQueuedMainnetV5Record,
  sameAddress,
  uintEnv,
} from "./lib/v5-mainnet-deploy-config.mjs";

const { ethers } = hre;

const DEPLOYMENT_FILE = "deployments/monad-mainnet.json";
const COMMIT_MODE = process.argv.includes("--commit");
const PREFLIGHT_ONLY = process.argv.includes("--preflight-only");

const APPROVED_SHMON = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c";
const APPROVED_ENTROPY = "0xD458261E832415CFd3BAE5E416FdF3230ce6F134";
const APPROVED_ENTROPY_PROVIDER = "0x52DeaA1c84233F7bb8C8A45baeDE41091c616506";

const CONTRACT_SOURCES = {
  EverdrawTwabController: "src/v5/twab/EverdrawTwabController.sol",
  ShmonStrategy: "src/v5/strategies/ShmonStrategy.sol",
  PrizeVaultV5: "src/v5/PrizeVaultV5.sol",
  ClaimManagerV5: "src/v5/ClaimManagerV5.sol",
  PythRandomnessOracle: "src/PythRandomnessOracle.sol",
  DrawManagerV5: "src/v5/DrawManagerV5.sol",
};

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} env var`);
  return value;
}

function requiredAddress(name) {
  const value = required(name);
  if (!ethers.isAddress(value) || sameAddress(value, ethers.ZeroAddress)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return ethers.getAddress(value);
}

function assertApprovedDependency(name, actual, expected) {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${name} must be the reviewed mainnet address ${expected}, got ${actual}`);
  }
}

function readDeploymentFile() {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function writeDeploymentFile(data) {
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2) + "\n");
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function runSourcePreflight() {
  execFileSync("node", ["scripts/deploy-preflight.mjs"], {
    stdio: "inherit",
    env: process.env,
  });
}

function runManifestBytecodeCheck() {
  execFileSync("node", ["scripts/verify-deployed-bytecode.mjs", DEPLOYMENT_FILE], {
    stdio: "inherit",
    env: process.env,
  });
}

async function assertCodeAt(label, address) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${label} has no code at ${address}`);
  return code;
}

async function verifyExternalDependencies(shmon, entropy, entropyProvider) {
  await assertCodeAt("shMON", shmon);
  await assertCodeAt("Pyth Entropy", entropy);

  const shmonProbe = new ethers.Contract(
    shmon,
    [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function previewDeposit(uint256) view returns (uint256)",
      "function previewWithdraw(uint256) view returns (uint256)",
      "function convertToAssets(uint256) view returns (uint256)",
    ],
    ethers.provider,
  );
  const [name, symbol, decimals, previewDeposit, previewWithdraw, convertedAssets] =
    await Promise.all([
      shmonProbe.name(),
      shmonProbe.symbol(),
      shmonProbe.decimals(),
      shmonProbe.previewDeposit(ethers.parseEther("1")),
      shmonProbe.previewWithdraw(ethers.parseEther("1")),
      shmonProbe.convertToAssets(ethers.parseEther("1")),
    ]);
  if (Number(decimals) !== 18 || previewDeposit === 0n || previewWithdraw === 0n || convertedAssets === 0n) {
    throw new Error("shMON ERC-4626 probes returned invalid values");
  }

  const entropyProbe = new ethers.Contract(
    entropy,
    ["function getFee(address provider) view returns (uint128)"],
    ethers.provider,
  );
  const entropyFee = await entropyProbe.getFee(entropyProvider);

  return {
    shmonName: name,
    shmonSymbol: symbol,
    shmonDecimals: Number(decimals),
    shmonPreviewDepositOneMon: previewDeposit.toString(),
    shmonPreviewWithdrawOneMon: previewWithdraw.toString(),
    shmonConvertOneShareToAssets: convertedAssets.toString(),
    entropyFee: entropyFee.toString(),
  };
}

async function preflightNetworkAndSigner() {
  if (hre.network.name !== "monadMainnet") {
    throw new Error("V5 mainnet deploy script requires the monadMainnet Hardhat network");
  }
  if (!process.env.MONAD_MAINNET_RPC_URL) {
    throw new Error("Missing MONAD_MAINNET_RPC_URL; production requires the operator-approved mainnet RPC");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`Wrong chain id: got ${network.chainId}, expected ${MAINNET_CHAIN_ID}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer configured; operator must provide PRIVATE_KEY interactively");
  }
  return deployer;
}

async function deployContract(name, args = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  console.log(`${name} deployment mined: tx=${receipt.hash}`);
  return {
    contract,
    address: await contract.getAddress(),
    tx: receipt.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function send(label, txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${receipt.hash}`);
  return receipt.hash;
}

function zeroImmutableReferences(bytecode, immutableReferences = {}) {
  const chars = bytecode.toLowerCase().replace(/^0x/, "").split("");
  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) {
      chars.fill("0", start * 2, (start + length) * 2);
    }
  }
  return chars.join("");
}

async function verifyRuntimeAgainstArtifact(name, address) {
  const source = CONTRACT_SOURCES[name];
  const fullyQualifiedName = `${source}:${name}`;
  const buildInfo = await hre.artifacts.getBuildInfo(fullyQualifiedName);
  if (!buildInfo) throw new Error(`Missing build info for ${fullyQualifiedName}; run hardhat compile`);

  const deployedOutput = buildInfo.output.contracts[source][name].evm.deployedBytecode;
  const expected = zeroImmutableReferences(deployedOutput.object, deployedOutput.immutableReferences);
  const liveCode = await assertCodeAt(name, address);
  const actual = zeroImmutableReferences(liveCode, deployedOutput.immutableReferences);
  if (actual !== expected) {
    throw new Error(`${name} runtime bytecode does not match the locally compiled artifact`);
  }

  return createHash("sha256").update(Buffer.from(liveCode.slice(2), "hex")).digest("hex");
}

async function verifyWiring({
  shmon,
  entropy,
  entropyProvider,
  guardian,
  keeper,
  pauser,
  cadence,
  twab,
  strategy,
  vault,
  claimManager,
  oracle,
  manager,
  expectActive,
}) {
  const checks = await Promise.all([
    strategy.contract.shareToken(),
    strategy.contract.vault(),
    vault.contract.payoutToken(),
    vault.contract.strategy(),
    vault.contract.twabController(),
    vault.contract.pauser(),
    vault.contract.minDeposit(),
    vault.contract.depositCap(),
    twab.contract.registeredVaults(vault.address),
    twab.contract.periodLength(),
    twab.contract.periodOffset(),
    twab.contract.periodEndOnOrAfter(cadence.firstPeriodStart),
    oracle.contract.entropy(),
    oracle.contract.provider(),
    oracle.contract.consumer(),
    manager.contract.vault(),
    manager.contract.twabController(),
    manager.contract.claimManager(),
    manager.contract.randomnessOracle(),
    manager.contract.payoutToken(),
    manager.contract.guardian(),
    manager.contract.primaryProposer(),
    manager.contract.drawPeriod(),
    manager.contract.nextPeriodStart(),
    claimManager.contract.authorizedSource(manager.address),
    claimManager.contract.compoundVaultFor(manager.address),
    vault.contract.drawManager(),
    vault.contract.pendingDrawManager(),
    vault.contract.pendingDrawManagerEffectiveAt(),
  ]);

  const [
    strategyShareToken,
    strategyVault,
    vaultPayoutToken,
    vaultStrategy,
    vaultTwab,
    configuredPauser,
    minDeposit,
    depositCap,
    vaultRegistered,
    periodLength,
    periodOffset,
    snappedFirstPeriodStart,
    configuredEntropy,
    configuredEntropyProvider,
    oracleConsumer,
    managerVault,
    managerTwab,
    managerClaimManager,
    managerOracle,
    managerPayoutToken,
    configuredGuardian,
    configuredKeeper,
    drawPeriod,
    nextPeriodStart,
    sourceAuthorized,
    compoundVault,
    activeDrawManager,
    pendingDrawManager,
    pendingEffectiveAt,
  ] = checks;

  const addressChecks = [
    ["strategy.shareToken", strategyShareToken, shmon],
    ["strategy.vault", strategyVault, vault.address],
    ["vault.payoutToken", vaultPayoutToken, shmon],
    ["vault.strategy", vaultStrategy, strategy.address],
    ["vault.twabController", vaultTwab, twab.address],
    ["vault.pauser", configuredPauser, pauser],
    ["oracle.entropy", configuredEntropy, entropy],
    ["oracle.provider", configuredEntropyProvider, entropyProvider],
    ["oracle.consumer", oracleConsumer, manager.address],
    ["manager.vault", managerVault, vault.address],
    ["manager.twabController", managerTwab, twab.address],
    ["manager.claimManager", managerClaimManager, claimManager.address],
    ["manager.randomnessOracle", managerOracle, oracle.address],
    ["manager.payoutToken", managerPayoutToken, shmon],
    ["manager.guardian", configuredGuardian, guardian],
    ["manager.primaryProposer", configuredKeeper, keeper],
    ["claimManager.compoundVaultFor", compoundVault, vault.address],
  ];
  for (const [label, actual, expected] of addressChecks) {
    if (!sameAddress(actual, expected)) {
      throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
    }
  }

  if (
    minDeposit !== 0n ||
    depositCap !== ethers.parseEther("25000") ||
    !vaultRegistered ||
    Number(periodLength) !== WEEK_SECONDS ||
    Number(periodOffset) !== cadence.twabPeriodOffset ||
    Number(snappedFirstPeriodStart) !== cadence.firstPeriodStart ||
    Number(drawPeriod) !== WEEK_SECONDS ||
    Number(nextPeriodStart) !== cadence.firstPeriodStart ||
    !sourceAuthorized
  ) {
    throw new Error("V5 mainnet cadence, cap, minimum, registration, or source authorization check failed");
  }

  if (expectActive) {
    if (!sameAddress(activeDrawManager, manager.address) || !sameAddress(pendingDrawManager, ethers.ZeroAddress)) {
      throw new Error("Draw manager is not active after timelock commit");
    }
  } else if (
    !sameAddress(activeDrawManager, ethers.ZeroAddress) ||
    !sameAddress(pendingDrawManager, manager.address) ||
    pendingEffectiveAt === 0n
  ) {
    throw new Error("Draw manager queue state is invalid");
  }

  return { pendingDrawManagerEffectiveAt: Number(pendingEffectiveAt) };
}

function contractComponent(name, deployment, constructorArgs, runtimeBytecodeSha256) {
  return {
    contractName: name,
    source: CONTRACT_SOURCES[name],
    address: deployment.address,
    constructorArgs,
    deployTx: deployment.tx,
    deployBlock: deployment.blockNumber,
    runtimeBytecodeSha256,
    verification: {
      status: "local-runtime-match",
      method: "Live runtime normalized for Solidity immutable references and matched to Hardhat build output",
    },
  };
}

async function deployAndQueue() {
  runSourcePreflight();
  assertFixedLaunchParameters(process.env);
  const deployer = await preflightNetworkAndSigner();

  const head = gitHead();
  const deployCommit = process.env.DEPLOY_COMMIT || head;
  if (deployCommit !== head) {
    throw new Error(`DEPLOY_COMMIT ${deployCommit} does not equal checked-out HEAD ${head}`);
  }

  const shmon = requiredAddress("SHMON");
  const entropy = requiredAddress("ENTROPY");
  const entropyProvider = requiredAddress("ENTROPY_PROVIDER");
  const guardian = requiredAddress("GUARDIAN");
  const keeper = requiredAddress("KEEPER");
  const pauser = requiredAddress("PAUSER");
  assertApprovedDependency("SHMON", shmon, APPROVED_SHMON);
  assertApprovedDependency("ENTROPY", entropy, APPROVED_ENTROPY);
  assertApprovedDependency("ENTROPY_PROVIDER", entropyProvider, APPROVED_ENTROPY_PROVIDER);

  const dependencyEvidence = await verifyExternalDependencies(shmon, entropy, entropyProvider);
  const latest = await ethers.provider.getBlock("latest");
  const cadence = deriveWeeklyCadence(Number(latest.timestamp));
  const proposerGrace = uintEnv(process.env, "PROPOSER_GRACE_PERIOD_SEC", 300);
  const challengeWindow = CHALLENGE_WINDOW_SECONDS;

  const minPrizeThreshold = ethers.parseEther(process.env.MIN_PRIZE_THRESHOLD_SHMON || "0.001");
  const depositCap = ethers.parseEther("25000");
  const symbol = "EVRDRAW-V5-MON";

  console.log("V5 mainnet preflight passed. Deploying six contracts; addresses print only after verification.");
  console.log({
    chainId: MAINNET_CHAIN_ID.toString(),
    deployCommit,
    cadence,
    depositCap: depositCap.toString(),
    minDeposit: "0",
    minPrizeThreshold: minPrizeThreshold.toString(),
    proposerGrace,
    challengeWindow,
    dependencyEvidence,
  });

  if (PREFLIGHT_ONLY) {
    console.log("Preflight-only mode complete; no transactions sent.");
    return;
  }

  const twab = await deployContract("EverdrawTwabController", [
    cadence.twabPeriodLength,
    cadence.twabPeriodOffset,
  ]);
  const strategy = await deployContract("ShmonStrategy", [shmon]);
  const vault = await deployContract("PrizeVaultV5", [
    twab.address,
    strategy.address,
    depositCap,
    symbol,
  ]);
  const claimManager = await deployContract("ClaimManagerV5");

  const nonce = await deployer.getNonce();
  const predictedOracle = ethers.getCreateAddress({ from: deployer.address, nonce });
  const predictedManager = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const oracle = await deployContract("PythRandomnessOracle", [
    entropy,
    entropyProvider,
    predictedManager,
  ]);
  if (!sameAddress(oracle.address, predictedOracle)) {
    throw new Error(`Oracle prediction mismatch: expected ${predictedOracle}, got ${oracle.address}`);
  }

  const manager = await deployContract("DrawManagerV5", [
    vault.address,
    twab.address,
    claimManager.address,
    oracle.address,
    guardian,
    keeper,
    cadence.firstPeriodStart,
    cadence.drawPeriod,
    proposerGrace,
    challengeWindow,
  ]);
  if (!sameAddress(manager.address, predictedManager)) {
    throw new Error(`Draw manager prediction mismatch: expected ${predictedManager}, got ${manager.address}`);
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
    vaultSetPauser: await send("vault.setPauser", vault.contract.setPauser(pauser)),
    managerSetMinPrizeThreshold: await send(
      "drawManager.setMinPrizeThreshold",
      manager.contract.setMinPrizeThreshold(minPrizeThreshold),
    ),
    vaultQueueDrawManagerChange: await send(
      "vault.queueDrawManagerChange",
      vault.contract.queueDrawManagerChange(manager.address),
    ),
  };

  const wiring = await verifyWiring({
    shmon,
    entropy,
    entropyProvider,
    guardian,
    keeper,
    pauser,
    cadence,
    twab,
    strategy,
    vault,
    claimManager,
    oracle,
    manager,
    expectActive: false,
  });
  if ((await manager.contract.minPrizeThreshold()) !== minPrizeThreshold) {
    throw new Error("Draw manager minimum prize threshold mismatch");
  }

  const deployments = [
    ["EverdrawTwabController", twab],
    ["ShmonStrategy", strategy],
    ["PrizeVaultV5", vault],
    ["ClaimManagerV5", claimManager],
    ["PythRandomnessOracle", oracle],
    ["DrawManagerV5", manager],
  ];
  const runtimeHashes = {};
  for (const [name, deployment] of deployments) {
    runtimeHashes[name] = await verifyRuntimeAgainstArtifact(name, deployment.address);
  }

  const startBlock = Math.min(...deployments.map(([, deployment]) => deployment.blockNumber));
  const effectiveAt = wiring.pendingDrawManagerEffectiveAt;
  const addresses = {
    twabController: twab.address,
    shmonStrategy: strategy.address,
    prizeVault: vault.address,
    claimManager: claimManager.address,
    pythRandomnessOracle: oracle.address,
    drawManager: manager.address,
  };
  const record = {
    role: "EverDraw V5 mainnet beta - ADR-0045",
    network: "monad-mainnet",
    chainId: Number(MAINNET_CHAIN_ID),
    status: "deployed-draw-manager-queued",
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
    source: "src/v5",
    deployCommit,
    adrs: ["ADR-0042", "ADR-0043", "ADR-0045"],
    addresses,
    deployTxs: {
      twabController: twab.tx,
      shmonStrategy: strategy.tx,
      prizeVault: vault.tx,
      claimManager: claimManager.tx,
      pythRandomnessOracle: oracle.tx,
      drawManager: manager.tx,
      ...setupTxs,
    },
    startBlock,
    constructorArgs: {
      shmon,
      entropy,
      entropyProvider,
      guardian,
      keeper,
      pauser,
      ...cadence,
      proposerGrace,
      challengeWindow,
      minPrizeThreshold: minPrizeThreshold.toString(),
      depositCap: depositCap.toString(),
      minDeposit: "0",
      symbol,
    },
    externalDependencyEvidence: dependencyEvidence,
    drawManagerTimelock: {
      pendingDrawManager: manager.address,
      effectiveAt,
      effectiveAtIso: new Date(effectiveAt * 1000).toISOString(),
      commitCommand:
        "HARDHAT_NETWORK=monadMainnet node scripts/deploy-v5-mainnet.js --commit",
    },
    keeperSecrets: {
      drawManagerAddressSecret: "DRAW_MANAGER_ADDRESS",
      claimManagerAddressSecret: "CLAIM_MANAGER_ADDRESS",
      fromBlockSecret: "V5_KEEPER_FROM_BLOCK",
      rpcUrlSecret: "RPC_URL",
    },
    components: [
      contractComponent(
        "EverdrawTwabController",
        twab,
        [cadence.twabPeriodLength, cadence.twabPeriodOffset],
        runtimeHashes.EverdrawTwabController,
      ),
      contractComponent("ShmonStrategy", strategy, [shmon], runtimeHashes.ShmonStrategy),
      contractComponent(
        "PrizeVaultV5",
        vault,
        [twab.address, strategy.address, depositCap.toString(), symbol],
        runtimeHashes.PrizeVaultV5,
      ),
      contractComponent("ClaimManagerV5", claimManager, [], runtimeHashes.ClaimManagerV5),
      contractComponent(
        "PythRandomnessOracle",
        oracle,
        [entropy, entropyProvider, manager.address],
        runtimeHashes.PythRandomnessOracle,
      ),
      contractComponent(
        "DrawManagerV5",
        manager,
        [
          vault.address,
          twab.address,
          claimManager.address,
          oracle.address,
          guardian,
          keeper,
          cadence.firstPeriodStart,
          cadence.drawPeriod,
          proposerGrace,
          challengeWindow,
        ],
        runtimeHashes.DrawManagerV5,
      ),
    ],
  };

  const deploymentData = readDeploymentFile();
  deploymentData.contracts = deploymentData.contracts || [];
  deploymentData.contracts.push(record);
  writeDeploymentFile(deploymentData);
  runManifestBytecodeCheck();

  console.log("V5 mainnet deployment verified and recorded:");
  console.log({ ...addresses, startBlock, pendingDrawManagerEffectiveAt: effectiveAt });
  console.log(`Wait until ${record.drawManagerTimelock.effectiveAtIso}, commit the deployment record, then run:`);
  console.log(record.drawManagerTimelock.commitCommand);
  console.log("Do not start the keeper, indexer, frontend, or deposits before commit verification.");
}

async function commitQueuedDrawManager() {
  runSourcePreflight();
  const deployer = await preflightNetworkAndSigner();
  const deploymentData = readDeploymentFile();
  const current = findLatestQueuedMainnetV5Record(deploymentData);
  const {
    prizeVault,
    drawManager,
    claimManager,
    twabController,
    shmonStrategy,
    pythRandomnessOracle,
  } = current.addresses;

  const vault = await ethers.getContractAt("PrizeVaultV5", prizeVault);
  const owner = await vault.owner();
  if (!sameAddress(owner, deployer.address)) {
    throw new Error(`Signer is not the PrizeVaultV5 owner (${owner})`);
  }
  if (sameAddress(await vault.drawManager(), drawManager)) {
    console.log("Draw manager is already committed; no transaction sent.");
    return;
  }
  if (!sameAddress(await vault.pendingDrawManager(), drawManager)) {
    throw new Error("Latest deployment record does not match the vault pending draw manager");
  }

  const effectiveAt = await vault.pendingDrawManagerEffectiveAt();
  const latest = await ethers.provider.getBlock("latest");
  if (BigInt(latest.timestamp) < effectiveAt) {
    throw new Error(
      `Timelock not elapsed: effectiveAt=${effectiveAt} (${new Date(Number(effectiveAt) * 1000).toISOString()})`,
    );
  }

  const commitTx = await send("vault.commitDrawManagerChange", vault.commitDrawManagerChange());
  const strategy = await ethers.getContractAt("ShmonStrategy", shmonStrategy);
  const twab = await ethers.getContractAt("EverdrawTwabController", twabController);
  const claimManagerContract = await ethers.getContractAt("ClaimManagerV5", claimManager);
  const oracle = await ethers.getContractAt("PythRandomnessOracle", pythRandomnessOracle);
  const manager = await ethers.getContractAt("DrawManagerV5", drawManager);

  await verifyWiring({
    shmon: current.constructorArgs.shmon,
    entropy: current.constructorArgs.entropy,
    entropyProvider: current.constructorArgs.entropyProvider,
    guardian: current.constructorArgs.guardian,
    keeper: current.constructorArgs.keeper,
    pauser: current.constructorArgs.pauser,
    cadence: {
      twabPeriodLength: current.constructorArgs.twabPeriodLength,
      twabPeriodOffset: current.constructorArgs.twabPeriodOffset,
      drawPeriod: current.constructorArgs.drawPeriod,
      firstPeriodStart: current.constructorArgs.firstPeriodStart,
    },
    twab: { contract: twab, address: twabController },
    strategy: { contract: strategy, address: shmonStrategy },
    vault: { contract: vault, address: prizeVault },
    claimManager: { contract: claimManagerContract, address: claimManager },
    oracle: { contract: oracle, address: pythRandomnessOracle },
    manager: { contract: manager, address: drawManager },
    expectActive: true,
  });

  deploymentData.contracts.push({
    ...current,
    role: "EverDraw V5 mainnet beta - ADR-0045 draw-manager activation",
    status: "draw-manager-committed",
    committedAt: new Date().toISOString(),
    committedBy: deployer.address,
    deployTxs: { vaultCommitDrawManagerChange: commitTx },
    activationOfDeployCommit: current.deployCommit,
  });
  writeDeploymentFile(deploymentData);
  runManifestBytecodeCheck();

  console.log("V5 mainnet draw manager committed and all wiring re-verified:");
  console.log(current.addresses);
  console.log(`Indexer/keeper start block: ${current.startBlock}`);
}

async function main() {
  if (COMMIT_MODE && PREFLIGHT_ONLY) {
    throw new Error("--commit and --preflight-only are mutually exclusive");
  }
  if (COMMIT_MODE) {
    await commitQueuedDrawManager();
  } else {
    await deployAndQueue();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
