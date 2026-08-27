import assert from "node:assert/strict";
import test from "node:test";

import { readActiveV5Deployment, resolveV5RuntimeTargets, selectActiveV5Deployment } from "./v5-deployment.mjs";

const addresses = {
  twabController: "0x1111111111111111111111111111111111111111",
  shmonStrategy: "0x2222222222222222222222222222222222222222",
  prizeVault: "0x3333333333333333333333333333333333333333",
  claimManager: "0x4444444444444444444444444444444444444444",
  pythRandomnessOracle: "0x5555555555555555555555555555555555555555",
  drawManager: "0x6666666666666666666666666666666666666666",
};
const ownership = {
  status: "accepted",
  deployer: "0x7777777777777777777777777777777777777777",
  finalOwner: "0x8888888888888888888888888888888888888888",
  acceptTxs: {
    twabController: `0x${"11".repeat(32)}`,
    prizeVault: `0x${"22".repeat(32)}`,
    claimManager: `0x${"33".repeat(32)}`,
    drawManager: `0x${"44".repeat(32)}`,
  },
};

function record(overrides = {}) {
  return {
    role: "EverDraw V5 mainnet beta - ADR-0045 draw-manager activation",
    protocolVersion: 5,
    source: "src/v5",
    deployCommit: "a".repeat(40),
    chainId: 143,
    status: "draw-manager-committed",
    startBlock: 91_500_000,
    addresses,
    ownership,
    ...overrides,
  };
}

test("the recorded UAT activation remains compatible with strict selection", () => {
  const deployment = readActiveV5Deployment("deployments/monad-testnet.json", { expectedChainId: 10143 });
  assert.equal(deployment.status, "draw-manager-committed");
  assert.equal(deployment.source, "src/v5");
  assert.ok(deployment.startBlock > 0);
});

test("representative mainnet activation resolves without relying on its display role", () => {
  const queued = record({ status: "deployed-draw-manager-queued", startBlock: 91_400_000 });
  const active = record();
  const deployment = selectActiveV5Deployment({
    chainId: 143,
    contracts: [{ role: "unrelated" }, queued, active],
  }, { expectedChainId: 143 });

  assert.equal(deployment.startBlock, 91_500_000);
  assert.equal(deployment.addresses.drawManager, addresses.drawManager);
  assert.equal(deployment.ownership.finalOwner, ownership.finalOwner);
  assert.deepEqual(resolveV5RuntimeTargets(deployment, {
    DRAW_MANAGER_ADDRESS: addresses.drawManager,
    CLAIM_MANAGER_ADDRESS: addresses.claimManager,
    V5_KEEPER_FROM_BLOCK: "91500000",
  }), {
    drawManagerAddress: addresses.drawManager,
    claimManagerAddress: addresses.claimManager,
    fromBlock: 91_500_000,
  });
});

test("mainnet activation rejects missing or incomplete ownership evidence", () => {
  assert.throws(
    () => selectActiveV5Deployment({
      chainId: 143,
      contracts: [record({ ownership: undefined })],
    }, { expectedChainId: 143 }),
    /missing accepted final ownership/,
  );
  assert.throws(
    () => selectActiveV5Deployment({
      chainId: 143,
      contracts: [record({ ownership: { ...ownership, acceptTxs: { ...ownership.acceptTxs, prizeVault: undefined } } })],
    }, { expectedChainId: 143 }),
    /ownership acceptance tx prizeVault/,
  );
  assert.throws(
    () => selectActiveV5Deployment({
      chainId: 143,
      contracts: [record({ ownership: { ...ownership, finalOwner: ownership.deployer } })],
    }, { expectedChainId: 143 }),
    /final owner must differ/,
  );
});

test("wrong-chain and incomplete deployment records fail closed", () => {
  assert.throws(
    () => selectActiveV5Deployment({ chainId: 10143, contracts: [record()] }, { expectedChainId: 143 }),
    /does not match expected 143/,
  );
  assert.throws(
    () => selectActiveV5Deployment({
      chainId: 143,
      contracts: [record({ addresses: { ...addresses, claimManager: undefined } })],
    }, { expectedChainId: 143 }),
    /claimManager/,
  );
  assert.throws(
    () => selectActiveV5Deployment({
      chainId: 143,
      contracts: [record({ status: "deployed-draw-manager-queued" })],
    }, { expectedChainId: 143 }),
    /No activated V5 deployment/,
  );
});

test("runtime secrets cannot silently override the activated manifest", () => {
  const deployment = selectActiveV5Deployment({ chainId: 143, contracts: [record()] }, { expectedChainId: 143 });
  assert.throws(
    () => resolveV5RuntimeTargets(deployment, {
      DRAW_MANAGER_ADDRESS: "0x7777777777777777777777777777777777777777",
    }),
    /does not match activated deployment/,
  );
  assert.throws(
    () => resolveV5RuntimeTargets(deployment, {
      V5_KEEPER_FROM_BLOCK: "91499999",
    }),
    /does not match activated deployment/,
  );
});
