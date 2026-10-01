import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  confirmationAllowsDeployment,
  deployStrategyIfConfirmed,
  loadValidatedStrategyBuild,
  STRATEGY_CONTRACT_NAME,
  STRATEGY_FQN,
  STRATEGY_SOURCE,
  validateStrategyBuild,
} from "./lib/v5-strategy-replacement-build.mjs";
import {
  verifyRuntime,
  verifyV5StrategyReplacement,
} from "./lib/v5-strategy-replacement-verifier.mjs";

const COMMIT = "a".repeat(40);
const STACK_COMMIT = "b".repeat(40);
const SOURCE = "contract ShmonStrategy {}";
const ZERO_WORD = "00".repeat(32);
const RUNTIME = "60" + ZERO_WORD + "61" + ZERO_WORD + "62" + ZERO_WORD + "63" + ZERO_WORD + "64";
const IMMUTABLES = {
  "101": [{ start: 1, length: 32 }, { start: 34, length: 32 }],
  "102": [{ start: 67, length: 32 }, { start: 100, length: 32 }],
};

const ADDR = {
  old: "0x0000000000000000000000000000000000000001",
  replacement: "0x0000000000000000000000000000000000000002",
  vault: "0x0000000000000000000000000000000000000003",
  share: "0x0000000000000000000000000000000000000004",
  deployer: "0x0000000000000000000000000000000000000005",
  twab: "0x0000000000000000000000000000000000000006",
  claim: "0x0000000000000000000000000000000000000007",
  oracle: "0x0000000000000000000000000000000000000008",
  draw: "0x0000000000000000000000000000000000000009",
  wrong: "0x0000000000000000000000000000000000000010",
  zero: "0x0000000000000000000000000000000000000000",
};

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function replaceWord(runtime, start, address) {
  const from = start * 2;
  return runtime.slice(0, from) + addressWord(address) + runtime.slice(from + 64);
}

const LIVE_RUNTIME = [
  ...IMMUTABLES["101"].map(({ start }) => [start, ADDR.share]),
  ...IMMUTABLES["102"].map(({ start }) => [start, ADDR.deployer]),
].reduce((runtime, [start, address]) => replaceWord(runtime, start, address), RUNTIME);

const REQUIRED_ABI = [
  "nativeMigrationSource",
  "owner",
  "setNativeMigrationSource",
  "setVault",
  "shareToken",
  "vault",
].map((name) => ({ type: "function", name, inputs: [], outputs: [] }));

function hashRuntime(bytecode) {
  return createHash("sha256")
    .update(Buffer.from(bytecode.replace(/^0x/, ""), "hex"))
    .digest("hex");
}

function artifact() {
  return { abi: structuredClone(REQUIRED_ABI), deployedBytecode: `0x${RUNTIME}` };
}

function buildInfo(source = SOURCE) {
  return {
    solcVersion: "0.8.33",
    solcLongVersion: "0.8.33+commit.64118f21",
    input: {
      sources: { [STRATEGY_SOURCE]: { content: source } },
      settings: {
        evmVersion: "paris",
        viaIR: true,
        optimizer: { enabled: true, runs: 200 },
      },
    },
    output: {
      sources: {
        [STRATEGY_SOURCE]: {
          ast: {
            nodes: [{
              nodeType: "ContractDefinition",
              name: STRATEGY_CONTRACT_NAME,
              nodes: [
                {
                  nodeType: "VariableDeclaration",
                  id: 101,
                  name: "shmonVault",
                  stateVariable: true,
                  mutability: "immutable",
                },
                {
                  nodeType: "VariableDeclaration",
                  id: 102,
                  name: "owner",
                  stateVariable: true,
                  mutability: "immutable",
                },
              ],
            }],
          },
        },
      },
      contracts: {
        [STRATEGY_SOURCE]: {
          [STRATEGY_CONTRACT_NAME]: {
            evm: {
              deployedBytecode: {
                object: RUNTIME,
                immutableReferences: structuredClone(IMMUTABLES),
              },
            },
          },
        },
      },
    },
  };
}

