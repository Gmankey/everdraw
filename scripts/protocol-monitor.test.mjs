import test from 'node:test'
import assert from 'node:assert/strict'
import { describeAdminEvent } from './protocol-monitor.js'

function event(name, args) {
  return { fragment: { name }, args }
}

test('formats V5 admin events monitored for ADR-0042 alerts', () => {
  const cases = [
    [
      event('StrategyChangeQueued', { strategy: '0x0000000000000000000000000000000000000001', effectiveAt: 86_400n }),
      'queued strategy change',
    ],
    [
      event('DrawManagerChangeQueued', { drawManager: '0x0000000000000000000000000000000000000002', effectiveAt: 86_400n }),
      'queued draw-manager change',
    ],
    [
      event('OwnershipTransferStarted', {
        previousOwner: '0x0000000000000000000000000000000000000003',
        pendingOwner: '0x0000000000000000000000000000000000000004',
      }),
      'ownership transfer pending',
    ],
    [
      event('OwnershipTransferred', {
        previousOwner: '0x0000000000000000000000000000000000000003',
        newOwner: '0x0000000000000000000000000000000000000004',
      }),
      'ownership accepted',
    ],
    [event('Paused', { by: '0x0000000000000000000000000000000000000005' }), 'vault paused'],
    [event('Unpaused', { by: '0x0000000000000000000000000000000000000005' }), 'vault unpaused'],
    [event('VaultStopped', { stoppedAt: 86_400n }), 'vault stopped'],
    [event('DepositCapUpdated', { depositCap: 1000000000000000000n }), 'deposit cap changed'],
  ]

  for (const [input, expected] of cases) {
    assert.match(describeAdminEvent(input), new RegExp(expected))
  }
})
