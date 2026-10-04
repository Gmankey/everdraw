import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STEPS, canAdvance, ticketCount, positionOnCurve, ease, reveal, withdrawalPoint } from './story.js'
import { BALL_RADIUS, GAP_HALF, FLOOR_Y, DEPOSITS, POUR, POURED, ORANGE_DROP, ORANGE_SETTLED, GREEN_DROP, GREEN_SETTLED, GREEN_SCENE, ORANGE_SCENE } from './motion.js'

test('complete eight-stage story ends with user win and withdrawal', () => {
  assert.deepEqual(STEPS.map(s => s.id), ['ready', 'deposit', 'yield', 'winner', 'compound', 'repeat', 'lucky', 'withdraw'])
})
test('all advance actions are immediately available', () => {
  assert.equal(canAdvance(-1, 100), false)
  for (let step = 1; step < STEPS.length; step++) {
    assert.equal(canAdvance(step, 0), true)
    assert.equal(canAdvance(step, STEPS[step].duration * .75), true)
    assert.equal(canAdvance(step, STEPS[step].duration), true)
    assert.equal(canAdvance(step, 0, true), true)
  }
})
test('entries arrive after deposit; retain through settlement; reset; stop on withdrawal', () => {
  assert.equal(ticketCount(0, 9000), 0); assert.equal(ticketCount(1, 2000), 0)
  const earned = ticketCount(1, 40000)
  assert.ok(earned > 12); assert.equal(ticketCount(3, 5000, earned), earned)
  assert.equal(ticketCount(5, 400, earned), earned); assert.equal(ticketCount(5, 1500, earned), 0)
  assert.ok(ticketCount(5, 3900, earned) > 0); assert.equal(ticketCount(6, 5000, earned, 9), 9)
  assert.equal(ticketCount(7, 11000, earned, 9), 0)
})
test('reveal holds ticket before travel; winner reacts before prizes; borders come last', () => {
  assert.equal(reveal(1100).ticketTravel, 0)
  assert.ok(reveal(1100).ticketShine > 0)
  assert.ok(reveal(2200).ticketTravel > 0)
  assert.ok(reveal(3300).winnerShine > 0)
  assert.equal(reveal(3300).prizeShine, null)
  assert.ok(reveal(4500).prizeShine > 0)
  assert.equal(reveal(4500).border, 0)
  assert.equal(reveal(6200).border, 1)
})
test('all six green balls arrive on the withdrawal line without overlap', () => {
  const starts = [DEPOSITS[0], ...GREEN_SETTLED]
  const positions = starts.map((b, i) => withdrawalPoint({ x: 980+b.x, y: 300+b.y }, 11600, i, 980, 300))
  positions.forEach((p, i) => { assert.equal(p.y, 170); assert.equal(p.x, 62+i*52); assert.equal(p.p, 1) })
})
test('equal-radius balls settle on shelves and bounce on impact', () => {
  assert.equal(BALL_RADIUS, 22)
  assert.equal(POURED.length, 5)
  assert.ok(POURED.every(b => Math.abs(b.y - (FLOOR_Y - BALL_RADIUS - 2)) < .1))
  assert.ok(POUR.some(frame => frame.some(b => b.vy < -15)))
  for (const settled of [ORANGE_SETTLED, GREEN_SETTLED]) assert.ok(settled.every(b => b.y > FLOOR_Y + BALL_RADIUS))
})
test('every prize crosses the exact hatch opening, not a solid part of the floor', () => {
  for (const track of [ORANGE_DROP, GREEN_DROP]) {
    const crossed = new Set()
    track.forEach((frame, index) => {
      if (!index) return
      for (const b of frame) {
        const previous = track[index-1].find(p => p.id === b.id)
        if (previous.y < FLOOR_Y && b.y >= FLOOR_Y) {
          const f = (FLOOR_Y - previous.y) / (b.y - previous.y)
          const x = previous.x + (b.x - previous.x) * f
          const gap = GAP_HALF * ease(((index - 1 + f) * 1000 / 120) / 420)
          assert.ok(Math.abs(x) + BALL_RADIUS <= gap + .5, b.id + ' intersected floor at x=' + x)
          crossed.add(b.id)
        }
      }
    })
    assert.equal(crossed.size, 5)
  }
})
test('settled balls do not overlap each other or original deposits', () => {
  const scene = GREEN_SCENE.at(-1)
  for (let i = 0; i < scene.length; i++) for (let j = i+1; j < scene.length; j++) {
    assert.ok(Math.hypot(scene[i].x-scene[j].x, scene[i].y-scene[j].y) >= BALL_RADIUS * 2 - .5)
  }
})
test('clamped paths preserve endpoints', () => {
  const a = { x: 62, y: 170 }, b = { x: 705, y: 169 }, c = { x: 892, y: 383 }
  assert.deepEqual(positionOnCurve(-1, a, b, c), a); assert.deepEqual(positionOnCurve(1.1, a, b, c), c)
})
test('bottom deposits move in response to prize collisions', () => {
for (const id of ['you', 'blue', 'orange', 'white']) {
const start = DEPOSITS.find(b => b.id === id), end = ORANGE_SCENE.at(-1).find(b => b.id === id)
assert.ok(Math.hypot(start.x-end.x, start.y-end.y) > .5, id)
}
})
test('withdrawal is available immediately while the win animation can continue', () => {
assert.ok(STEPS[6].duration >= 14200)
assert.equal(canAdvance(6, 0), true)
assert.equal(canAdvance(6, 10875), true)
})
