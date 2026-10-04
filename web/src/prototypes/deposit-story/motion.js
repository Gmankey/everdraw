// Fixed-step gravity and disc collisions, precomputed for deterministic scrubbing.
// All coordinates are relative to the vault centre; all balls share one radius.
import { clamp, ease } from './story.js'
export const BALL_RADIUS = 22
export const WALL_RADIUS = 178
export const FLOOR_Y = 5
export const GAP_HALF = 50
const DT = 1 / 120
const DEPOSIT_SEEDS = [
  { id: 'you', x: -103, y: Math.sqrt(156**2 - 103**2) },
  { id: 'blue', x: -48, y: Math.sqrt(156**2 - 48**2) },
  { id: 'orange', x: 17, y: Math.sqrt(156**2 - 17**2) },
  { id: 'white', x: 91, y: Math.sqrt(156**2 - 91**2) },
]
const copy = ball => ({ ...ball })
function segment(body, x1, x2) {
  if (x2 <= x1) return
  const nearX = clamp(body.x, x1, x2), dx = body.x - nearX, dy = body.y - FLOOR_Y
  const d = Math.hypot(dx, dy)
  const penetration = BALL_RADIUS + 2 - d
  if (penetration > 0) {
    const nx = d > .0001 ? dx / d : 0, ny = d > .0001 ? dy / d : -1
    body.x += nx * penetration; body.y += ny * penetration
    const toward = body.vx * nx + body.vy * ny
    if (toward < 0) { body.vx -= 1.25 * toward * nx; body.vy -= 1.25 * toward * ny }
    if (Math.abs(ny) > .8) body.vx *= .975
  }
}
function pair(a, b, fixed) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
  if (d >= BALL_RADIUS * 2 + .6) return
  const nx = d > .0001 ? dx / d : 1, ny = d > .0001 ? dy / d : 0
  const push = BALL_RADIUS * 2 + .6 - d, share = fixed ? 1 : .5
  a.x -= nx * push * share; a.y -= ny * push * share
  if (!fixed) { b.x += nx * push * share; b.y += ny * push * share }
  const closing = (a.vx - (b.vx || 0)) * nx + (a.vy - (b.vy || 0)) * ny
  if (closing > 0) {
    const impulse = closing * 1.22 * share
    a.vx -= nx * impulse; a.vy -= ny * impulse
    if (!fixed) { b.vx += nx * impulse; b.vy += ny * impulse }
  }
}
function simulate(initial, fixed, hatch, seconds = 8) {
  const balls = initial.map(b => ({ vx: 0, vy: 0, rotation: 0, ...b })), frames = []
  for (let tick = 0; tick <= seconds / DT; tick++) {
    const ms = tick * DT * 1000
    const active = balls.filter(b => ms >= (b.spawn || 0))
    const gap = hatch ? GAP_HALF * ease(ms / 420) : 0
    for (const b of active) {
      b.vy += 720 * DT
      // Balls on the shelf roll toward its opening, not through the solid floor.
      if (hatch && b.y < FLOOR_Y && Math.abs(b.x) > 4) b.vx += -Math.sign(b.x) * 150 * DT
      b.vx *= .996
      b.x += b.vx * DT; b.y += b.vy * DT
      b.rotation += b.vx * DT / BALL_RADIUS * 180 / Math.PI
    }
    for (let solver = 0; solver < 7; solver++) {
      for (let i = 0; i < active.length; i++) {
        const b = active[i]
        if (gap < .01) segment(b, -WALL_RADIUS, WALL_RADIUS)
        else { segment(b, -WALL_RADIUS, -gap); segment(b, gap, WALL_RADIUS) }
        for (const f of fixed) pair(b, f, true)
        for (let j = i + 1; j < active.length; j++) pair(b, active[j], false)
        // An open inlet above the prize chamber admits poured balls.
        const d = Math.hypot(b.x, b.y), limit = WALL_RADIUS - BALL_RADIUS
        if (b.y > -110 && d > limit) {
          const nx = b.x/d, ny = b.y/d
          b.x = nx * limit; b.y = ny * limit
          const outward = b.vx*nx + b.vy*ny
          if (outward > 0) { b.vx -= 1.28*outward*nx; b.vy -= 1.28*outward*ny }
        }
      }
    }
    frames.push(active.map(copy))
  }
  return frames
}
const pourInitial = [-160, -90, -20, 65, 125].map((vx, i) => ({ id: 'prize-' + i, x: 40, y: -205, vx, vy: 20, spawn: 500 + i * 730 }))
export const POUR = simulate(pourInitial, [], false)
export const POURED = POUR.at(-1)
export const DEPOSITS = simulate(DEPOSIT_SEEDS, [], false).at(-1)
const reset = b => ({ ...b, vx: 0, vy: 0, spawn: 0 })
export const ORANGE_SCENE = simulate([...DEPOSITS, ...POURED].map(reset), [], true)
export const ORANGE_DROP = ORANGE_SCENE.map(f => f.filter(b => b.id.startsWith('prize-')))
export const ORANGE_SETTLED = ORANGE_DROP.at(-1)
export const GREEN_SCENE = simulate([...ORANGE_SCENE.at(-1).map(b => ({ ...b, id: b.id.replace('prize-', 'orange-prize-') })), ...POURED].map(reset), [], true)
export const GREEN_DROP = GREEN_SCENE.map(f => f.filter(b => b.id.startsWith('prize-')))
export const GREEN_SETTLED = GREEN_DROP.at(-1)
export function residents(step, time) {
  if (step === 4) return sample(ORANGE_SCENE, time).filter(b => !b.id.startsWith('prize-'))
  if (step === 6 && time >= 6200) return sample(GREEN_SCENE, time - 6200).filter(b => !b.id.startsWith('prize-'))
  if (step === 7) return GREEN_SCENE.at(-1).filter(b => !b.id.startsWith('prize-'))
  if (step >= 5) return ORANGE_SCENE.at(-1).map(b => ({ ...b, id: b.id.replace('prize-', 'orange-prize-') }))
  return DEPOSITS
}
export function sample(track, time) {
  return track[Math.min(track.length - 1, Math.max(0, Math.round(time / (DT * 1000))))]
}
