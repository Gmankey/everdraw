import assert from 'node:assert/strict'
import test from 'node:test'
import { v5PageFromHash } from './v5Navigation.js'

test('maps every V5 header destination to a rendered page', () => {
  assert.equal(v5PageFromHash('#stats'), 'stats')
  assert.equal(v5PageFromHash('#leaderboard'), 'leaderboard')
  assert.equal(v5PageFromHash('#profile'), 'profile')
  assert.equal(v5PageFromHash('#patron'), 'degen')
  assert.equal(v5PageFromHash('#vault'), 'vault')
})
