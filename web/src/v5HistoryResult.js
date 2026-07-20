export function v5HistoryResult(prizeWin) {
  return prizeWin
    ? { result: 'WINNER', prizeAmount: String(prizeWin.compoundedAmount || '0') }
    : { result: 'No win', prizeAmount: null }
}
