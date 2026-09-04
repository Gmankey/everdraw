// Guard: the frontend's points values must equal the indexer's.
//
// The indexer (scripts/indexer) actually awards these points; the frontend only advertises
// them. They are separate npm packages and cannot import from each other, so the numbers are
// necessarily mirrored -- and mirrors drift. That is not hypothetical: PR #286 rebalanced the
// values per ADR-0049, updated App.jsx, and missed web/src/v5PointsView.js, so the UI showed
// milestone awards 10x larger than what was actually paid out.
//
// Rather than add a build-time dependency between the packages, this test reads the indexer's
// pointsMath.ts as text and compares the numbers. If you change a value in one place, this
// fails and tells you the other.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { BONUS_POINTS, LOSS_STREAK_AWARDS, STREAK_MILESTONE_AWARDS } from './v5PointsView.js'

const here = dirname(fileURLToPath(import.meta.url))
const pointsMathPath = resolve(here, '../../scripts/indexer/src/services/pointsMath.ts')
const source = readFileSync(pointsMathPath, 'utf8')

/** `export const NAME = 12_345;` -> 12345 */
function constant(name) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*([0-9_]+)`))
  assert.ok(match, `could not find ${name} in pointsMath.ts -- has it been renamed?`)
  return Number(match[1].replace(/_/g, ''))
}

/** `export const NAME = new Map<number, number>([ [2, 5_000], ... ])` -> [{key, value}] */
function mapEntries(name) {
  const block = source.match(new RegExp(`export const ${name}[^[]*\\[([\\s\\S]*?)\\]\\s*\\)`))
  assert.ok(block, `could not find ${name} in pointsMath.ts -- has it been renamed?`)
  const entries = [...block[1].matchAll(/\[\s*([0-9_]+)\s*,\s*([0-9_]+)\s*\]/g)]
  assert.ok(entries.length > 0, `parsed no entries from ${name}`)
  return entries.map(([, key, value]) => ({
    key: Number(key.replace(/_/g, '')),
    value: Number(value.replace(/_/g, '')),
  }))
}

// --- flat bonuses ---
assert.equal(BONUS_POINTS.firstDeposit, constant('FIRST_DEPOSIT_POINTS'), 'First Deposit drifted from the indexer')
assert.equal(BONUS_POINTS.win, constant('WIN_POINTS'), 'Win drifted from the indexer')
assert.equal(BONUS_POINTS.prizePatron, constant('PRIZE_PATRON_POINTS'), 'Prize Patron drifted from the indexer')
assert.equal(BONUS_POINTS.comebackKing, constant('COMEBACK_KING_POINTS'), 'Comeback King drifted from the indexer')

// --- streak milestones ---
const indexerMilestones = mapEntries('STREAK_MILESTONE_POINTS')
assert.equal(
  STREAK_MILESTONE_AWARDS.length,
  indexerMilestones.length,
  'the frontend and indexer disagree on how many streak milestones exist',
)
for (const { key, value } of indexerMilestones) {
  const shown = STREAK_MILESTONE_AWARDS.find((award) => award.draws === key)
  assert.ok(shown, `the indexer awards a milestone at ${key} draws that the frontend never shows`)
  assert.equal(shown.points, value, `milestone at ${key} draws drifted: UI shows ${shown.points}, indexer awards ${value}`)
}

// --- loss streaks ---
const indexerLossStreaks = mapEntries('LOSS_STREAK_THRESHOLD_POINTS')
assert.equal(
  LOSS_STREAK_AWARDS.length,
  indexerLossStreaks.length,
  'the frontend and indexer disagree on how many loss-streak thresholds exist',
)
for (const { key, value } of indexerLossStreaks) {
  const shown = LOSS_STREAK_AWARDS.find((award) => award.draws === key)
  assert.ok(shown, `the indexer awards a loss streak at ${key} draws that the frontend never shows`)
  assert.equal(shown.points, value, `loss streak at ${key} draws drifted: UI shows ${shown.points}, indexer awards ${value}`)
}

// --- the ADR-0049 calibration itself ---
// The full one-off stack is sized against a 1,000 MON year of base points (4,392,360) so that
// farming it is not worth more than genuinely participating. If someone changes a constant
// without re-deriving that, this catches it.
const oneOffStack =
  BONUS_POINTS.firstDeposit
  + BONUS_POINTS.prizePatron
  + BONUS_POINTS.comebackKing
  + LOSS_STREAK_AWARDS.reduce((sum, a) => sum + a.points, 0)
  + STREAK_MILESTONE_AWARDS.reduce((sum, a) => sum + a.points, 0)
assert.equal(oneOffStack, 455_000, 'the one-off bonus stack changed -- re-derive the ADR-0049 §3 Sybil calibration')

console.log('v5PointsValues.test.js ok')