function fixture() {
  const provenance = validateStrategyBuild({
    artifact: artifact(),
    buildInfo: buildInfo(),
    sourceContent: SOURCE,
    sourceCommit: COMMIT,
  });
  const unchanged = {
    contractName: "PrizeVaultV5",
    source: "src/v5/PrizeVaultV5.sol",
    address: ADDR.vault,
    sourceCommit: STACK_COMMIT,
    verification: { status: "local-runtime-match" },
  };
  const previous = {
    protocolVersion: 5,
    source: "src/v5",
    status: "draw-manager-committed",
    deployCommit: STACK_COMMIT,
    startBlock: 10,
    addresses: {
      twabController: ADDR.twab,
      shmonStrategy: ADDR.old,
      prizeVault: ADDR.vault,
      claimManager: ADDR.claim,
      pythRandomnessOracle: ADDR.oracle,
      drawManager: ADDR.draw,
    },
    components: [
      { contractName: STRATEGY_CONTRACT_NAME, address: ADDR.old },
      unchanged,
    ],
  };
  const component = {
    contractName: STRATEGY_CONTRACT_NAME,
    source: STRATEGY_SOURCE,
    sourceCommit: COMMIT,
    sourceSha256: provenance.sourceSha256,
    buildInfoSha256: provenance.buildInfoSha256,
    compiler: provenance.compiler,
    address: ADDR.replacement,
    constructorArgs: [ADDR.share],
    runtimeBytecodeSha256: hashRuntime(LIVE_RUNTIME),
    normalizedRuntimeSha256: provenance.normalizedRuntimeSha256,
    verification: { status: "local-runtime-match" },
  };
  const candidate = {
    ...structuredClone(previous),
    status: "strategy-change-queued",
    addresses: { ...previous.addresses, shmonStrategy: ADDR.replacement },
    components: [component, structuredClone(unchanged)],
    strategyMigration: {
      predecessorStrategy: ADDR.old,
      replacementStrategy: ADDR.replacement,
      sourceCommit: COMMIT,
      deployedBy: ADDR.deployer,
    },
  };
  return {
    manifest: { chainId: 143, contracts: [previous, candidate] },
    provenance,
  };
}

function validInputs(overrides = {}) {
  const { manifest } = fixture();
  return {
    manifest,
    strategyAddress: ADDR.replacement,
    sourceCommit: COMMIT,
    sourceContent: SOURCE,
    artifact: artifact(),
    buildInfo: buildInfo(),
    getChainId: async () => 143n,
    getCode: async () => `0x${LIVE_RUNTIME}`,
    readWiring: async () => ({
      shareToken: ADDR.share,
      vault: ADDR.vault,
      nativeMigrationSource: ADDR.old,
      owner: ADDR.deployer,
      activeStrategy: ADDR.old,
      pendingStrategy: ADDR.replacement,
    }),
    ...overrides,
  };
}

test("validated build compiles before loading artifacts and factory", async () => {
  const calls = [];
  const factory = {};
  const hre = {
    run: async (task) => calls.push(task),
    artifacts: {
      readArtifact: async () => {
        calls.push("artifact");
        return artifact();
      },
      getBuildInfo: async () => {
        calls.push("build-info");
        return buildInfo();
      },
    },
    ethers: {
      getContractFactory: async () => {
        calls.push("factory");
        return factory;
      },
    },
  };
  const result = await loadValidatedStrategyBuild({ hre, sourceContent: SOURCE, sourceCommit: COMMIT });
  assert.equal(result.factory, factory);
  assert.deepEqual(calls, ["compile", "artifact", "build-info", "factory"]);
});

