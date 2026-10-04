// Isolated illustrative state: never imports wallet or contract code.
export const STEPS = [
  { id: 'ready', caption: 'Your deposit enters the vault with everyone else’s.', duration: 0, title: 'Meet your deposit' },
  { id: 'deposit', caption: 'The more you deposit and the longer you stay, the more entries you accrue', duration: 4300, title: 'Build your entries' },
  { id: 'yield', caption: 'Staking yield funds the prize pool', duration: 6500, title: 'Grow the prize' },
  { id: 'winner', caption: 'One winner is drawn and wins the pot', duration: 6500, title: 'A winner is drawn' },
  { id: 'compound', caption: 'Regardless of who wins, your deposit remains', duration: 6500, title: 'The prize joins their deposit' },
  { id: 'repeat', caption: 'The vault will reset, your deposit will begin accruing tickets again', duration: 7500, title: 'Start again automatically' },
  { id: 'lucky', caption: 'You may be the next lucky winner!', duration: 14500, title: 'An example of your winning draw' },
  { id: 'withdraw', caption: 'You can withdraw your deposit and your prize tokens the same way you deposited them', duration: 5200, title: 'Choose to withdraw' },
]
export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
export const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t) }
export function positionOnCurve(t, start, control, end) {
  const p = clamp(t), q = 1 - p
  return { x: q*q*start.x + 2*q*p*control.x + p*p*end.x, y: q*q*start.y + 2*q*p*control.y + p*p*end.y }
}
export function ticketCount(step, time, capturedEntries = 12, secondEntries = 6) {
  if (step < 1) return 0
  if (step === 1) return Math.max(0, Math.floor((time - 2450) / 820))
  if (step < 5) return capturedEntries
  if (step === 5) return time < 1300 ? capturedEntries : Math.max(0, Math.floor((time - 2250) / 820))
  if (step === 6) return secondEntries
  return 0
}
export function canAdvance(step) {
  return step >= 0 && step < STEPS.length
}
export function reveal(time) {
  return {
    ticketRise: ease(time / 600),
    ticketShine: time >= 600 && time <= 1750 ? clamp((time - 600) / 1150) : null,
    ticketTravel: ease((time - 1800) / 1100),
    ticketOpacity: 1 - clamp((time - 2900) / 180),
    winnerShine: time >= 2900 && time <= 3750 ? clamp((time - 2900) / 850) : null,
    prizeShine: time >= 3900 && time <= 5000 ? clamp((time - 3900) / 1100) : null,
    border: clamp((time - 5200) / 650),
  }
}
export function withdrawalPoint(start, time, index, vx, vy) {
  const p = ease((time - 6500 - index * 460) / 2500)
  const exit = { x: vx - 203, y: vy + 100 }, target = { x: 62 + index * 52, y: 170 }
  if (p < .3) return { ...positionOnCurve(p / .3, start, { x: start.x - 30, y: vy + 110 }, exit), p }
  return { ...positionOnCurve((p - .3) / .7, exit, { x: vx - 240, y: 170 }, target), p }
}
