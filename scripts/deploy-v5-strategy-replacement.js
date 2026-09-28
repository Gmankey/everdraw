#!/usr/bin/env node
import "dotenv/config";
import { execFileSync } from "node:child_process";
import hre from "hardhat";

const { ethers } = hre;
const MAINNET_CHAIN_ID = 143n;
const CONFIRMATION = "DEPLOY V5 STRATEGY REPLACEMENT";

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
  }, null, 2));

  if (process.env.CONFIRM_STRATEGY_REPLACEMENT !== CONFIRMATION) {
    console.log(`Preflight complete. Set CONFIRM_STRATEGY_REPLACEMENT="${CONFIRMATION}" to deploy and initialize.`);
    return;
  }

  const factory = await ethers.getContractFactory("ShmonStrategy");
  const replacement = await factory.deploy(shmon);
  await replacement.waitForDeployment();
  const deployReceipt = await replacement.deploymentTransaction().wait();
  const replacementAddress = await replacement.getAddress();
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
    deployBlock: deployReceipt.blockNumber,
    transactions: {
      deploy: deployReceipt.hash,
      setVault: setVaultReceipt.hash,
      setNativeMigrationSource: setSourceReceipt.hash,
    },
    next: "Record the candidate, build the replacement manifest, then queue the vault strategy change from the final-owner Ledger.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
