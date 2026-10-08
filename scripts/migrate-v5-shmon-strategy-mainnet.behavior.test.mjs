import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import {
  materializeShmonStrategyRuntime,
  validateApprovedRuntimeCodehash,
  validateSourceIdentity,
  verifyApprovedTarget,
  verifyCommittedSnapshots,
  verifyPhaseState,
} from "./lib/v5-strategy-migration-verifier.mjs";

const SHMON = "0x1000000000000000000000000000000000000001";
const WRONG_SHMON = "0x2000000000000000000000000000000000000002";
const VAULT = "0x3000000000000000000000000000000000000003";
const WRONG_VAULT = "0x4000000000000000000000000000000000000004";
const OLD = "0x5000000000000000000000000000000000000005";
const TARGET = "0x6000000000000000000000000000000000000006";
const COMMIT = "a".repeat(40);
const SOURCE = "contract ShmonStrategy {}";

const deployedBytecode = {
  object: `6000${"00".repeat(32)}6001`,
  immutableReferences: {
    "42": [{ start: 2, length: 32 }],
  },
};

function artifacts() {
  return {
    async getBuildInfo() {
      return {
        solcVersion: "0.8.33",
        input: {
          settings: { optimizer: { enabled: true, runs: 200 } },
          sources: {
            "src/v5/strategies/ShmonStrategy.sol": {
              content: SOURCE,
            },
          },
        },
        output: {
          contracts: {
            "src/v5/strategies/ShmonStrategy.sol": {
              ShmonStrategy: {
                evm: { deployedBytecode },
              },
            },
          },
        },
      };
    },
  };
}

function targetHarness({ runtime, shareToken = SHMON, vault = VAULT }) {
  return {
    artifacts: artifacts(),
    provider: {
      async getCode() {
        return runtime;
      },
    },
    async getContractAt() {
      return {
        async shareToken() {
          return shareToken;
        },
        async vault() {
          return vault;
        },
      };
    },
    targetAddress: TARGET,
    vaultAddress: VAULT,
    approvedShmon: SHMON,
    worktreeSourceContent: SOURCE,
  };
}

function snapshot(overrides = {}) {
  return {
    activeStrategy: OLD,
    pendingStrategy: TARGET,
    pendingStrategyEffectiveAt: 123,
    totalPrincipal: "1000",
    totalParticipantPrincipal: "700",
    totalSponsorPrincipal: "100",
    totalBoosterPrincipal: "200",
    depositCap: "25000",
    oldStrategyShares: "600",
    targetStrategyShares: "25",
    oldStrategyNative: "7",
    targetStrategyNative: "3",
    ...overrides,
  };
}

test("materializes the approved shMON immutable into the compiled runtime", () => {
  const runtime = materializeShmonStrategyRuntime(deployedBytecode, SHMON);
  assert.equal(runtime.slice(6, 70), ethers.zeroPadValue(SHMON, 32).slice(2).toLowerCase());
});

test("accepts only the exact compiled runtime with the approved immutable and vault binding", async () => {
  const runtime = materializeShmonStrategyRuntime(deployedBytecode, SHMON);
  const result = await verifyApprovedTarget(targetHarness({ runtime }));
  assert.equal(result.runtimeCodehash, ethers.keccak256(runtime));
  assert.equal(result.build.immutableShmon, ethers.getAddress(SHMON));
});

test("rejects stale compiled source even when runtime and getters look plausible", async () => {
  const runtime = materializeShmonStrategyRuntime(deployedBytecode, SHMON);
  await assert.rejects(
    verifyApprovedTarget({
      ...targetHarness({ runtime }),
      worktreeSourceContent: "contract ShmonStrategy { function changed() external {} }",
    }),
    /source does not match worktree/,
  );
});

test("requires the independently approved runtime code hash", () => {
  const runtime = materializeShmonStrategyRuntime(deployedBytecode, SHMON);
  const codehash = ethers.keccak256(runtime);
  assert.equal(
    validateApprovedRuntimeCodehash({ actualCodehash: codehash, approvedCodehash: codehash }),
    codehash,
  );
  assert.throws(
    () => validateApprovedRuntimeCodehash({
      actualCodehash: codehash,
      approvedCodehash: `0x${"11".repeat(32)}`,
    }),
    /runtime codehash mismatch/,
  );
});

