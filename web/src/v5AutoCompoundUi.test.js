import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('V5 winners are informational and cannot initiate browser claimMany', () => {
  assert.doesNotMatch(source, /claimUnclaimedWinnings|verifyV5ClaimManyArgs|claimMany|Claim prize/)
  assert.doesNotMatch(source, /v5-history-winner-button|onClaim=/)
  assert.match(source, /row\.prizeWin \? <span className="v5-history-winner">WINNER<\/span>/)
})