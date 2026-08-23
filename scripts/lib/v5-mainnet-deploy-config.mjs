export const MAINNET_CHAIN_ID = 143n;
export const WEEK_SECONDS = 7 * 24 * 60 * 60;
export const DEPOSIT_CAP_MON = "25000";
export const MIN_DEPOSIT_MON = "0";
export const CHALLENGE_WINDOW_SECONDS = 8 * 60 * 60;

export function uintEnv(env, name, fallback) {
  const raw = env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return value;
}

export function deriveWeeklyCadence(launchTimestamp) {
  if (!Number.isSafeInteger(launchTimestamp) || launchTimestamp <= 0) {
    throw new Error(`Invalid launch timestamp: ${launchTimestamp}`);
  }

  // The launch block defines the grid, so launch readiness is not coupled to a calendar slot.
  return {
    twabPeriodLength: WEEK_SECONDS,
    twabPeriodOffset: launchTimestamp,
    drawPeriod: WEEK_SECONDS,
    firstPeriodStart: launchTimestamp,
  };
}

export function assertFixedLaunchParameters(env) {
  const depositCap = env.DEPOSIT_CAP_MON ?? DEPOSIT_CAP_MON;
  if (depositCap !== DEPOSIT_CAP_MON) {
    throw new Error(`DEPOSIT_CAP_MON must be ${DEPOSIT_CAP_MON}, got ${depositCap}`);
  }

  const minDeposit = env.MIN_DEPOSIT_MON ?? MIN_DEPOSIT_MON;
  if (minDeposit !== MIN_DEPOSIT_MON) {
    throw new Error(`MIN_DEPOSIT_MON must be ${MIN_DEPOSIT_MON}, got ${minDeposit}`);
  }

  for (const name of ["TWAB_PERIOD_LENGTH_SEC", "DRAW_PERIOD_SEC", "TWAB_PERIOD_OFFSET", "FIRST_PERIOD_START"]) {
    if (env[name] !== undefined && env[name] !== "") {
      throw new Error(`${name} is derived by the mainnet deploy script and must not be overridden`);
    }
  }
  if (env.CHALLENGE_WINDOW_SEC !== undefined && env.CHALLENGE_WINDOW_SEC !== "") {
    throw new Error(`CHALLENGE_WINDOW_SEC is fixed at ${CHALLENGE_WINDOW_SECONDS} for mainnet and must not be overridden`);
  }


  return { depositCap, minDeposit };
}

export function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function findLatestQueuedMainnetV5Record(data) {
  const records = (data.contracts || []).filter(
    (record) =>
      record.source === "src/v5" &&
      record.network === "monad-mainnet" &&
      record.status === "deployed-draw-manager-queued" &&
      record.addresses?.prizeVault &&
      record.addresses?.drawManager,
  );
  if (!records.length) {
    throw new Error("No queued V5 mainnet deployment record found");
  }
  return records[records.length - 1];
}
