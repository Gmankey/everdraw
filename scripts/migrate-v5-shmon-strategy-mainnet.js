import "dotenv/config";
import fs from "node:fs";
import hre from "hardhat";

const { ethers } = hre;

const DEPLOYMENT_FILE = "deployments/monad-mainnet.json";
const MAINNET_CHAIN_ID = 143n;
const APPROVED_SHMON = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c";
const DEPLOY_MODE = process.argv.includes("--deploy");
const VERIFY_MODE = process.argv.includes("--verify");
const NEW_STRATEGY_ADDRESS = process.env.NEW_STRATEGY_ADDRESS;

function sameAddress(a, b) {
  return ethers.getAddress(a) === ethers.getAddress(b);
}

function latestV5Record() {
  const data = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const record = [...data.contracts].reverse().find((entry) =>
    entry.protocolVersion === 5 && entry.network === "monad-mainnet"
  );
  if (!record) throw new Error("No Monad mainnet V5 deployment record found");
  return record;
}

async function requireCode(label, address) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${label} has no code at ${address}`);
  return code;
}

async function snapshot(vault, oldStrategy, shmon, targetAddress) {
  const pending = await vault.pendingStrategy();
  const active = await vault.strategy();
  const shareToken = await oldStrategy.shareToken();
  const oldShares = await shmon.balanceOf(await oldStrategy.getAddress());
  const state = {
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    blockNumber: await ethers.provider.getBlockNumber(),
    vault: await vault.getAddress(),
    owner: await vault.owner(),
    pauser: await vault.pauser(),
    activeStrategy: active,
    pendingStrategy: pending,
    pendingStrategyEffectiveAt: Number(await vault.pendingStrategyEffectiveAt()),
    totalPrincipal: (await vault.totalPrincipal()).toString(),
    totalParticipantPrincipal: (await vault.totalParticipantPrincipal()).toString(),
    totalSponsorPrincipal: (await vault.totalSponsorPrincipal()).toString(),
    totalBoosterPrincipal: (await vault.totalBoosterPrincipal()).toString(),
    shareToken,
    oldStrategyShares: oldShares.toString(),
    oldStrategyAssets: (await oldStrategy.totalAssets()).toString(),
    queueCalldata: targetAddress
      ? vault.interface.encodeFunctionData("queueStrategyChange", [targetAddress])
      : null,
    commitCalldata: vault.interface.encodeFunctionData("commitStrategyChange"),
    cancelCalldata: vault.interface.encodeFunctionData("cancelStrategyChange"),
  };
  return state;
}

async function verifyTarget(targetAddress, vaultAddress) {
  await requireCode("replacement ShmonStrategy", targetAddress);
  const target = await ethers.getContractAt("ShmonStrategy", targetAddress);
  const [shareToken, boundVault] = await Promise.all([target.shareToken(), target.vault()]);
  if (!sameAddress(shareToken, APPROVED_SHMON)) {
    throw new Error(`replacement shareToken mismatch: ${shareToken}`);
  }
  if (!sameAddress(boundVault, vaultAddress)) {
    throw new Error(`replacement vault mismatch: expected ${vaultAddress}, got ${boundVault}`);
  }
  return {
    address: targetAddress,
    shareToken,
    vault: boundVault,
    runtimeCodehash: ethers.keccak256(await ethers.provider.getCode(targetAddress)),
  };
}

async function main() {
  if (DEPLOY_MODE && VERIFY_MODE) throw new Error("Choose only one of --deploy or --verify");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`Expected Monad mainnet chain 143, got ${network.chainId}`);
  }

  const record = latestV5Record();
  const vaultAddress = ethers.getAddress(record.addresses.prizeVault);
  const recordedStrategyAddress = ethers.getAddress(record.addresses.shmonStrategy);
  const recordedShmon = ethers.getAddress(record.constructorArgs.shmon);
  if (!sameAddress(recordedShmon, APPROVED_SHMON)) {
    throw new Error(`Deployment record shMON mismatch: ${recordedShmon}`);
  }

  await Promise.all([
    requireCode("PrizeVaultV5", vaultAddress),
    requireCode("recorded ShmonStrategy", recordedStrategyAddress),
    requireCode("shMON", APPROVED_SHMON),
  ]);

  const vault = await ethers.getContractAt("PrizeVaultV5", vaultAddress);
  const activeStrategyAddress = await vault.strategy();
  if (!sameAddress(activeStrategyAddress, recordedStrategyAddress) && !VERIFY_MODE) {
    throw new Error(
      `Active strategy differs from the deployment record: ${activeStrategyAddress} != ${recordedStrategyAddress}`,
    );
  }

  const oldStrategy = await ethers.getContractAt("ShmonStrategy", recordedStrategyAddress);
  const shmon = new ethers.Contract(
    APPROVED_SHMON,
    ["function balanceOf(address) view returns (uint256)"],
    ethers.provider,
  );

  let targetAddress = NEW_STRATEGY_ADDRESS ? ethers.getAddress(NEW_STRATEGY_ADDRESS) : null;
  let deployment = null;

  if (DEPLOY_MODE) {
    const [signer] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("ShmonStrategy", signer);
    const target = await factory.deploy(APPROVED_SHMON);
    const deployTx = target.deploymentTransaction();
    await target.waitForDeployment();
    targetAddress = await target.getAddress();

    const bindTx = await target.setVault(vaultAddress);
    await bindTx.wait();

    deployment = {
      deployer: signer.address,
      strategy: targetAddress,
      deployTx: deployTx.hash,
      setVaultTx: bindTx.hash,
    };
  }

  if (VERIFY_MODE && !targetAddress) {
    throw new Error("Set NEW_STRATEGY_ADDRESS when using --verify");
  }

  const target = targetAddress ? await verifyTarget(targetAddress, vaultAddress) : null;
  const state = await snapshot(vault, oldStrategy, shmon, targetAddress);

  if (VERIFY_MODE) {
    const targetShares = await shmon.balanceOf(targetAddress);
    const activeIsTarget = sameAddress(state.activeStrategy, targetAddress);
    const pendingIsTarget = sameAddress(state.pendingStrategy, targetAddress);
    if (!activeIsTarget && !pendingIsTarget) {
      throw new Error(
        `Replacement is neither active nor pending: active=${state.activeStrategy} pending=${state.pendingStrategy}`,
      );
    }
    state.targetStrategyShares = targetShares.toString();
    state.activeIsTarget = activeIsTarget;
    state.pendingIsTarget = pendingIsTarget;
    if (activeIsTarget && state.oldStrategyShares !== "0") {
      throw new Error(`Migration committed but old strategy still holds ${state.oldStrategyShares} shares`);
    }
  }

  console.log(JSON.stringify({
    mode: DEPLOY_MODE ? "deploy" : VERIFY_MODE ? "verify" : "plan",
    deployCommit: record.deployCommit,
    deployment,
    target,
    state,
    next:
      DEPLOY_MODE
        ? "Independent review, then queue queueCalldata from the recorded vault owner. Do not commit before pendingStrategyEffectiveAt."
        : "No transactions sent. Use --deploy only after independent approval.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
