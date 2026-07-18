export const STREAK_MILESTONE_AWARDS = [
  { week: 2, points: 10_000 },
  { week: 4, points: 50_000 },
  { week: 13, points: 200_000 },
  { week: 26, points: 500_000 },
  { week: 52, points: 1_000_000 },
]

export function awardedMilestones(points) {
  const highestAwarded = Number(points?.highest_streak_milestone_awarded || 0)
  return STREAK_MILESTONE_AWARDS.filter(({ week }) => week <= highestAwarded)
}

export function tierName(points) {
  return String(points?.current_tier || 'Bronze').toLowerCase()
}
