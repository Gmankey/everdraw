import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPOSIT_CAP_MON,
  CHALLENGE_WINDOW_SECONDS,
  MAINNET_CHAIN_ID,
  MIN_DEPOSIT_MON,
  WEEK_SECONDS,
  assertFixedLaunchParameters,
  deriveWeeklyCadence,
  findLatestQueuedMainnetV5Record,
} from "./lib/v5-mainnet-deploy-config.mjs";

test("locks the approved chain and economic parameters", () => {
  assert.equal(MAINNET_CHAIN_ID, 143n);
  assert.equal(DEPOSIT_CAP_MON, "25000");
  assert.equal(MIN_DEPOSIT_MON, "0");
  assert.equal(CHALLENGE_WINDOW_SECONDS, 28_800);
  assert.deepEqual(assertFixedLaunchParameters({}), {
    depositCap: "25000",
    minDeposit: "0",
  });
  assert.throws(() => assertFixedLaunchParameters({ DEPOSIT_CAP_MON: "50000" }), /must be 25000/);
  assert.throws(() => assertFixedLaunchParameters({ MIN_DEPOSIT_MON: "1" }), /must be 0/);
  assert.throws(() => assertFixedLaunchParameters({ CHALLENGE_WINDOW_SEC: "900" }), /fixed at 28800/);
});

test("derives a weekly launch grid from the launch block", () => {
  const launchTimestamp = 1_800_000_123;
  const cadence = deriveWeeklyCadence(launchTimestamp);
  assert.equal(cadence.twabPeriodLength, WEEK_SECONDS);
  assert.equal(cadence.drawPeriod, WEEK_SECONDS);
  assert.equal(cadence.twabPeriodOffset, launchTimestamp);
  assert.equal(cadence.firstPeriodStart, launchTimestamp);
  assert.equal((cadence.firstPeriodStart - cadence.twabPeriodOffset) % cadence.twabPeriodLength, 0);
});

test("rejects calendar overrides", () => {
  for (const name of [
    "TWAB_PERIOD_LENGTH_SEC",
    "DRAW_PERIOD_SEC",
    "TWAB_PERIOD_OFFSET",
    "FIRST_PERIOD_START",
  ]) {
    assert.throws(() => assertFixedLaunchParameters({ [name]: "123" }), /must not be overridden/);
  }
});

test("selects the latest queued mainnet V5 deployment only", () => {
  const first = {
    source: "src/v5",
    network: "monad-mainnet",
    status: "deployed-draw-manager-queued",
    addresses: { prizeVault: "0x1", drawManager: "0x2" },
  };
  const latest = {
    source: "src/v5",
    network: "monad-mainnet",
    status: "deployed-draw-manager-queued",
    addresses: { prizeVault: "0x3", drawManager: "0x4" },
  };
  assert.equal(
    findLatestQueuedMainnetV5Record({
      contracts: [
        first,
        { ...first, network: "monad-testnet" },
        { ...first, status: "draw-manager-committed" },
        latest,
      ],
    }),
    latest,
  );
  assert.throws(() => findLatestQueuedMainnetV5Record({ contracts: [] }), /No queued/);
});
