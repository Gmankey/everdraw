function lower(value) {
  return String(value || '').toLowerCase()
}

export function latestSettledDraw(rounds, drawManagerAddress) {
  const manager = lower(drawManagerAddress)
  return (Array.isArray(rounds) ? rounds : [])
    .filter((round) => lower(round.poolAddress) === manager && round.state === 'settled')
    .sort((a, b) => Number(b.roundId || 0) - Number(a.roundId || 0))[0] || null
}

export function participantRowsForDraw(participants, drawManagerAddress) {
  const manager = lower(drawManagerAddress)
  return (Array.isArray(participants) ? participants : [])
    .filter((row) => lower(row.poolAddress) === manager)
    .map((row) => ({ ...row, wallet: lower(row.wallet) }))
}

export function connectedWalletWon(draw, account) {
  return Boolean(draw?.winner && account && lower(draw.winner) === lower(account))
}
