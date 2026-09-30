import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { getAddress, ZeroAddress } from "ethers";

import {
  STRATEGY_CONTRACT_NAME,
  STRATEGY_SOURCE,
  validateStrategyBuild,
} from "./v5-strategy-replacement-build.mjs";

const ACTIVE_STATUS = "draw-manager-committed";
const CANDIDATE_STATUSES = new Set(["strategy-change-queued", ACTIVE_STATUS]);
const UNCHANGED_ADDRESS_KEYS = [
  "twabController",
  "prizeVault",
  "claimManager",
  "pythRandomnessOracle",
  "drawManager",
];

function sameAddress(a, b) {
  return getAddress(a) === getAddress(b);
}

function runtimeSha256(bytecode) {
  return createHash("sha256")
    .update(Buffer.from(String(bytecode).replace(/^0x/, ""), "hex"))
    .digest("hex");
}

export function zeroImmutableReferences(bytecode, immutableReferences = {}) {
  const chars = String(bytecode).toLowerCase().replace(/^0x/, "").split("");
  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) {
      chars.fill("0", start * 2, (start + length) * 2);
    }
  }
  return chars.join("");
}

function isV5(record) {
  return record?.protocolVersion === 5 || record?.source === "src/v5";
}

export function selectStrategyMigration(manifest, strategyAddress) {
  if (Number(manifest?.chainId) !== 143) throw new Error("Strategy replacement manifest must use chain 143");
  const records = manifest.contracts || [];
  const candidateIndex = records.findLastIndex((record) => {
    if (!isV5(record) || !record.strategyMigration || !CANDIDATE_STATUSES.has(record.status)) return false;
    return !strategyAddress || sameAddress(record.addresses?.shmonStrategy, strategyAddress);
  });
  if (candidateIndex < 0) throw new Error("No V5 strategy replacement record selected");

  const candidate = records[candidateIndex];
  const previous = records
    .slice(0, candidateIndex)
    .reverse()
    .find((record) => isV5(record) && record.status === ACTIVE_STATUS);
  if (!previous) throw new Error("No previous active V5 deployment record");

  const matching = (candidate.components || []).filter(
    (component) =>
      component.contractName === STRATEGY_CONTRACT_NAME &&
      sameAddress(component.address, candidate.addresses.shmonStrategy),
  );
  if (matching.length !== 1) throw new Error("Candidate must contain exactly one selected ShmonStrategy component");
  const component = matching[0];
  if (component.verification?.status !== "local-runtime-match") {
    throw new Error("Selected ShmonStrategy component is not marked local-runtime-match");
  }

  return { candidate, component, previous };
}

export function validateMigrationRecord({ candidate, component, previous, sourceCommit, provenance }) {
  if (candidate.deployCommit !== previous.deployCommit) {
    throw new Error("Strategy migration must preserve the original stack deployCommit");
  }
  if (candidate.startBlock !== previous.startBlock) {
    throw new Error("Strategy migration must preserve the original startBlock");
  }
  for (const key of UNCHANGED_ADDRESS_KEYS) {
    if (!sameAddress(candidate.addresses?.[key], previous.addresses?.[key])) {
      throw new Error(`Strategy migration changed unrelated address ${key}`);
    }
  }

  const oldComponents = (previous.components || []).filter(
    (item) => item.contractName !== STRATEGY_CONTRACT_NAME,
  );
  const candidateComponents = (candidate.components || []).filter(
    (item) => item.contractName !== STRATEGY_CONTRACT_NAME,
  );
  if (oldComponents.length !== candidateComponents.length) {
    throw new Error("Strategy migration changed the unchanged component set");
  }
  const candidatesByName = new Map(candidateComponents.map((item) => [item.contractName, item]));
  for (const item of oldComponents) {
    if (!isDeepStrictEqual(item, candidatesByName.get(item.contractName))) {
      throw new Error(`Strategy migration changed provenance for ${item.contractName}`);
    }
  }

  const migration = candidate.strategyMigration;
  if (!sameAddress(migration.predecessorStrategy, previous.addresses.shmonStrategy)) {
    throw new Error("Strategy migration predecessor does not match the previous active strategy");
  }
  if (!sameAddress(migration.replacementStrategy, candidate.addresses.shmonStrategy)) {
    throw new Error("Strategy migration replacement does not match the candidate strategy");
  }
  if (migration.sourceCommit?.toLowerCase() !== sourceCommit.toLowerCase()) {
    throw new Error("Strategy migration source commit does not match the recorded source commit");
  }
  if (component.source !== STRATEGY_SOURCE) throw new Error("Unexpected ShmonStrategy source path");
  if (component.sourceCommit?.toLowerCase() !== sourceCommit.toLowerCase()) {
    throw new Error("ShmonStrategy component source commit does not match the recorded source commit");
  }
  if (component.sourceSha256 !== provenance.sourceSha256) throw new Error("ShmonStrategy source hash mismatch");
  if (component.buildInfoSha256 !== provenance.buildInfoSha256) throw new Error("ShmonStrategy build-info hash mismatch");
  if (component.normalizedRuntimeSha256 !== provenance.normalizedRuntimeSha256) {
    throw new Error("ShmonStrategy normalized build runtime hash mismatch");
  }
  if (!isDeepStrictEqual(component.compiler, provenance.compiler)) {
    throw new Error("ShmonStrategy compiler provenance mismatch");
  }
  if (!Array.isArray(component.constructorArgs) || component.constructorArgs.length !== 1) {
    throw new Error("ShmonStrategy constructor arguments are invalid");
  }
}

