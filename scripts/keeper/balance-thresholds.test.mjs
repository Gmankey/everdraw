import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveKeeperBalanceThresholds } from './balance-thresholds.mjs'

test('derives four-draw floor and eight-draw warning from live entropy fee', () => {
  const thresholds = deriveKeeperBalanceThresholds({
    oracleFeeWei: 770_000_000_000_000_000n,
    configuredFloorWei: 3_000_000_000_000_000_000n,
    configuredWarnWei: 6_000_000_000_000_000_000n,
  })

  assert.equal(thresholds.floorWei, 3_180_000_000_000_000_000n)
  assert.equal(thresholds.warnWei, 6_260_000_000_000_000_000n)
})

test('keeps configured minimums when the live entropy fee is lower', () => {
  const thresholds = deriveKeeperBalanceThresholds({
    oracleFeeWei: 10_000_000_000_000_000n,
    configuredFloorWei: 3_000_000_000_000_000_000n,
    configuredWarnWei: 6_000_000_000_000_000_000n,
  })

  assert.equal(thresholds.floorWei, 3_000_000_000_000_000_000n)
  assert.equal(thresholds.warnWei, 6_000_000_000_000_000_000n)
})

test('stale environment values cannot lower the three/six MON runtime minimums', () => {
  const thresholds = deriveKeeperBalanceThresholds({
    oracleFeeWei: 10_000_000_000_000_000n,
    configuredFloorWei: 500_000_000_000_000_000n,
    configuredWarnWei: 750_000_000_000_000_000n,
  })

  assert.equal(thresholds.floorWei, 3_000_000_000_000_000_000n)
  assert.equal(thresholds.warnWei, 6_000_000_000_000_000_000n)
})

test('rejects warning headroom below the hard-floor headroom', () => {
  assert.throws(
    () => deriveKeeperBalanceThresholds({
      oracleFeeWei: 1n,
      configuredFloorWei: 1n,
      configuredWarnWei: 1n,
      floorDraws: 5n,
      warnDraws: 4n,
    }),
    /draw headroom is invalid/,
  )
})
