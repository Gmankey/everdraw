import { createHash } from "node:crypto";

export const STRATEGY_CONTRACT_NAME = "ShmonStrategy";
export const STRATEGY_SOURCE = "src/v5/strategies/ShmonStrategy.sol";
export const STRATEGY_FQN = `${STRATEGY_SOURCE}:${STRATEGY_CONTRACT_NAME}`;
export const STRATEGY_REPLACEMENT_CONFIRMATION = "DEPLOY V5 STRATEGY REPLACEMENT";

const REQUIRED_FUNCTIONS = [
  "nativeMigrationSource",
  "owner",
  "setNativeMigrationSource",
  "setVault",
  "shareToken",
  "vault",
];

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runtimeSha256(bytecode) {
  return createHash("sha256")
    .update(Buffer.from(String(bytecode).replace(/^0x/, ""), "hex"))
    .digest("hex");
}

function zeroImmutableReferences(bytecode, immutableReferences = {}) {
  const chars = String(bytecode).toLowerCase().replace(/^0x/, "").split("");
  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) {
      chars.fill("0", start * 2, (start + length) * 2);
    }
  }
  return chars.join("");
}

function functionNames(abi = []) {
  return new Set(abi.filter((entry) => entry?.type === "function").map((entry) => entry.name));
}

export function validateStrategyBuild({ artifact, buildInfo, sourceContent, sourceCommit }) {
  if (!artifact) throw new Error("Missing ShmonStrategy artifact after compile");
  if (!buildInfo) throw new Error("Missing ShmonStrategy build info after compile");
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit || "")) throw new Error("Invalid strategy source commit");

  const names = functionNames(artifact.abi);
  for (const name of REQUIRED_FUNCTIONS) {
    if (!names.has(name)) throw new Error(`ShmonStrategy artifact ABI is missing ${name}`);
  }

  const buildSource = buildInfo.input?.sources?.[STRATEGY_SOURCE]?.content;
  if (buildSource !== sourceContent) {
    throw new Error("ShmonStrategy build input does not match the checked-out source");
  }

  const output = buildInfo.output?.contracts?.[STRATEGY_SOURCE]?.[STRATEGY_CONTRACT_NAME];
  if (!output?.evm?.deployedBytecode?.object) {
    throw new Error("ShmonStrategy build output is missing deployed runtime bytecode");
  }
  const artifactRuntime = String(artifact.deployedBytecode || "").replace(/^0x/, "").toLowerCase();
  if (artifactRuntime !== output.evm.deployedBytecode.object.toLowerCase()) {
    throw new Error("ShmonStrategy artifact runtime does not match its build info");
  }

  const settings = buildInfo.input?.settings || {};
  if (buildInfo.solcVersion !== "0.8.33") throw new Error(`Unexpected Solidity version ${buildInfo.solcVersion}`);
  if (settings.evmVersion !== "paris") throw new Error(`Unexpected production EVM target ${settings.evmVersion}`);
  if (settings.viaIR !== true) throw new Error("Production ShmonStrategy build must enable viaIR");
  if (settings.optimizer?.enabled !== true || settings.optimizer?.runs !== 200) {
    throw new Error("Unexpected ShmonStrategy optimizer settings");
  }

  const deployedOutput = output.evm.deployedBytecode;
  const normalizedRuntime = zeroImmutableReferences(
    deployedOutput.object,
    deployedOutput.immutableReferences,
  );
  return {
    sourceCommit: sourceCommit.toLowerCase(),
    sourceSha256: sha256Text(sourceContent),
    buildInfoSha256: sha256Text(JSON.stringify(buildInfo)),
    normalizedRuntimeSha256: runtimeSha256(normalizedRuntime),
    compiler: {
      version: buildInfo.solcVersion,
      longVersion: buildInfo.solcLongVersion,
      evmVersion: settings.evmVersion,
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
    },
    deployedOutput,
  };
}

export async function loadValidatedStrategyBuild({ hre, sourceContent, sourceCommit }) {
  await hre.run("compile");
  const artifact = await hre.artifacts.readArtifact(STRATEGY_FQN);
  const buildInfo = await hre.artifacts.getBuildInfo(STRATEGY_FQN);
  const provenance = validateStrategyBuild({ artifact, buildInfo, sourceContent, sourceCommit });
  const factory = await hre.ethers.getContractFactory(STRATEGY_FQN);
  return { artifact, buildInfo, factory, provenance };
}

export function confirmationAllowsDeployment(value) {
  return value === STRATEGY_REPLACEMENT_CONFIRMATION;
}

export async function deployStrategyIfConfirmed({ confirmation, factory, shmon }) {
  if (!confirmationAllowsDeployment(confirmation)) return null;
  return factory.deploy(shmon);
}
