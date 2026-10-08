import { ethers } from "ethers";

export const SHMON_STRATEGY_SOURCE = "src/v5/strategies/ShmonStrategy.sol";
export const SHMON_STRATEGY_NAME = "ShmonStrategy";
export const SHMON_STRATEGY_FQN = `${SHMON_STRATEGY_SOURCE}:${SHMON_STRATEGY_NAME}`;

function normalizedBytecode(value) {
  const hex = String(value || "").toLowerCase().replace(/^0x/, "");
  if (!hex || !/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid deployed bytecode");
  }
  return hex;
}

function sameAddress(a, b) {
  return ethers.getAddress(a) === ethers.getAddress(b);
}

function asBigInt(value) {
  return BigInt(value ?? 0);
}

function normalizedHash(value, label) {
  const hash = String(value || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error(`Missing or invalid ${label}`);
  return hash;
}

export function verifyCommittedChainIdentity({
  transaction,
  confirmedTransaction,
  receipt,
  confirmedReceipt,
  before,
  after,
  confirmedBeforeBlock,
  confirmedAfterBlock,
}) {
  const transactionHash = normalizedHash(transaction?.blockHash, "transaction block hash");
  const confirmedTransactionHash = normalizedHash(
    confirmedTransaction?.blockHash,
    "confirmed transaction block hash",
  );
  const receiptHash = normalizedHash(receipt?.blockHash, "receipt block hash");
  const confirmedReceiptHash = normalizedHash(
    confirmedReceipt?.blockHash,
    "confirmed receipt block hash",
  );
  const beforeHash = normalizedHash(before?.blockHash, "pre-commit block hash");
  const afterHash = normalizedHash(after?.blockHash, "commit block hash");
  const afterParentHash = normalizedHash(after?.blockParentHash, "commit parent hash");
  const confirmedBeforeHash = normalizedHash(
    confirmedBeforeBlock?.hash,
    "confirmed pre-commit block hash",
  );
  const confirmedAfterHash = normalizedHash(
    confirmedAfterBlock?.hash,
    "confirmed commit block hash",
  );
  const confirmedAfterParentHash = normalizedHash(
    confirmedAfterBlock?.parentHash,
    "confirmed commit parent hash",
  );

  if (Number(transaction.blockNumber) !== Number(receipt.blockNumber)
      || Number(confirmedTransaction?.blockNumber) !== Number(receipt.blockNumber)
      || Number(receipt.blockNumber) !== Number(after.blockNumber)
      || Number(before.blockNumber) + 1 !== Number(after.blockNumber)) {
    throw new Error("Migration receipt and snapshot block numbers are not consecutive");
  }
  if (transactionHash !== receiptHash || receiptHash !== afterHash || afterParentHash !== beforeHash) {
    throw new Error("Migration receipt/header does not match the before/after snapshot chain");
  }
  if (Number(confirmedReceipt?.blockNumber) !== Number(receipt.blockNumber)
      || confirmedTransactionHash !== transactionHash
      || confirmedReceiptHash !== receiptHash
      || confirmedBeforeHash !== beforeHash
      || confirmedAfterHash !== afterHash
      || confirmedAfterParentHash !== beforeHash) {
    throw new Error("Migration receipt or snapshot headers changed during verification");
  }

  return {
    beforeBlockHash: beforeHash,
    commitBlockHash: afterHash,
    receiptBlockHash: receiptHash,
  };
}

export function materializeShmonStrategyRuntime(deployedBytecode, approvedShmon) {
  const chars = normalizedBytecode(deployedBytecode?.object).split("");
  const immutableGroups = Object.values(deployedBytecode?.immutableReferences || {});
  if (immutableGroups.length !== 1 || immutableGroups[0].length === 0) {
    throw new Error("ShmonStrategy must have exactly one immutable reference group");
  }

  for (const { start, length } of immutableGroups[0]) {
    if (length !== 32) throw new Error(`Unexpected ShmonStrategy immutable length: ${length}`);
    const encoded = ethers.zeroPadValue(ethers.getAddress(approvedShmon), length).slice(2).toLowerCase();
    const from = start * 2;
    const to = (start + length) * 2;
    if (to > chars.length) throw new Error("ShmonStrategy immutable reference is outside runtime bytecode");
    chars.splice(from, length * 2, ...encoded);
  }

  return `0x${chars.join("")}`;
}

export async function loadApprovedStrategyBuild({ artifacts, approvedShmon, worktreeSourceContent }) {
  const buildInfo = await artifacts.getBuildInfo(SHMON_STRATEGY_FQN);
  if (!buildInfo) {
    throw new Error(`Missing build info for ${SHMON_STRATEGY_FQN}; run hardhat compile`);
  }

  const contractOutput =
    buildInfo.output?.contracts?.[SHMON_STRATEGY_SOURCE]?.[SHMON_STRATEGY_NAME];
  if (!contractOutput) throw new Error("Compiled ShmonStrategy output is missing");

  const runtimeCode = materializeShmonStrategyRuntime(
    contractOutput.evm.deployedBytecode,
    approvedShmon,
  );
  const sourceContent = buildInfo.input?.sources?.[SHMON_STRATEGY_SOURCE]?.content;
  if (typeof sourceContent !== "string") throw new Error("Compiled ShmonStrategy source is missing");
  if (typeof worktreeSourceContent !== "string") {
    throw new Error("Current ShmonStrategy source is required for build authentication");
  }

  const sourceHash = ethers.keccak256(ethers.toUtf8Bytes(sourceContent));
  const worktreeSourceHash = ethers.keccak256(ethers.toUtf8Bytes(worktreeSourceContent));
  if (sourceHash !== worktreeSourceHash) {
    throw new Error(
      `Compiled ShmonStrategy source does not match worktree: compiled=${sourceHash} worktree=${worktreeSourceHash}`,
    );
  }

  return {
    fullyQualifiedName: SHMON_STRATEGY_FQN,
    compilerVersion: buildInfo.solcVersion,
    sourceHash,
    settingsHash: ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(buildInfo.input?.settings || {})),
    ),
    runtimeCode,
    runtimeCodehash: ethers.keccak256(runtimeCode),
    immutableShmon: ethers.getAddress(approvedShmon),
  };
}

