import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEPOSIT_CAP_MON,
  CHALLENGE_WINDOW_SECONDS,
  MAINNET_CHAIN_ID,
  MIN_DEPOSIT_MON,
  OWNERSHIP_ACCEPTED_STATUS,
  OWNERSHIP_PENDING_STATUS,
  WEEK_SECONDS,
  assertDistinctRoleAddresses,
  assertFixedLaunchParameters,
  deriveWeeklyCadence,
  findLatestOwnershipPendingMainnetV5Record,
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

test("mainnet deploy source enforces the four-contract acceptance lifecycle", () => {
  const source = fs.readFileSync(new URL("./deploy-v5-mainnet.js", import.meta.url), "utf8");
  assert.match(source, /requiredAddress\("FINAL_OWNER"\)/);
  assert.match(source, /assertDistinctRoleAddresses/);
  assert.equal((source.match(/\.transferOwnership\(finalOwner\)/g) || []).length, 4);
  assert.match(source, /--record-ownership/);
  assert.match(source, /TWAB_OWNERSHIP_ACCEPT_TX/);
  assert.match(source, /DRAW_MANAGER_OWNERSHIP_ACCEPT_TX/);
  assert.match(source, /verifyOwnershipState/);
  assert.match(source, /--record-commit/);
  assert.match(source, /DRAW_MANAGER_COMMIT_TX/);
});
test("requires five distinct privileged role addresses", () => {
  const roles = {
    deployer: "0x0000000000000000000000000000000000000001",
    finalOwner: "0x0000000000000000000000000000000000000002",
    guardian: "0x0000000000000000000000000000000000000003",
    keeper: "0x0000000000000000000000000000000000000004",
    pauser: "0x0000000000000000000000000000000000000005",
  };
  assert.equal(assertDistinctRoleAddresses(roles), roles);
  assert.throws(
    () => assertDistinctRoleAddresses({ ...roles, pauser: roles.guardian }),
    /guardian and pauser/,
  );
});

test("ownership acceptance gates the queued mainnet deployment selector", () => {
  const pending = {
    source: "src/v5",
    network: "monad-mainnet",
    status: OWNERSHIP_PENDING_STATUS,
    addresses: { prizeVault: "0x1", drawManager: "0x2" },
  };
  const accepted = {
    ...pending,
    status: OWNERSHIP_ACCEPTED_STATUS,
    addresses: { prizeVault: "0x3", drawManager: "0x4" },
  };
  assert.equal(findLatestOwnershipPendingMainnetV5Record({ contracts: [pending, accepted] }), pending);
  assert.equal(
    findLatestQueuedMainnetV5Record({
      contracts: [
        pending,
        { ...accepted, network: "monad-testnet" },
        { ...accepted, status: "draw-manager-committed" },
        accepted,
      ],
    }),
    accepted,
  );
  assert.throws(
    () => findLatestQueuedMainnetV5Record({ contracts: [pending] }),
    /ownership-accepted-draw-manager-queued/,
  );
});
