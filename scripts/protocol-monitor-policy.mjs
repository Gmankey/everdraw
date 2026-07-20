export function lowReserveFailure({ reserveMon, stoppedAt, thresholdMon }) {
  if (Number(stoppedAt) !== 0 || Number(reserveMon) >= Number(thresholdMon)) return null
  return `VRF reserve ${Number(reserveMon).toFixed(4)} MON below ${Number(thresholdMon)}`
}
