import assert from 'node:assert/strict'
import test from 'node:test'
import { effectiveTrancheMultiplierX100, longestStreakDraws, tierName } from './v5PointsView.js'


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

test('shows historical longest streak independently of an exited position', () => {
  assert.equal(longestStreakDraws({ current_streak_weeks: 0, longest_streak_weeks: 13 }), 13)
  assert.equal(longestStreakDraws({ longest_streak_weeks: '26' }), 26)
  assert.equal(longestStreakDraws(null), 0)
  assert.equal(longestStreakDraws({ longest_streak_weeks: 'invalid' }), 0)
})
