import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

test('routes only actionable failures, not claim quarantine, to the failure endpoint', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'everdraw-v5-supervisor-'))
  const fakeKeeper = join(dir, 'fake-keeper.mjs')
  writeFileSync(fakeKeeper, "console.warn('[keeper-v5] CLAIM_QUARANTINED key=manager:claims:45 drawId=45 error=InvalidProof selector=0x09bde339')\nconsole.warn('[keeper-v5] LOW_BALANCE_WARNING balanceWei=1 warningWei=2 floorWei=1')\nprocess.exit(1)\n")

  let failurePings = 0
  const server = createServer((_req, res) => {
    failurePings += 1
    res.writeHead(200)
    res.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  const address = server.address()
  const supervisor = spawn(process.execPath, ['scripts/keeper/v5-runtime-supervisor.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KEEPER_V5_SCRIPT: fakeKeeper,
      KEEPER_RESTART_DELAY_MS: '10',
      KEEPER_CRASH_ALERT_THRESHOLD: '2',
      KEEPER_CRASH_ALERT_WINDOW_MS: '5000',
      KEEPER_ALERT_REPEAT_MS: '60000',
      KEEPER_HEALTHCHECK_FAIL_URL: `http://127.0.0.1:${address.port}/fail`,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => {
    if (!supervisor.killed) supervisor.kill('SIGTERM')
  })

  let output = ''
  supervisor.stdout.on('data', (chunk) => { output += chunk })
  supervisor.stderr.on('data', (chunk) => { output += chunk })

  const deadline = Date.now() + 5000
  while (failurePings < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  supervisor.kill('SIGTERM')
  await new Promise((resolve) => supervisor.once('exit', resolve))

  assert.equal(failurePings, 2, `expected low-balance + crash-loop only, received ${failurePings}`)
  assert.match(output, /ALERT low-balance/)
  assert.match(output, /ALERT crash-loop/)
  assert.match(output, /ALERT claim-quarantined:manager:claims:45/)
})

test('terminates when every actionable alert transport fails so the external heartbeat expires', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'everdraw-v5-supervisor-transport-'))
  const fakeKeeper = join(dir, 'fake-keeper.mjs')
  writeFileSync(
    fakeKeeper,
    "console.warn('[keeper-v5] LOW_BALANCE_WARNING balanceWei=1 warningWei=2 floorWei=1')\nsetInterval(() => {}, 1000)\n"
  )

  const server = createServer((_req, res) => {
    res.writeHead(503)
    res.end('unavailable')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  const address = server.address()
  const supervisor = spawn(process.execPath, ['scripts/keeper/v5-runtime-supervisor.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KEEPER_V5_SCRIPT: fakeKeeper,
      KEEPER_RESTART_DELAY_MS: '10',
      KEEPER_HEALTHCHECK_FAIL_URL: `http://127.0.0.1:${address.port}/fail`,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => {
    if (!supervisor.killed) supervisor.kill('SIGTERM')
  })

  let output = ''
  supervisor.stdout.on('data', (chunk) => { output += chunk })
  supervisor.stderr.on('data', (chunk) => { output += chunk })

  const exit = await Promise.race([
    new Promise((resolve) => supervisor.once('exit', (code) => resolve(code))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('supervisor did not fail closed')), 5000)),
  ])

  assert.equal(exit, 1)
  assert.match(output, /healthcheck failure ping failed/)
  assert.match(output, /FATAL all actionable alert transports failed/)
})