export function verifyRuntime({ component, liveCode, deployedOutput }) {
  if (!liveCode || liveCode === "0x") throw new Error("Replacement strategy has no live bytecode");
  const rawRuntimeSha256 = runtimeSha256(liveCode);
  if (rawRuntimeSha256 !== component.runtimeBytecodeSha256) {
    throw new Error(
      `Replacement raw runtime hash mismatch: manifest=${component.runtimeBytecodeSha256} live=${rawRuntimeSha256}`,
    );
  }
  const expected = zeroImmutableReferences(deployedOutput.object, deployedOutput.immutableReferences);
  const actual = zeroImmutableReferences(liveCode, deployedOutput.immutableReferences);
  if (actual !== expected) {
    throw new Error("Replacement runtime does not match the reviewed build after immutable normalization");
  }
  const normalizedRuntimeSha256 = runtimeSha256(actual);
  if (normalizedRuntimeSha256 !== component.normalizedRuntimeSha256) {
    throw new Error("Replacement normalized runtime hash mismatch");
  }
  return { rawRuntimeSha256, normalizedRuntimeSha256 };
}

function validateWiring({ candidate, component, previous, wiring }) {
  const migration = candidate.strategyMigration;
  if (!sameAddress(wiring.shareToken, component.constructorArgs[0])) {
    throw new Error("Replacement shareToken wiring mismatch");
  }
  if (!sameAddress(wiring.vault, candidate.addresses.prizeVault)) {
    throw new Error("Replacement vault wiring mismatch");
  }
  if (!sameAddress(wiring.nativeMigrationSource, migration.predecessorStrategy)) {
    throw new Error("Replacement nativeMigrationSource wiring mismatch");
  }
  if (!sameAddress(wiring.owner, migration.deployedBy)) {
    throw new Error("Replacement owner provenance mismatch");
  }

  const predecessorActive = sameAddress(wiring.activeStrategy, previous.addresses.shmonStrategy);
  const replacementActive = sameAddress(wiring.activeStrategy, component.address);
  const pendingZero = sameAddress(wiring.pendingStrategy, ZeroAddress);
  const replacementPending = sameAddress(wiring.pendingStrategy, component.address);
  if (!(predecessorActive && (pendingZero || replacementPending)) && !(replacementActive && pendingZero)) {
    throw new Error("Vault active/pending strategy state is inconsistent with the migration");
  }
}

export async function verifyV5StrategyReplacement({
  manifest,
  strategyAddress,
  sourceCommit,
  sourceContent,
  artifact,
  buildInfo,
  getChainId,
  getCode,
  readWiring,
}) {
  const selected = selectStrategyMigration(manifest, strategyAddress);
  const provenance = validateStrategyBuild({ artifact, buildInfo, sourceContent, sourceCommit });
  validateMigrationRecord({ ...selected, sourceCommit, provenance });

  const chainId = await getChainId();
  if (BigInt(chainId) !== 143n) throw new Error(`Replacement RPC chain is ${chainId}, expected 143`);
  const liveCode = await getCode(selected.component.address);
  const runtimeEvidence = verifyRuntime({
    component: selected.component,
    liveCode,
    deployedOutput: provenance.deployedOutput,
  });
  const wiring = await readWiring(selected);
  validateWiring({ ...selected, wiring });

  return {
    strategyAddress: getAddress(selected.component.address),
    ...runtimeEvidence,
    sourceCommit: sourceCommit.toLowerCase(),
    sourceSha256: provenance.sourceSha256,
    buildInfoSha256: provenance.buildInfoSha256,
    compiler: provenance.compiler,
  };
}
