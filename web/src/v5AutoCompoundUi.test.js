import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')

test('V5 winners are informational and cannot initiate browser claimMany', () => {
  assert.doesNotMatch(source, /claimUnclaimedWinnings|verifyV5ClaimManyArgs|claimMany|Claim prize/)
  assert.doesNotMatch(source, /v5-history-winner-button|onClaim=/)
  assert.match(source, /row\.prizeWin \? <span className="v5-history-winner">WINNER<\/span>/)
})
test('V5 points milestones are attached to earning draw bonus data, not a separate awards list', () => {
  assert.match(source, /Object\.entries\(h\.bonuses_breakdown \|\| \{\}\)/)
  assert.doesNotMatch(source, /points-milestone-awards|milestoneAwards/)
})

test('V5 disclaimer describes deposits rather than buying tickets', () => {
  const v5Source = source.slice(source.indexOf('function EverdrawV5App'), source.indexOf('function App'))
  assert.doesNotMatch(v5Source, /You buy tickets/)
})
test('V5 prize card shows accrued and projected-at-draw amounts', () => {
  assert.match(source, /label="Prize accrued now"/)
  assert.match(source, /On track for/)
  assert.match(source, /projectedPrizeMon/)
})