import assert from 'node:assert/strict'
import test from 'node:test'
import { connectedWalletWon, latestSettledDraw, participantRowsForDraw } from './v5PreviousDraw.js'

const manager = '0x1111111111111111111111111111111111111111'

test('selects the latest settled draw for the active draw manager', () => {
  const selected = latestSettledDraw([
    { poolAddress: manager, roundId: 8, state: 'settled' },
    { poolAddress: manager, roundId: 9, state: 'open' },
    { poolAddress: '0x2222222222222222222222222222222222222222', roundId: 99, state: 'settled' },
  ], manager)
  assert.equal(selected?.roundId, 8)
})

test('scopes participants and recognizes the connected winner', () => {
  const winner = '0x3333333333333333333333333333333333333333'
  const participants = participantRowsForDraw([
    { poolAddress: manager, wallet: winner },
    { poolAddress: '0x2222222222222222222222222222222222222222', wallet: winner },
  ], manager)
  assert.equal(participants.length, 1)
  assert.equal(connectedWalletWon({ winner }, winner.toUpperCase()), true)
})