test("rejects arbitrary or stale runtime even when plausible getters match", async () => {
  await assert.rejects(
    verifyApprovedTarget(targetHarness({ runtime: "0x60006000fd" })),
    /replacement runtime mismatch/,
  );
});

test("rejects runtime compiled with the wrong immutable dependency", async () => {
  const wrongRuntime = materializeShmonStrategyRuntime(deployedBytecode, WRONG_SHMON);
  await assert.rejects(
    verifyApprovedTarget(targetHarness({ runtime: wrongRuntime })),
    /replacement runtime mismatch/,
  );
});

test("rejects the wrong bound vault after exact runtime authentication", async () => {
  const runtime = materializeShmonStrategyRuntime(deployedBytecode, SHMON);
  await assert.rejects(
    verifyApprovedTarget(targetHarness({ runtime, vault: WRONG_VAULT })),
    /replacement vault mismatch/,
  );
});

test("requires the independently approved clean source commit", () => {
  assert.equal(
    validateSourceIdentity({ actualCommit: COMMIT, approvedCommit: COMMIT, dirty: false }),
    COMMIT,
  );
  assert.throws(
    () => validateSourceIdentity({
      actualCommit: "b".repeat(40),
      approvedCommit: COMMIT,
      dirty: false,
    }),
    /build commit mismatch/,
  );
  assert.throws(
    () => validateSourceIdentity({ actualCommit: COMMIT, approvedCommit: COMMIT, dirty: true }),
    /worktree is dirty/,
  );
});

test("prequeue verification accepts a fresh authenticated unqueued target", () => {
  verifyPhaseState({
    phase: "prequeue",
    state: snapshot({
      pendingStrategy: ethers.ZeroAddress,
      targetStrategyShares: "0",
    }),
    targetAddress: TARGET,
    oldStrategyAddress: OLD,
  });
});

test("queued verification requires the exact pending target and activation time", () => {
  verifyPhaseState({
    phase: "queued",
    state: snapshot(),
    targetAddress: TARGET,
    oldStrategyAddress: OLD,
  });
  assert.throws(
    () => verifyPhaseState({
      phase: "queued",
      state: snapshot({ pendingStrategy: WRONG_VAULT }),
      targetAddress: TARGET,
      oldStrategyAddress: OLD,
    }),
    /Queued state mismatch/,
  );
});

test("committed verification proves exact share, native dust, and principal conservation", () => {
  const before = snapshot();
  const after = snapshot({
    activeStrategy: TARGET,
    pendingStrategy: ethers.ZeroAddress,
    pendingStrategyEffectiveAt: 0,
    oldStrategyShares: "0",
    targetStrategyShares: "625",
    oldStrategyNative: "0",
    targetStrategyNative: "10",
  });
  assert.deepEqual(
    verifyCommittedSnapshots({
      before,
      after,
      targetAddress: TARGET,
      oldStrategyAddress: OLD,
    }),
    { migratedShares: "600", migratedNativeDust: "7" },
  );
});

test("committed verification rejects missing shares and changed principal", () => {
  const before = snapshot();
  const baseAfter = snapshot({
    activeStrategy: TARGET,
    pendingStrategy: ethers.ZeroAddress,
    pendingStrategyEffectiveAt: 0,
    oldStrategyShares: "0",
    targetStrategyShares: "625",
    oldStrategyNative: "0",
    targetStrategyNative: "10",
  });
  assert.throws(
    () => verifyCommittedSnapshots({
      before,
      after: { ...baseAfter, targetStrategyShares: "624" },
      targetAddress: TARGET,
      oldStrategyAddress: OLD,
    }),
    /Share conservation failed/,
  );
  assert.throws(
    () => verifyCommittedSnapshots({
      before,
      after: { ...baseAfter, totalBoosterPrincipal: "199" },
      targetAddress: TARGET,
      oldStrategyAddress: OLD,
    }),
    /totalBoosterPrincipal changed/,
  );
});
