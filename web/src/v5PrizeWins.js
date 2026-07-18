const lc = (value) => String(value || '').toLowerCase()

export function buildV5PrizeWins(positionEvents, tranches) {
  const trancheByOpenTx = new Map(
    (Array.isArray(tranches) ? tranches : []).map((tranche) => [`${lc(tranche.opened_tx_hash)}:${tranche.opened_log_index}`, tranche]),
  )

  return (Array.isArray(positionEvents) ? positionEvents : [])
    .filter((event) => event.source === 'prize_compound' && event.action === 'deposit')
    .map((event) => {
      const tranche = trancheByOpenTx.get(`${lc(event.tx_hash)}:${event.log_index}`)
      const startDrawId = Number(tranche?.start_draw_id || 0)
      return {
        key: `prize-${event.tx_hash}-${event.log_index}`,
        txHash: event.tx_hash,
        blockTimestamp: event.block_timestamp,
        drawId: startDrawId > 0 ? startDrawId - 1 : null,
        compoundedAmount: String(event.amount || '0'),
        remainingAmount: String(tranche?.remaining_amount || '0'),
      }
    })
    .sort((a, b) => Date.parse(b.blockTimestamp || '') - Date.parse(a.blockTimestamp || ''))
}
