import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import hre from "hardhat";
import {
  loadApprovedStrategyBuild,
  validateApprovedRuntimeCodehash,
  validateSourceIdentity,
  verifyApprovedTarget,
  verifyCommittedSnapshots,
  verifyPhaseState,
} from "./lib/v5-strategy-migration-verifier.mjs";

const { ethers } = hre;

const DEPLOYMENT_FILE = "deployments/monad-mainnet.json";
const MAINNET_CHAIN_ID = 143n;
const APPROVED_SHMON = "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c";
const DEPLOY_MODE = process.argv.includes("--deploy");
const VERIFY_MODE = process.argv.includes("--verify");
const NEW_STRATEGY_ADDRESS = process.env.NEW_STRATEGY_ADDRESS;
const APPROVED_REPLACEMENT_COMMIT = process.env.APPROVED_REPLACEMENT_COMMIT;
const MIGRATION_COMMIT_TX = process.env.MIGRATION_COMMIT_TX;
const APPROVED_STRATEGY_RUNTIME_CODEHASH = process.env.APPROVED_STRATEGY_RUNTIME_CODEHASH;

function argumentValue(name) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const VERIFY_PHASE = argumentValue("--phase");

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

function localSourceIdentity() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain"],
    { encoding: "utf8" },
  ).trim() !== "";
  return { commit, dirty };
}

async function requireCode(label, address, blockTag) {
  const code = await ethers.provider.getCode(address, blockTag);
  if (code === "0x") throw new Error(`${label} has no code at ${address}`);
  return code;
}

async function snapshot({
  vault,
  oldStrategy,
  shmon,
  oldStrategyAddress,
  targetAddress,
  blockTag,
}) {
  const blockNumber = blockTag === undefined
    ? await ethers.provider.getBlockNumber()
    : Number(blockTag);
  const block = await ethers.provider.getBlock(blockNumber);
  if (!block) throw new Error(`Missing block ${blockNumber}`);
  const overrides = { blockTag: blockNumber };

  const [
    pending,
    active,
    owner,
    pauser,
    effectiveAt,
    totalPrincipal,
    totalParticipantPrincipal,
    totalSponsorPrincipal,
    totalBoosterPrincipal,
    depositCap,
    shareToken,
    oldShares,
    oldAssets,
    oldNative,
    targetShares,
    targetNative,
  ] = await Promise.all([
    vault.pendingStrategy(overrides),
    vault.strategy(overrides),
    vault.owner(overrides),
    vault.pauser(overrides),
    vault.pendingStrategyEffectiveAt(overrides),
    vault.totalPrincipal(overrides),
    vault.totalParticipantPrincipal(overrides),
    vault.totalSponsorPrincipal(overrides),
    vault.totalBoosterPrincipal(overrides),
    vault.depositCap(overrides),
    oldStrategy.shareToken(overrides),
    shmon.balanceOf(oldStrategyAddress, overrides),
    oldStrategy.totalAssets(overrides),
    ethers.provider.getBalance(oldStrategyAddress, blockNumber),
    targetAddress ? shmon.balanceOf(targetAddress, overrides) : 0n,
    targetAddress ? ethers.provider.getBalance(targetAddress, blockNumber) : 0n,
  ]);

  return {
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    blockNumber,
    blockHash: block.hash,
    blockTimestamp: Number(block.timestamp),
    vault: await vault.getAddress(),
    owner,
    pauser,
    activeStrategy: active,
    pendingStrategy: pending,
    pendingStrategyEffectiveAt: Number(effectiveAt),
    totalPrincipal: totalPrincipal.toString(),
    totalParticipantPrincipal: totalParticipantPrincipal.toString(),
    totalSponsorPrincipal: totalSponsorPrincipal.toString(),
    totalBoosterPrincipal: totalBoosterPrincipal.toString(),
    depositCap: depositCap.toString(),
    shareToken,
    oldStrategyShares: oldShares.toString(),
    oldStrategyAssets: oldAssets.toString(),
    oldStrategyNative: oldNative.toString(),
    targetStrategyShares: targetShares.toString(),
    targetStrategyNative: targetNative.toString(),
    queueCalldata: targetAddress
      ? vault.interface.encodeFunctionData("queueStrategyChange", [targetAddress])
      : null,
    commitCalldata: vault.interface.encodeFunctionData("commitStrategyChange"),
    cancelCalldata: vault.interface.encodeFunctionData("cancelStrategyChange"),
  };
}

async function committedEvidence({
  txHash,
  vault,
  oldStrategy,
  shmon,
  oldStrategyAddress,
  targetAddress,
}) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(txHash || ""))) {
    throw new Error("Set MIGRATION_COMMIT_TX to the mined commitStrategyChange transaction");
  }
  const [receipt, transaction] = await Promise.all([
    ethers.provider.getTransactionReceipt(txHash),
    ethers.provider.getTransaction(txHash),
  ]);
  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error(`Migration commit transaction is missing or failed: ${txHash}`);
  }
  if (!transaction || !transaction.to || !sameAddress(transaction.to, await vault.getAddress())) {
    throw new Error("Migration commit transaction target is not the recorded vault");
  }
  const expectedSelector = vault.interface.encodeFunctionData("commitStrategyChange").slice(0, 10);
  if (transaction.data.slice(0, 10) !== expectedSelector) {
    throw new Error("Migration commit transaction is not commitStrategyChange()");
  }
  if (receipt.blockNumber < 1) throw new Error("Invalid migration commit block");

  const before = await snapshot({
    vault,
    oldStrategy,
    shmon,
    oldStrategyAddress,
    targetAddress,
    blockTag: receipt.blockNumber - 1,
  });
  const after = await snapshot({
    vault,
    oldStrategy,
    shmon,
    oldStrategyAddress,
    targetAddress,
    blockTag: receipt.blockNumber,
  });
  const conservation = verifyCommittedSnapshots({
    before,
    after,
    targetAddress,
    oldStrategyAddress,
  });
  return {
    transactionHash: receipt.hash,
    transactionIndex: receipt.index,
    before,
    after,
    conservation,
  };
}

