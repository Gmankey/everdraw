#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { V5RuntimeAlertPolicy } from './v5-runtime-alert-policy.mjs'

const KEEPER_SCRIPT = process.env.KEEPER_V5_SCRIPT || 'scripts/keeper-v5.js'
const RESTART_DELAY_MS = Number(process.env.KEEPER_RESTART_DELAY_MS || '5000')
const TELEGRAM_TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS || '8000')
const TELEGRAM_RETRIES = Number(process.env.TELEGRAM_RETRIES || '2')
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
const HEALTHCHECK_FAIL_URL = process.env.KEEPER_HEALTHCHECK_FAIL_URL || process.env.KEEPER_WATCHDOG_HEALTHCHECK_FAIL_URL || ''

const policy = new V5RuntimeAlertPolicy({
  crashThreshold: Number(process.env.KEEPER_CRASH_ALERT_THRESHOLD || '3'),
  crashWindowMs: Number(process.env.KEEPER_CRASH_ALERT_WINDOW_MS || '60000'),
  repeatMs: Number(process.env.KEEPER_ALERT_REPEAT_MS || '3600000'),
})

let child = null
let stopping = false

function log(message) {
  console.log(`${new Date().toISOString()} [keeper-v5-supervisor] ${message}`)
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  for (let attempt = 1; attempt <= TELEGRAM_RETRIES + 1; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
        signal: controller.signal,
      })
      if (response.ok) return true
      throw new Error(`Telegram HTTP ${response.status}`)
    } catch (error) {
      if (attempt > TELEGRAM_RETRIES) {
        log(`telegram alert failed after ${attempt} attempts: ${error?.message || error}`)
        return false
      }
      await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)))
    } finally {
      clearTimeout(timeout)
    }
  }
  return false
}

async function pingFailureHealthcheck() {
  if (!HEALTHCHECK_FAIL_URL) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS)
  try {
    const response = await fetch(HEALTHCHECK_FAIL_URL, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return true
  } catch (error) {
    log(`healthcheck failure ping failed: ${error?.message || error}`)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function alert(event) {
  const message = `EverDraw V5 keeper alert: ${event.key}\n${event.message}\ntime=${new Date().toISOString()}`
  log(`ALERT ${event.key}: ${event.message}`)
  await Promise.all([sendTelegram(message), pingFailureHealthcheck()])
}

function observeStream(stream, output) {
  let pending = ''
  stream.on('data', (chunk) => {
    const text = chunk.toString()
    output.write(text)
    pending += text
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() || ''
    for (const line of lines) {
      const event = policy.observeLine(line)
      if (event) void alert(event)
    }
  })
}

function startKeeper() {
  child = spawn(process.execPath, [KEEPER_SCRIPT], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  observeStream(child.stdout, process.stdout)
  observeStream(child.stderr, process.stderr)
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal })))
}

function stop(signal) {
  stopping = true
  if (child && !child.killed) child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

log(`start telegram=${Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)} healthcheckFail=${Boolean(HEALTHCHECK_FAIL_URL)}`)
if ((!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) && !HEALTHCHECK_FAIL_URL) {
  log('WARNING alert transport is disabled; configure Telegram and/or KEEPER_HEALTHCHECK_FAIL_URL')
}

while (!stopping) {
  const { code, signal } = await startKeeper()
  if (stopping) break
  log(`keeper-v5.js exited code=${code} signal=${signal || 'none'}; restarting in ${RESTART_DELAY_MS}ms`)
  const event = policy.observeExit(code)
  if (event) await alert(event)
  await sleep(RESTART_DELAY_MS)
}

log('stopped')
