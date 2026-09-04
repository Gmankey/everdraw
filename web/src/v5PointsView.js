// Streak milestones count DRAWS, not calendar weeks: the streak advances one step per
// completed draw. Values are ADR-0049 §2.
export const STREAK_MILESTONE_AWARDS = [
  { draws: 2, points: 5_000 },
  { draws: 4, points: 10_000 },
  { draws: 13, points: 20_000 },
  { draws: 26, points: 50_000 },
  { draws: 52, points: 100_000 },
]

export function awardedMilestones(points) {
  const highestAwarded = Number(points?.highest_streak_milestone_awarded || 0)
  return STREAK_MILESTONE_AWARDS.filter(({ draws }) => draws <= highestAwarded)
}

export function tierName(points) {
  return String(points?.current_tier || 'Bronze').toLowerCase()
}


function trancheMultiplierX100(poolType, tenureDraws) {
  const tenure = Math.max(0, Number(tenureDraws || 0))
  if (poolType === 'degen') {
    if (tenure >= 4) return 500
    if (tenure >= 3) return 400
    if (tenure >= 2) return 300
    return 200
  }
  if (tenure >= 26) return 200
  if (tenure >= 13) return 150
  if (tenure >= 8) return 125
  if (tenure >= 4) return 110
  return 100
}

export function effectiveTrancheMultiplierX100(tranches, poolType, currentDrawId) {
  const drawId = Number(currentDrawId || 0)
  let total = 0n
  let weighted = 0n

  for (const tranche of Array.isArray(tranches) ? tranches : []) {
    if (tranche?.pool_type !== poolType) continue
    let remaining
    try {
      remaining = BigInt(tranche?.remaining_amount || '0')
    } catch {
      continue
    }
    if (remaining <= 0n) continue
    const firstFull = Number(tranche?.first_full_weight_draw_id || 0)
    const tenure = firstFull > 0 && drawId >= firstFull ? drawId - firstFull + 1 : 0
    const multiplier = trancheMultiplierX100(poolType, tenure)
    total += remaining
    weighted += remaining * BigInt(multiplier)
  }

  if (total === 0n) return null
  return Number((weighted + total / 2n) / total)
}