async function main() {
  if (DEPLOY_MODE && VERIFY_MODE) throw new Error("Choose only one of --deploy or --verify");
  if (VERIFY_MODE && !["prequeue", "queued", "committed"].includes(VERIFY_PHASE)) {
    throw new Error("Use --verify --phase prequeue|queued|committed");
  }
  if (!VERIFY_MODE && VERIFY_PHASE) throw new Error("--phase is valid only with --verify");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`Expected Monad mainnet chain 143, got ${network.chainId}`);
  }

  const sourceIdentity = localSourceIdentity();
  const worktreeSourceContent = fs.readFileSync(
    "src/v5/strategies/ShmonStrategy.sol",
    "utf8",
  );
  let approvedBuild = null;
  if (DEPLOY_MODE || VERIFY_MODE) {
    validateSourceIdentity({
      actualCommit: sourceIdentity.commit,
      approvedCommit: APPROVED_REPLACEMENT_COMMIT,
      dirty: sourceIdentity.dirty,
    });
    approvedBuild = await loadApprovedStrategyBuild({
      artifacts: hre.artifacts,
      approvedShmon: APPROVED_SHMON,
      worktreeSourceContent,
    });
    validateApprovedRuntimeCodehash({
      actualCodehash: approvedBuild.runtimeCodehash,
      approvedCodehash: APPROVED_STRATEGY_RUNTIME_CODEHASH,
    });
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
  const oldStrategy = await ethers.getContractAt("ShmonStrategy", recordedStrategyAddress);
  const shmon = new ethers.Contract(
    APPROVED_SHMON,
    ["function balanceOf(address) view returns (uint256)"],
    ethers.provider,
  );

  let targetAddress = NEW_STRATEGY_ADDRESS
    ? ethers.getAddress(NEW_STRATEGY_ADDRESS)
    : null;
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
      replacementBuildCommit: sourceIdentity.commit,
      deployer: signer.address,
      strategy: targetAddress,
      deployTx: deployTx.hash,
      setVaultTx: bindTx.hash,
    };
  }

  if ((DEPLOY_MODE || VERIFY_MODE) && !targetAddress) {
    throw new Error("Set NEW_STRATEGY_ADDRESS when verifying an existing replacement");
  }

  const target = targetAddress
    ? await verifyApprovedTarget({
        artifacts: hre.artifacts,
        provider: ethers.provider,
        getContractAt: ethers.getContractAt,
        targetAddress,
        vaultAddress,
        approvedShmon: APPROVED_SHMON,
        worktreeSourceContent,
      })
    : null;

  let state;
  let evidence = null;
  const phase = DEPLOY_MODE ? "prequeue" : VERIFY_MODE ? VERIFY_PHASE : "plan";

  if (phase === "committed") {
    evidence = await committedEvidence({
      txHash: MIGRATION_COMMIT_TX,
      vault,
      oldStrategy,
      shmon,
      oldStrategyAddress: recordedStrategyAddress,
      targetAddress,
    });
    state = evidence.after;
  } else {
    state = await snapshot({
      vault,
      oldStrategy,
      shmon,
      oldStrategyAddress: recordedStrategyAddress,
      targetAddress,
    });
    if (phase === "prequeue" || phase === "queued") {
      verifyPhaseState({
        phase,
        state,
        targetAddress,
        oldStrategyAddress: recordedStrategyAddress,
      });
    }
  }

  console.log(JSON.stringify({
    mode: DEPLOY_MODE ? "deploy" : VERIFY_MODE ? "verify" : "plan",
    phase,
    oldDeploymentCommit: record.deployCommit,
    replacementSource: {
      approvedCommit: APPROVED_REPLACEMENT_COMMIT || null,
      approvedRuntimeCodehash: APPROVED_STRATEGY_RUNTIME_CODEHASH || null,
      actualCommit: sourceIdentity.commit,
      cleanWorktree: !sourceIdentity.dirty,
      authenticatedBuild: approvedBuild
        ? {
            compilerVersion: approvedBuild.compilerVersion,
            sourceHash: approvedBuild.sourceHash,
            settingsHash: approvedBuild.settingsHash,
            runtimeCodehash: approvedBuild.runtimeCodehash,
          }
        : null,
    },
    deployment,
    target,
    state,
    evidence,
    next:
      DEPLOY_MODE
        ? "Save this output. Independently review it, then verify again with --verify --phase prequeue before queueing."
        : phase === "prequeue"
          ? "Queue only the printed queueCalldata from the recorded owner, then run --verify --phase queued."
          : phase === "queued"
            ? "Wait until pendingStrategyEffectiveAt, simulate and decode commitCalldata, then obtain final approval before signing."
            : phase === "committed"
              ? "Repeat this exact transaction-pinned verification through the independent RPC, then prove the live complete exit."
              : "No transactions sent. Use --deploy only after independent approval.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
