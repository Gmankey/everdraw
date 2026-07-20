export function v5PageFromHash(hash) {
  switch (String(hash || '').toLowerCase()) {
    case '#stats': return 'stats'
    case '#leaderboard': return 'leaderboard'
    case '#profile': return 'profile'
    case '#patron': return 'degen'
    default: return 'vault'
  }
}
