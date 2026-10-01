#!/usr/bin/env node
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import hre from "hardhat";
import {
  deployStrategyIfConfirmed,
  loadValidatedStrategyBuild,
  STRATEGY_REPLACEMENT_CONFIRMATION,
  STRATEGY_SOURCE,
} from "./lib/v5-strategy-replacement-build.mjs";

const { ethers } = hre;
const MAINNET_CHAIN_ID = 143n;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name} env var`);
  return value;
}

function address(name) {
  return ethers.getAddress(required(name));
}

function sameAddress(a, b) {
  return ethers.getAddress(a) === ethers.getAddress(b);
}

function runtimeSha256(bytecode) {
  return createHash("sha256")
    .update(Buffer.from(bytecode.replace(/^0x/, ""), "hex"))
    .digest("hex");
}

async function send(label, promise) {
  const tx = await promise;
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} failed: ${receipt.hash}`);
  console.log(`${label}: ${receipt.hash}`);
  return receipt;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`Expected Monad mainnet chain 143, got ${network.chainId}`);
  }

  const shmon = address("SHMON_ADDRESS");
  const vaultAddress = address("PRIZE_VAULT_ADDRESS");
  const predecessor = address("CURRENT_STRATEGY_ADDRESS");
  const [deployer] = await ethers.getSigners();
  const deployCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourceContent = readFileSync(STRATEGY_SOURCE, "utf8");
  const { factory, provenance } = await loadValidatedStrategyBuild({
    hre,
    sourceContent,
    sourceCommit: deployCommit,
  });

  const vault = new ethers.Contract(
    vaultAddress,
    ["function strategy() view returns (address)", "function pendingStrategy() view returns (address)"],
    ethers.provider,
  );
  const currentStrategy = await vault.strategy();
  if (!sameAddress(currentStrategy, predecessor)) {
    throw new Error(`Vault strategy ${currentStrategy} does not match CURRENT_STRATEGY_ADDRESS ${predecessor}`);
  }
  if (!sameAddress(await vault.pendingStrategy(), ethers.ZeroAddress)) {
    throw new Error("Vault already has a pending strategy change");
  }

  const predecessorContract = new ethers.Contract(
    predecessor,
    ["function shareToken() view returns (address)", "function vault() view returns (address)"],
    ethers.provider,
  );
  if (!sameAddress(await predecessorContract.shareToken(), shmon)) {
    throw new Error("Current strategy share token does not match SHMON_ADDRESS");
  }
  if (!sameAddress(await predecessorContract.vault(), vaultAddress)) {
    throw new Error("Current strategy vault wiring is invalid");
  }

  console.log(JSON.stringify({
    chainId: network.chainId.toString(),
    deployer: await deployer.getAddress(),
    deployCommit,
    shmon,
    vault: vaultAddress,
    predecessor,
    build: {
      sourceCommit: provenance.sourceCommit,
      sourceSha256: provenance.sourceSha256,
      buildInfoSha256: provenance.buildInfoSha256,
      normalizedRuntimeSha256: provenance.normalizedRuntimeSha256,
      compiler: provenance.compiler,
    },
  }, null, 2));

  const replacement = await deployStrategyIfConfirmed({
    confirmation: process.env.CONFIRM_STRATEGY_REPLACEMENT,
    factory,
    shmon,
  });
  if (!replacement) {
    console.log(
      `Preflight complete. Set CONFIRM_STRATEGY_REPLACEMENT="${STRATEGY_REPLACEMENT_CONFIRMATION}" to deploy and initialize.`,
    );
    return;
  }

  await replacement.waitForDeployment();
  const deployReceipt = await replacement.deploymentTransaction().wait();
  const replacementAddress = await replacement.getAddress();
  const rawRuntimeSha256 = runtimeSha256(await ethers.provider.getCode(replacementAddress));
  console.log(`ShmonStrategy deployed: ${replacementAddress} tx=${deployReceipt.hash}`);

  const setVaultReceipt = await send("strategy.setVault", replacement.setVault(vaultAddress));
  const setSourceReceipt = await send(
    "strategy.setNativeMigrationSource",
    replacement.setNativeMigrationSource(predecessor),
  );

  if (!sameAddress(await replacement.vault(), vaultAddress)) throw new Error("Replacement vault verification failed");
  if (!sameAddress(await replacement.shareToken(), shmon)) throw new Error("Replacement share token verification failed");
  if (!sameAddress(await replacement.nativeMigrationSource(), predecessor)) {
    throw new Error("Replacement migration source verification failed");
  }

  console.log(JSON.stringify({
    replacementStrategy: replacementAddress,
    deployCommit,
    sourceSha256: provenance.sourceSha256,
    buildInfoSha256: provenance.buildInfoSha256,
    runtimeBytecodeSha256: rawRuntimeSha256,
    normalizedRuntimeSha256: provenance.normalizedRuntimeSha256,
    compiler: provenance.compiler,
    deployBlock: deployReceipt.blockNumber,
    transactions: {
      deploy: deployReceipt.hash,
      setVault: setVaultReceipt.hash,
      setNativeMigrationSource: setSourceReceipt.hash,
    },
    next: "Record the candidate, verify it with check:v5-strategy-replacement, then queue the vault strategy change from the final-owner Ledger.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
