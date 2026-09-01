import assert from 'node:assert/strict'
import test from 'node:test'
import { awardedMilestones, effectiveTrancheMultiplierX100, tierName } from './v5PointsView.js'

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


test('shows the amount-weighted effective multiplier across open tranches', () => {
  const tranches = [
    { pool_type: 'vault', remaining_amount: '900', first_full_weight_draw_id: 1 },
    { pool_type: 'vault', remaining_amount: '100', first_full_weight_draw_id: 26 },
    { pool_type: 'vault', remaining_amount: '0', first_full_weight_draw_id: 1 },
    { pool_type: 'degen', remaining_amount: '500', first_full_weight_draw_id: 1 },
    { pool_type: 'degen', remaining_amount: '500', first_full_weight_draw_id: 26 },
  ]
  assert.equal(effectiveTrancheMultiplierX100(tranches, 'vault', 26), 190)
  assert.equal(effectiveTrancheMultiplierX100(tranches, 'degen', 26), 350)
  assert.equal(effectiveTrancheMultiplierX100([], 'vault', 26), null)
})
