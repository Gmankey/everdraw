const CREDIT_ACTIONS = new Set(['deposit', 'transfer_in'])
const DEBIT_ACTIONS = new Set(['withdraw', 'transfer_out'])

export function v5PeriodAccountEvents(positionEvents, periodStart) {
  if (!Array.isArray(positionEvents) || !Number.isFinite(Number(periodStart))) return []
  return positionEvents
    .filter((event) => event.pool_type === 'vault' && (CREDIT_ACTIONS.has(event.action) || DEBIT_ACTIONS.has(event.action)))
    .map((event) => ({
      type: CREDIT_ACTIONS.has(event.action) ? 'deposit' : 'withdraw',
      amount: String(event.amount || '0'),
      blockNumber: Number(event.block_number || 0),
      transactionIndex: 0,
      index: Number(event.log_index || 0),
      timestamp: Math.floor((Date.parse(event.block_timestamp || '') || 0) / 1000),
    }))
    .filter((event) => event.timestamp >= Number(periodStart))
    .sort((a, b) => a.timestamp - b.timestamp || a.blockNumber - b.blockNumber || a.index - b.index)
}