test("validated build rejects absent, old, stale, and Cancun artifacts", async (t) => {
  await t.test("absent artifact", async () => {
    const hre = {
      run: async () => {},
      artifacts: { readArtifact: async () => undefined, getBuildInfo: async () => buildInfo() },
      ethers: { getContractFactory: async () => assert.fail("factory must not load") },
    };
    await assert.rejects(
      loadValidatedStrategyBuild({ hre, sourceContent: SOURCE, sourceCommit: COMMIT }),
      /Missing ShmonStrategy artifact/,
    );
  });
  await t.test("old ABI", () => {
    const old = artifact();
    old.abi = old.abi.filter((entry) => entry.name !== "setNativeMigrationSource");
    assert.throws(
      () => validateStrategyBuild({ artifact: old, buildInfo: buildInfo(), sourceContent: SOURCE, sourceCommit: COMMIT }),
      /missing setNativeMigrationSource/,
    );
  });
  await t.test("stale source", () => {
    assert.throws(
      () => validateStrategyBuild({ artifact: artifact(), buildInfo: buildInfo("old"), sourceContent: SOURCE, sourceCommit: COMMIT }),
      /build input does not match/,
    );
  });
  await t.test("wrong EVM target", () => {
    const info = buildInfo();
    info.input.settings.evmVersion = "cancun";
    assert.throws(
      () => validateStrategyBuild({ artifact: artifact(), buildInfo: info, sourceContent: SOURCE, sourceCommit: COMMIT }),
      /production EVM target/,
    );
  });
  await t.test("unknown immutable declaration ID", () => {
    const info = buildInfo();
    info.output.contracts[STRATEGY_SOURCE][STRATEGY_CONTRACT_NAME]
      .evm.deployedBytecode.immutableReferences["999"] = [{ start: 1, length: 32 }];
    assert.throws(
      () => validateStrategyBuild({ artifact: artifact(), buildInfo: info, sourceContent: SOURCE, sourceCommit: COMMIT }),
      /unknown or unvalidated declaration IDs/,
    );
  });
  await t.test("missing immutable declaration mapping", () => {
    const info = buildInfo();
    delete info.output.contracts[STRATEGY_SOURCE][STRATEGY_CONTRACT_NAME]
      .evm.deployedBytecode.immutableReferences["102"];
    assert.throws(
      () => validateStrategyBuild({ artifact: artifact(), buildInfo: info, sourceContent: SOURCE, sourceCommit: COMMIT }),
      /unknown or unvalidated declaration IDs/,
    );
  });
  await t.test("malformed immutable reference", () => {
    const info = buildInfo();
    info.output.contracts[STRATEGY_SOURCE][STRATEGY_CONTRACT_NAME]
      .evm.deployedBytecode.immutableReferences["101"][0].length = 31;
    assert.throws(
      () => validateStrategyBuild({ artifact: artifact(), buildInfo: info, sourceContent: SOURCE, sourceCommit: COMMIT }),
      /malformed runtime reference/,
    );
  });
  await t.test("unexpected immutable declaration name", () => {
    const info = buildInfo();
    info.output.sources[STRATEGY_SOURCE].ast.nodes[0].nodes[0].name = "unexpected";
    assert.throws(
      () => validateStrategyBuild({ artifact: artifact(), buildInfo: info, sourceContent: SOURCE, sourceCommit: COMMIT }),
      /immutable declarations do not match/,
    );
  });
});

test("confirmation gate is exact and no-confirmation cannot deploy", async () => {
  assert.equal(confirmationAllowsDeployment("DEPLOY V5 STRATEGY REPLACEMENT"), true);
  assert.equal(confirmationAllowsDeployment(undefined), false);
  assert.equal(confirmationAllowsDeployment("deploy v5 strategy replacement"), false);
  let deployCalls = 0;
  const factory = { deploy: async () => { deployCalls += 1; } };
  const result = await deployStrategyIfConfirmed({ confirmation: undefined, factory, shmon: ADDR.share });
  assert.equal(result, null);
  assert.equal(deployCalls, 0);
});

test("valid candidate binds raw runtime, normalized build, provenance, and wiring", async () => {
  const result = await verifyV5StrategyReplacement(validInputs());
  assert.equal(result.strategyAddress, ADDR.replacement);
  assert.equal(result.rawRuntimeSha256, hashRuntime(LIVE_RUNTIME));
  assert.equal(result.normalizedRuntimeSha256, fixture().provenance.normalizedRuntimeSha256);
});

test("actual Paris build rejects mutations at every compiler-declared immutable occurrence", async () => {
  const hre = (await import("hardhat")).default;
  const realArtifact = await hre.artifacts.readArtifact(STRATEGY_FQN);
  const realBuildInfo = await hre.artifacts.getBuildInfo(STRATEGY_FQN);
  const sourceContent = readFileSync(STRATEGY_SOURCE, "utf8");
  const provenance = validateStrategyBuild({
    artifact: realArtifact,
    buildInfo: realBuildInfo,
    sourceContent,
    sourceCommit: COMMIT,
  });
  const expectedImmutableValues = {
    shmonVault: ADDR.share,
    owner: ADDR.deployer,
  };
  let liveRuntime = provenance.deployedOutput.object;
  for (const [name, references] of Object.entries(provenance.immutableReferencesByName)) {
    for (const { start } of references) {
      liveRuntime = replaceWord(liveRuntime, start, expectedImmutableValues[name]);
    }
  }
  const component = {
    runtimeBytecodeSha256: hashRuntime(liveRuntime),
    normalizedRuntimeSha256: provenance.normalizedRuntimeSha256,
  };

  assert.doesNotThrow(() => verifyRuntime({
    component,
    liveCode: "0x" + liveRuntime,
    deployedOutput: provenance.deployedOutput,
    immutableReferencesByName: provenance.immutableReferencesByName,
    expectedImmutableValues,
  }));

  for (const [name, references] of Object.entries(provenance.immutableReferencesByName)) {
    for (const { start } of references) {
      const changed = replaceWord(liveRuntime, start, ADDR.wrong);
      assert.throws(
        () => verifyRuntime({
          component: { ...component, runtimeBytecodeSha256: hashRuntime(changed) },
          liveCode: "0x" + changed,
          deployedOutput: provenance.deployedOutput,
          immutableReferencesByName: provenance.immutableReferencesByName,
          expectedImmutableValues,
        }),
        new RegExp("immutable " + name + " value mismatch at runtime byte " + start),
      );
    }
  }
});

