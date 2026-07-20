import assert from 'node:assert/strict'
import test from 'node:test'
import { awardedMilestones, tierName } from './v5PointsView.js'

test('exposes every checkpoint milestone included in the headline total', () => {
  assert.deepEqual(awardedMilestones({ highest_streak_milestone_awarded: 13 }), [
    { week: 2, points: 10_000 },
    { week: 4, points: 50_000 },
    { week: 13, points: 200_000 },
  ])
})

test('normalizes the headline tier colour name', () => {
  assert.equal(tierName({ current_tier: 'Platinum' }), 'platinum')
  assert.equal(tierName(null), 'bronze')
})
