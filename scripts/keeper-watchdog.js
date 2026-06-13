#!/usr/bin/env node
import 'dotenv/config'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'

const ROOT = process.env.KEEPER_ROOT || process.cwd()
const KEEPER_SCRIPT = `${ROOT}/scripts/keeper-execute-next.js`
const PID_FILE = `${ROOT}/logs/keeper-mainnet-live.pid`
const OUT_LOG = `${ROOT}/logs/keeper-mainnet-live.out.log`
const ERR_LOG = `${ROOT}/logs/keeper-mainnet-live.err.log`
const CHECK_MS = Number(process.env.KEEPER_WATCHDOG_INTERVAL_MS || '60000')
const STALE_MS = Number(process.env.KEEPER_WATCHDOG_STALE_MS || '180000')
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
const TELEGRAM_ENABLED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
const HEALTHCHECK_URL = process.env.KEEPER_WATCHDOG_HEALTHCHECK_URL || process.env.HEALTHCHECKS_KEEPER_WATCHDOG_URL || ''
const HEALTHCHECK_FAIL_URL = process.env.KEEPER_WATCHDOG_HEALTHCHECK_FAIL_URL || ''

let lastAlertKey = ''
let lastAlertAt = 0

function ts() {
  return new Date().toISOString()
}

function log(msg) {
  console.log(`${ts()} [keeper-watchdog] ${msg}`)
}

function readPid() {
  try {
    return Number(readFileSync(PID_FILE, 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

function processAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processMatches(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ')
    return cmd.includes(KEEPER_SCRIPT)
  } catch {
    return false
  }
}

function logIsFresh() {
  try {
    const mtimeMs = statSync(OUT_LOG).mtimeMs
    return Date.now() - mtimeMs < STALE_MS
  } catch {
    return false
  }
}

function sendTelegram(text) {
  if (!TELEGRAM_ENABLED) return Promise.resolve()
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
    const req = httpsRequest(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 8000 },
      (res) => {
        res.resume()
        res.on('end', resolve)
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve())
    req.end(body)
  })
}

async function pingHealthcheck(url, label) {
  if (!url) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HEALTHCHECK_TIMEOUT_MS || '8000'))
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    log(`healthcheck ping failed label=${label}: ${err?.message || err}`)
  } finally {
    clearTimeout(timeout)
  }
}

async function pingHealthcheckFail(label) {
  if (HEALTHCHECK_FAIL_URL) {
    await pingHealthcheck(HEALTHCHECK_FAIL_URL, label)
    return
  }
  if (!HEALTHCHECK_URL) return
  await pingHealthcheck(`${HEALTHCHECK_URL.replace(/\/$/, '')}/fail`, label)
}

async function alert(key, text) {
  const now = Date.now()
  if (key === lastAlertKey && now - lastAlertAt < 10 * 60_000) return
  lastAlertKey = key
  lastAlertAt = now
  log(`ALERT ${key}: ${text.replaceAll('\n', ' | ')}`)
  await sendTelegram(text)
}

function startKeeper(reason) {
  const out = createWriteStream(OUT_LOG, { flags: 'a' })
  const err = createWriteStream(ERR_LOG, { flags: 'a' })
  const child = spawn(process.execPath, [KEEPER_SCRIPT], {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(out)
  child.stderr.pipe(err)
  child.unref()
  writeFileSync(PID_FILE, `${child.pid}\n`)
  log(`started keeper pid=${child.pid} reason=${reason}`)
  return child.pid
}

async function check() {
  const pid = readPid()
  const alive = processAlive(pid) && processMatches(pid)
  if (!alive) {
    await alert('keeper-down', `🚨 EverDraw keeper was DOWN — restarting now\noldPid=${pid || 'none'}\ntime=${ts()}`)
    startKeeper('not-running')
    await pingHealthcheck(HEALTHCHECK_URL, 'restarted')
    return
  }

  if (!logIsFresh()) {
    await alert('keeper-stale', `🚨 EverDraw keeper heartbeat/log is stale\npid=${pid}\nstaleMs>${STALE_MS}\ntime=${ts()}`)
  }
  await pingHealthcheck(HEALTHCHECK_URL, 'ok')
}

process.on('uncaughtException', async (err) => {
  await alert('watchdog-crash', `🚨 EverDraw keeper WATCHDOG crashed\n${err?.stack || err?.message || err}`)
  await pingHealthcheckFail('uncaughtException')
  process.exit(1)
})
process.on('unhandledRejection', async (err) => {
  await alert('watchdog-rejection', `🚨 EverDraw keeper WATCHDOG rejection\n${err?.stack || err?.message || err}`)
  await pingHealthcheckFail('unhandledRejection')
  process.exit(1)
})

log(`start pid=${process.pid} root=${ROOT} checkMs=${CHECK_MS} staleMs=${STALE_MS} telegram=${TELEGRAM_ENABLED} healthcheck=${Boolean(HEALTHCHECK_URL)}`)
await sendTelegram(`✅ EverDraw keeper watchdog online\ntime=${ts()}\nkeeperPid=${readPid() || 'none'}`)
await pingHealthcheck(HEALTHCHECK_URL, 'start')
await check()
setInterval(check, CHECK_MS)