test("verifier rejects wrong or skipped component selection", async (t) => {
  await t.test("wrong address", async () => {
    await assert.rejects(
      verifyV5StrategyReplacement(validInputs({ strategyAddress: ADDR.wrong })),
      /No V5 strategy replacement record selected/,
    );
  });
  await t.test("skipped component", async () => {
    const inputs = validInputs();
    inputs.manifest.contracts[1].components[0].verification.status = "skipped";
    await assert.rejects(verifyV5StrategyReplacement(inputs), /not marked local-runtime-match/);
  });
});

test("verifier rejects absent code, raw hash mismatch, and reviewed-build mismatch", async (t) => {
  await t.test("absent code", async () => {
    await assert.rejects(
      verifyV5StrategyReplacement(validInputs({ getCode: async () => "0x" })),
      /no live bytecode/,
    );
  });
  await t.test("raw hash mismatch", async () => {
    const inputs = validInputs();
    inputs.manifest.contracts[1].components[0].runtimeBytecodeSha256 = "0".repeat(64);
    await assert.rejects(verifyV5StrategyReplacement(inputs), /raw runtime hash mismatch/);
  });
  await t.test("normalized build mismatch", async () => {
    const changed = "ff" + LIVE_RUNTIME.slice(2);
    const inputs = validInputs({ getCode: async () => "0x" + changed });
    inputs.manifest.contracts[1].components[0].runtimeBytecodeSha256 = hashRuntime(changed);
    await assert.rejects(verifyV5StrategyReplacement(inputs), /reviewed build after immutable normalization/);
  });
});

test("verifier rejects every altered shmonVault and owner immutable occurrence", async () => {
  for (const [name, id] of [["shmonVault", "101"], ["owner", "102"]]) {
    for (const { start } of IMMUTABLES[id]) {
      const changed = replaceWord(LIVE_RUNTIME, start, ADDR.wrong);
      const inputs = validInputs({ getCode: async () => "0x" + changed });
      inputs.manifest.contracts[1].components[0].runtimeBytecodeSha256 = hashRuntime(changed);
      await assert.rejects(
        verifyV5StrategyReplacement(inputs),
        new RegExp("immutable " + name + " value mismatch at runtime byte " + start),
      );
    }
  }
});

test("verifier rejects stale provenance and changed historical component provenance", async (t) => {
  await t.test("wrong build provenance", async () => {
    const inputs = validInputs();
    inputs.manifest.contracts[1].components[0].buildInfoSha256 = "0".repeat(64);
    await assert.rejects(verifyV5StrategyReplacement(inputs), /build-info hash mismatch/);
  });
  await t.test("changed unchanged component", async () => {
    const inputs = validInputs();
    inputs.manifest.contracts[1].components[1].sourceCommit = COMMIT;
    await assert.rejects(verifyV5StrategyReplacement(inputs), /changed provenance/);
  });
});

test("verifier fails closed for unavailable RPC, wrong chain, and wrong wiring", async (t) => {
  await t.test("unavailable RPC", async () => {
    await assert.rejects(
      verifyV5StrategyReplacement(validInputs({ getChainId: async () => { throw new Error("offline"); } })),
      /offline/,
    );
  });
  await t.test("wrong chain", async () => {
    await assert.rejects(
      verifyV5StrategyReplacement(validInputs({ getChainId: async () => 101n })),
      /expected 143/,
    );
  });
  await t.test("wrong wiring", async () => {
    const inputs = validInputs();
    inputs.readWiring = async () => ({
      shareToken: ADDR.wrong,
      vault: ADDR.vault,
      nativeMigrationSource: ADDR.old,
      owner: ADDR.deployer,
      activeStrategy: ADDR.old,
      pendingStrategy: ADDR.replacement,
    });
    await assert.rejects(verifyV5StrategyReplacement(inputs), /shareToken wiring mismatch/);
  });
});
