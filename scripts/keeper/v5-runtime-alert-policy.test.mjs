import assert from 'node:assert/strict'
import test from 'node:test'
import { V5RuntimeAlertPolicy } from './v5-runtime-alert-policy.mjs'

test('alerts once when the keeper reports low balance', () => {
  const policy = new V5RuntimeAlertPolicy({ repeatMs: 10_000 })
  assert.equal(policy.observeLine('normal heartbeat', 1_000), null)
  assert.equal(policy.observeLine('[keeper-v5] LOW_BALANCE_WARNING balanceWei=1', 1_000)?.key, 'low-balance')
  assert.equal(policy.observeLine('keeper balance low: balance=1', 2_000), null)
  assert.equal(policy.observeLine('keeper balance low: balance=1', 11_001)?.key, 'low-balance')
})

test('a newly quarantined claim alerts once without failing the dead-man check', () => {
  const policy = new V5RuntimeAlertPolicy({ repeatMs: 10_000 })
  const line = '[keeper-v5] CLAIM_QUARANTINED key=manager:claims:45 drawId=45 error=InvalidProof selector=0x09bde339'
  const event = policy.observeLine(line, 1_000)

  assert.equal(event?.key, 'claim-quarantined:manager:claims:45')
  assert.equal(event?.failureHealthcheck, false)
  assert.equal(policy.observeLine(line, 2_000), null)

  const differentClaim = policy.observeLine(line.replace(':45 ', ':46 ').replace('drawId=45', 'drawId=46'), 2_000)
  assert.equal(differentClaim?.failureHealthcheck, false)
})

test('alerts when repeated non-zero exits become a crash loop', () => {
  const policy = new V5RuntimeAlertPolicy({ crashThreshold: 3, crashWindowMs: 60_000, repeatMs: 300_000 })
  assert.equal(policy.observeExit(1, 1_000), null)
  assert.equal(policy.observeExit(1, 6_000), null)
  assert.equal(policy.observeExit(1, 11_000)?.key, 'crash-loop')
  assert.equal(policy.observeExit(1, 16_000), null)
})

test('a clean exit resets the crash counter', () => {
  const policy = new V5RuntimeAlertPolicy({ crashThreshold: 2 })
  assert.equal(policy.observeExit(1, 1_000), null)
  assert.equal(policy.observeExit(0, 2_000), null)
  assert.equal(policy.observeExit(1, 3_000), null)
})