export function validateApprovedRuntimeCodehash({ actualCodehash, approvedCodehash }) {
  const actual = String(actualCodehash || "").trim().toLowerCase();
  const approved = String(approvedCodehash || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(approved)) {
    throw new Error(
      "Set APPROVED_STRATEGY_RUNTIME_CODEHASH to the independently approved runtime code hash",
    );
  }
  if (!/^0x[0-9a-f]{64}$/.test(actual) || actual !== approved) {
    throw new Error(`Replacement runtime codehash mismatch: approved=${approved} actual=${actual}`);
  }
  return approved;
}

export function validateSourceIdentity({ actualCommit, approvedCommit, dirty }) {
  const actual = String(actualCommit || "").trim().toLowerCase();
  const approved = String(approvedCommit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(approved)) {
    throw new Error("Set APPROVED_REPLACEMENT_COMMIT to the independently approved 40-character commit");
  }
  if (!/^[0-9a-f]{40}$/.test(actual) || actual !== approved) {
    throw new Error(`Replacement build commit mismatch: approved=${approved} actual=${actual || "<missing>"}`);
  }
  if (dirty) throw new Error("Replacement build worktree is dirty");
  return approved;
}

export async function verifyApprovedTarget({
  artifacts,
  provider,
  getContractAt,
  targetAddress,
  vaultAddress,
  approvedShmon,
  worktreeSourceContent,
}) {
  const address = ethers.getAddress(targetAddress);
  const build = await loadApprovedStrategyBuild({
    artifacts,
    approvedShmon,
    worktreeSourceContent,
  });
  const liveCode = await provider.getCode(address);
  if (liveCode === "0x") throw new Error(`replacement ShmonStrategy has no code at ${address}`);
  if (normalizedBytecode(liveCode) !== normalizedBytecode(build.runtimeCode)) {
    throw new Error(
      `replacement runtime mismatch: expected ${build.runtimeCodehash}, got ${ethers.keccak256(liveCode)}`,
    );
  }

  const target = await getContractAt(SHMON_STRATEGY_NAME, address);
  const [shareToken, boundVault] = await Promise.all([target.shareToken(), target.vault()]);
  if (!sameAddress(shareToken, approvedShmon)) {
    throw new Error(`replacement shareToken mismatch: ${shareToken}`);
  }
  if (!sameAddress(boundVault, vaultAddress)) {
    throw new Error(`replacement vault mismatch: expected ${vaultAddress}, got ${boundVault}`);
  }

  return {
    address,
    shareToken: ethers.getAddress(shareToken),
    vault: ethers.getAddress(boundVault),
    runtimeCodehash: ethers.keccak256(liveCode),
    build: {
      fullyQualifiedName: build.fullyQualifiedName,
      compilerVersion: build.compilerVersion,
      sourceHash: build.sourceHash,
      settingsHash: build.settingsHash,
      runtimeCodehash: build.runtimeCodehash,
      immutableShmon: build.immutableShmon,
    },
  };
}

