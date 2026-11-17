import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { assertKnownEvents } from "./qualify-mainnet-provider.mjs";

const hash = (byte) => "0x" + byte.repeat(64);
const address = "0x0000000000000000000000000000000000000011";

function known(kind, index) {
  return {
    kind,
    txHash: hash(String(index)),
    logIndex: index,
    blockNumber: 100 + index,
    blockHash: hash("a"),
    address,
    topic0: hash("b"),
  };
}

function logFor(event) {
  return {
    transactionHash: event.txHash,
    logIndex: "0x" + event.logIndex.toString(16),
    blockNumber: "0x" + event.blockNumber.toString(16),
    blockHash: event.blockHash,
    address: event.address,
    topics: [event.topic0],
  };
}

test("qualification requires every independently identified nonempty event", () => {
  const events = ["seed", "proposal", "finalization", "mint", "transfer", "burn"].map(known);
  assert.doesNotThrow(() => assertKnownEvents(events.map(logFor), events));
  assert.throws(() => assertKnownEvents(events.slice(1).map(logFor), events), /Known seed event is missing/);
  const altered = events.map(logFor);
  altered[2] = { ...altered[2], blockHash: hash("c") };
  assert.throws(() => assertKnownEvents(altered, events), /block hash mismatch/);
});

test("live qualification is manual, admitted, resumable and reconstructs exact roots", () => {
  const source = fs.readFileSync(new URL("./qualify-mainnet-provider.mjs", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../../.github/workflows/v5-rpc-qualification-mainnet.yml", import.meta.url), "utf8");
  const contracts = fs.readFileSync(new URL("../../.github/workflows/contracts.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /environment: v5-mainnet-rpc-qualification/);
  assert.match(workflow, /RPC_QUALIFY_ADMISSION_FILE/);
  assert.match(workflow, /RPC_QUALIFY_PROVIDER_PERIOD/);
  assert.match(workflow, /actions\/cache\/save/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(contracts, /rpc:qualify:mainnet/);
  assert.match(source, /Full-history log mismatch/);
  assert.match(source, /buildWatcherDrawInput\(\{[\s\S]*provider: candidateProvider/);
  assert.match(source, /buildWatcherDrawInput\(\{[\s\S]*provider: referenceProvider/);
  assert.match(source, /reconstructed root mismatch/);
  assert.match(source, /persistProgress\(\{[\s\S]*completedThroughBlock/);
  assert.match(source, /status: "incomplete"/);
  assert.match(source, /withAdmissionLock/);
});
