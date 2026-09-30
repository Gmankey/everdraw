#!/usr/bin/env node
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import hre from "hardhat";
import { STRATEGY_FQN, STRATEGY_SOURCE } from "./lib/v5-strategy-replacement-build.mjs";
import {
  selectStrategyMigration,
  verifyV5StrategyReplacement,
} from "./lib/v5-strategy-replacement-verifier.mjs";

const { ethers } = hre;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--deployment-file") args.deploymentFile = argv[++index];
    else if (value === "--strategy-address") args.strategyAddress = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.deploymentFile) throw new Error("Missing --deployment-file");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = String(process.env.MONAD_MAINNET_RPC_URL || "").trim();
  if (!rpcUrl) throw new Error("Missing MONAD_MAINNET_RPC_URL");

  const manifest = JSON.parse(readFileSync(args.deploymentFile, "utf8"));
  const selected = selectStrategyMigration(manifest, args.strategyAddress);
  const sourceCommit = selected.candidate.strategyMigration.sourceCommit;
  const sourceContent = readFileSync(STRATEGY_SOURCE, "utf8");
  const committedSource = execFileSync("git", ["show", `${sourceCommit}:${STRATEGY_SOURCE}`], {
    encoding: "utf8",
  });
  if (committedSource !== sourceContent) {
    throw new Error(
      "Checked-out ShmonStrategy source differs from the recorded replacement source commit",
    );
  }

  await hre.run("compile");
  const artifact = await hre.artifacts.readArtifact(STRATEGY_FQN);
  const buildInfo = await hre.artifacts.getBuildInfo(STRATEGY_FQN);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const result = await verifyV5StrategyReplacement({
    manifest,
    strategyAddress: args.strategyAddress,
    sourceCommit,
    sourceContent,
    artifact,
    buildInfo,
    getChainId: async () => (await provider.getNetwork()).chainId,
    getCode: (address) => provider.getCode(address),
    readWiring: async ({ candidate, component }) => {
      const strategy = new ethers.Contract(component.address, [
        "function shareToken() view returns (address)",
        "function vault() view returns (address)",
        "function nativeMigrationSource() view returns (address)",
        "function owner() view returns (address)",
      ], provider);
      const vault = new ethers.Contract(candidate.addresses.prizeVault, [
        "function strategy() view returns (address)",
        "function pendingStrategy() view returns (address)",
      ], provider);
      const [shareToken, vaultAddress, nativeMigrationSource, owner, activeStrategy, pendingStrategy] =
        await Promise.all([
          strategy.shareToken(),
          strategy.vault(),
          strategy.nativeMigrationSource(),
          strategy.owner(),
          vault.strategy(),
          vault.pendingStrategy(),
        ]);
      return {
        shareToken,
        vault: vaultAddress,
        nativeMigrationSource,
        owner,
        activeStrategy,
        pendingStrategy,
      };
    },
  });

  console.log(JSON.stringify({ status: "verified", ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