export function verifyPhaseState({ phase, state, targetAddress, oldStrategyAddress }) {
  const target = ethers.getAddress(targetAddress);
  const oldStrategy = ethers.getAddress(oldStrategyAddress);
  const active = ethers.getAddress(state.activeStrategy);
  const pending = ethers.getAddress(state.pendingStrategy);
  const zero = ethers.ZeroAddress;

  if (phase === "prequeue") {
    if (!sameAddress(active, oldStrategy) || !sameAddress(pending, zero)) {
      throw new Error(`Pre-queue state mismatch: active=${active} pending=${pending}`);
    }
    if (asBigInt(state.targetStrategyShares) !== 0n) {
      throw new Error(`Pre-queue replacement has unexpected shMON shares: ${state.targetStrategyShares}`);
    }
    return;
  }

  if (phase === "queued") {
    if (!sameAddress(active, oldStrategy) || !sameAddress(pending, target)) {
      throw new Error(`Queued state mismatch: active=${active} pending=${pending}`);
    }
    if (Number(state.pendingStrategyEffectiveAt) <= 0) {
      throw new Error("Queued replacement has no activation time");
    }
    return;
  }

  throw new Error(`Unsupported snapshot phase: ${phase}`);
}

const CONSERVED_FIELDS = [
  "totalPrincipal",
  "totalParticipantPrincipal",
  "totalSponsorPrincipal",
  "totalBoosterPrincipal",
  "depositCap",
];

export function verifyCommittedSnapshots({
  before,
  after,
  targetAddress,
  oldStrategyAddress,
}) {
  const target = ethers.getAddress(targetAddress);
  const oldStrategy = ethers.getAddress(oldStrategyAddress);
  if (!sameAddress(before.activeStrategy, oldStrategy) || !sameAddress(before.pendingStrategy, target)) {
    throw new Error("Pre-commit snapshot does not show the reviewed queued migration");
  }
  if (!sameAddress(after.activeStrategy, target) || !sameAddress(after.pendingStrategy, ethers.ZeroAddress)) {
    throw new Error("Post-commit snapshot does not show the reviewed replacement as active");
  }

  const oldSharesBefore = asBigInt(before.oldStrategyShares);
  const oldSharesAfter = asBigInt(after.oldStrategyShares);
  const targetSharesBefore = asBigInt(before.targetStrategyShares);
  const targetSharesAfter = asBigInt(after.targetStrategyShares);
  const receivedShares = targetSharesAfter - targetSharesBefore;
  if (oldSharesAfter !== 0n || receivedShares !== oldSharesBefore) {
    throw new Error(
      `Share conservation failed: expected=${oldSharesBefore} received=${receivedShares} oldAfter=${oldSharesAfter}`,
    );
  }

  const oldNativeBefore = asBigInt(before.oldStrategyNative);
  const oldNativeAfter = asBigInt(after.oldStrategyNative);
  const targetNativeBefore = asBigInt(before.targetStrategyNative);
  const targetNativeAfter = asBigInt(after.targetStrategyNative);
  const receivedNative = targetNativeAfter - targetNativeBefore;
  if (oldNativeAfter !== 0n || receivedNative !== oldNativeBefore) {
    throw new Error(
      `Native dust conservation failed: expected=${oldNativeBefore} received=${receivedNative} oldAfter=${oldNativeAfter}`,
    );
  }

  for (const field of CONSERVED_FIELDS) {
    if (String(before[field]) !== String(after[field])) {
      throw new Error(`${field} changed across migration: before=${before[field]} after=${after[field]}`);
    }
  }

  return {
    migratedShares: oldSharesBefore.toString(),
    migratedNativeDust: oldNativeBefore.toString(),
  };
}
