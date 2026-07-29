function maxBigInt(...values) {
  return values.reduce((highest, value) => (value > highest ? value : highest), 0n)
}

export function deriveKeeperBalanceThresholds({
  oracleFeeWei,
  configuredFloorWei,
  configuredWarnWei,
  floorDraws = 4n,
  warnDraws = 8n,
  gasBufferWei = 100_000_000_000_000_000n,
  minimumFloorWei = 3_000_000_000_000_000_000n,
  minimumWarnWei = 6_000_000_000_000_000_000n,
}) {
  const fee = BigInt(oracleFeeWei)
  const configuredFloor = BigInt(configuredFloorWei)
  const configuredWarn = BigInt(configuredWarnWei)
  const floorCount = BigInt(floorDraws)
  const warnCount = BigInt(warnDraws)
  const gasBuffer = BigInt(gasBufferWei)
  const minimumFloor = BigInt(minimumFloorWei)
  const minimumWarn = BigInt(minimumWarnWei)

  if (
    fee < 0n || configuredFloor < 0n || configuredWarn < 0n || gasBuffer < 0n
    || minimumFloor < 0n || minimumWarn < minimumFloor
  ) {
    throw new Error('keeper balance threshold inputs must be non-negative')
  }
  if (floorCount <= 0n || warnCount < floorCount) {
    throw new Error('keeper balance draw headroom is invalid')
  }

  const feeDerivedFloor = fee * floorCount + gasBuffer
  const floorWei = maxBigInt(minimumFloor, configuredFloor, feeDerivedFloor)
  const feeDerivedWarn = fee * warnCount + gasBuffer
  const warnWei = maxBigInt(minimumWarn, configuredWarn, feeDerivedWarn, floorWei)

  return { floorWei, warnWei, feeDerivedFloor, feeDerivedWarn }
}
