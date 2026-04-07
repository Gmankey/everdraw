#!/usr/bin/env node
import 'dotenv/config'
import { ethers } from 'ethers'
import { request as httpsRequest } from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const REQUIRED = ['RPC_URL', 'PRIVATE_KEY']
for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.error(`[keeper] Missing required env var: ${k}`)
    process.exit(1)
  }
}

function resolvePoolAddresses() {
  const fromList = (process.env.POOL_ADDRESSES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const all = fromList.length > 0 ? fromList : [String(process.env.POOL_ADDRESS || '').trim()].filter(Boolean)

  if (all.length === 0) {
    console.error('[keeper] Missing required env var: POOL_ADDRESS or POOL_ADDRESSES')
    process.exit(1)
  }

  const seen = new Set()
  const deduped = []
  for (const addr of all) {
    if (!ethers.isAddress(addr)) {
      console.error(`[keeper] Invalid pool address: ${addr}`)
      process.exit(1)
    }
    const lc = addr.toLowerCase()
    if (seen.has(lc)) continue
    seen.add(lc)
    deduped.push(addr)
  }

  if (deduped.length === 0) {
    console.error('[keeper] No valid pool addresses resolved from POOL_ADDRESS/POOL_ADDRESSES')
    process.exit(1)
  }

  return deduped
}

const RPC_URL = process.env.RPC_URL
const PRIVATE_KEY = process.env.PRIVATE_KEY
const POOL_ADDRESSES = resolvePoolAddresses()

const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS || 30_000)
const GAS_LIMIT = process.env.KEEPER_GAS_LIMIT ? Number(process.env.KEEPER_GAS_LIMIT) : undefined
const MAX_FEE_GWEI = process.env.KEEPER_MAX_FEE_GWEI ? Number(process.env.KEEPER_MAX_FEE_GWEI) : undefined
const MAX_PRIORITY_FEE_GWEI = process.env.KEEPER_MAX_PRIORITY_FEE_GWEI
  ? Number(process.env.KEEPER_MAX_PRIORITY_FEE_GWEI)
  : undefined
const DRY_RUN = String(process.env.KEEPER_DRY_RUN || 'false').toLowerCase() === 'true'

const LOW_BALANCE_MON = Number(process.env.KEEPER_LOW_BALANCE_MON || '0.2')
const ERROR_ALERT_THRESHOLD = Number(process.env.KEEPER_ERROR_ALERT_THRESHOLD || '3')
const BALANCE_LOG_EVERY_TICKS = Number(process.env.KEEPER_BALANCE_LOG_EVERY_TICKS || '20')
const HEARTBEAT_LOG_EVERY_TICKS = Number(process.env.KEEPER_HEARTBEAT_LOG_EVERY_TICKS || '10')

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
const TELEGRAM_ENABLED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
const TELEGRAM_TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS || '8000')
const TELEGRAM_RETRIES = Number(process.env.TELEGRAM_RETRIES || '2')
const KEEPER_PREFLIGHT = String(process.env.KEEPER_PREFLIGHT || 'true').toLowerCase() === 'true'
const execFileAsync = promisify(execFile)

const ABI = [
  'function nextExecutable() view returns (uint256 rid, uint8 action)',
  'function executeNext() returns (uint256 rid, uint8 action)',
]

const ACTION_NAMES = {
  0: 'None',
  1: 'Skip',
  2: 'Commit',
  3: 'Draw',
  4: 'Settle',
  5: 'Recommit',
}

const provider = new ethers.JsonRpcProvider(RPC_URL)
const wallet = new ethers.Wallet(PRIVATE_KEY, provider)
const pools = POOL_ADDRESSES.map((address) => ({
  address,
  contract: new ethers.Contract(address, ABI, wallet),
  consecutiveErrors: 0,
}))

let running = true
let inFlight = false
let tickCount = 0
let lowBalanceAlerted = false
let startedAtMs = Date.now()

function ts() {
  return new Date().toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h${m}m${sec}s`
}

function allPoolErrorSummary() {
  return pools.map((p) => `${p.address.slice(0, 10)}:${p.consecutiveErrors}`).join(',')
}

function keeperHeartbeat(poolAddress = '-', lastRid = '-', lastAction = '-') {
  const mem = process.memoryUsage()
  const rssMb = (mem.rss / 1024 / 1024).toFixed(1)
  const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1)
  console.log(
    `${ts()} [keeper] heartbeat ticks=${tickCount} uptime=${fmtUptime(Date.now() - startedAtMs)} inFlight=${inFlight} pool=${poolAddress} consecutiveErrorsByPool=${allPoolErrorSummary()} lastRid=${lastRid} lastAction=${lastAction} rssMB=${rssMb} heapUsedMB=${heapMb}`,
  )
}

function postTelegramViaHttps(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = httpsRequest(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: TELEGRAM_TIMEOUT_MS,
      },
      (res) => {
        let chunks = ''
        res.setEncoding('utf8')
        res.on('data', (d) => (chunks += d))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(chunks)
          } else {
            reject(new Error(`telegram https status=${res.statusCode} body=${chunks}`))
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('telegram https timeout')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function postTelegramViaCurl(payload) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  const { stdout } = await execFileAsync('curl', [
    '--silent',
    '--show-error',
    '--max-time',
    String(Math.ceil(TELEGRAM_TIMEOUT_MS / 1000)),
    '-X',
    'POST',
    url,
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify(payload),
  ])
  return stdout
}

async function sendTelegram(text) {
  if (!TELEGRAM_ENABLED) return

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    disable_web_page_preview: true,
  }

  let lastErr
  for (let i = 0; i <= TELEGRAM_RETRIES; i += 1) {
    try {
      await postTelegramViaHttps(payload)
      return
    } catch (err) {
      lastErr = err
      try {
        await postTelegramViaCurl(payload)
        return
      } catch (curlErr) {
        lastErr = curlErr
      }
    }
  }

  console.error(`${ts()} [keeper] telegram send failed after retries: ${lastErr?.message || lastErr}`)
}

async function checkBalance(forceLog = false) {
  const bal = await provider.getBalance(wallet.address)
  const balFmt = Number(ethers.formatEther(bal))

  if (forceLog || tickCount % BALANCE_LOG_EVERY_TICKS === 0) {
    console.log(`${ts()} [keeper] wallet balance=${balFmt.toFixed(6)} MON`)
  }

  if (balFmt < LOW_BALANCE_MON) {
    const msg = `${ts()} [keeper][ALERT] low balance ${balFmt.toFixed(6)} MON (< ${LOW_BALANCE_MON}) wallet=${wallet.address}`
    console.warn(msg)
    if (!lowBalanceAlerted) {
      await sendTelegram(`⚠️ Monad Keeper low balance\n${msg}`)
      lowBalanceAlerted = true
    }
  } else {
    lowBalanceAlerted = false
  }
}

async function handlePoolError(poolCtx, err) {
  poolCtx.consecutiveErrors += 1
  const msg = err?.shortMessage || err?.reason || err?.message || String(err)
  console.error(`${ts()} [keeper][pool=${poolCtx.address}] error #${poolCtx.consecutiveErrors}: ${msg}`)

  if (poolCtx.consecutiveErrors >= ERROR_ALERT_THRESHOLD) {
    await sendTelegram(
      `🚨 Monad Keeper errors\npool=${poolCtx.address}\nconsecutiveErrors=${poolCtx.consecutiveErrors}\nthreshold=${ERROR_ALERT_THRESHOLD}\nerror=${msg}`,
    )
  }
}

function txOptions() {
  const txOpts = {}
  if (GAS_LIMIT) txOpts.gasLimit = GAS_LIMIT
  if (MAX_FEE_GWEI) txOpts.maxFeePerGas = ethers.parseUnits(String(MAX_FEE_GWEI), 'gwei')
  if (MAX_PRIORITY_FEE_GWEI) {
    txOpts.maxPriorityFeePerGas = ethers.parseUnits(String(MAX_PRIORITY_FEE_GWEI), 'gwei')
  }
  return txOpts
}

async function tickPool(poolCtx) {
  const { address, contract } = poolCtx
  const [rid, action] = await contract.nextExecutable()
  const actionNum = Number(action)
  const actionName = ACTION_NAMES[actionNum] ?? `Unknown(${actionNum})`

  if (actionNum === 0) {
    console.log(`${ts()} [keeper][pool=${address}] idle rid=${rid} action=${actionName}`)
    if (tickCount % HEARTBEAT_LOG_EVERY_TICKS === 0) keeperHeartbeat(address, rid, actionName)
    poolCtx.consecutiveErrors = 0
    return
  }

  console.log(`${ts()} [keeper][pool=${address}] pending rid=${rid} action=${actionName}`)

  if (actionNum === 5) {
    const msg = `${ts()} [keeper][pool=${address}][WARN] recommit required rid=${rid} (missed draw window / blockhash expiry)`
    console.warn(msg)
    await sendTelegram(`⚠️ Monad Keeper recommit\n${msg}`)
  }

  if (DRY_RUN) {
    console.log(`${ts()} [keeper][pool=${address}] dry-run enabled, skipping tx`)
    if (tickCount % HEARTBEAT_LOG_EVERY_TICKS === 0) keeperHeartbeat(address, rid, actionName)
    poolCtx.consecutiveErrors = 0
    return
  }

  const opts = txOptions()

  if (KEEPER_PREFLIGHT) {
    try {
      await contract.executeNext.staticCall(opts)
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e)
      const kind = actionNum === 4 ? 'settle precheck not ready' : 'precheck blocked'
      console.log(`${ts()} [keeper][pool=${address}] ${kind} rid=${rid} action=${actionName}: ${msg} (no tx sent)`)
      if (tickCount % HEARTBEAT_LOG_EVERY_TICKS === 0) keeperHeartbeat(address, rid, actionName)
      poolCtx.consecutiveErrors = 0
      return
    }
  }

  const tx = await contract.executeNext(opts)
  console.log(`${ts()} [keeper][pool=${address}] sent tx=${tx.hash}`)

  const rcpt = await tx.wait(1)
  console.log(`${ts()} [keeper][pool=${address}] mined tx=${tx.hash} status=${rcpt.status} gasUsed=${rcpt.gasUsed}`)

  if (tickCount % HEARTBEAT_LOG_EVERY_TICKS === 0) keeperHeartbeat(address, rid, actionName)
  poolCtx.consecutiveErrors = 0
}

async function tick() {
  if (inFlight) return
  inFlight = true
  tickCount += 1

  try {
    await checkBalance()

    for (const poolCtx of pools) {
      try {
        await tickPool(poolCtx)
      } catch (err) {
        await handlePoolError(poolCtx, err)
      }
    }
  } finally {
    inFlight = false
  }
}

async function main() {
  const net = await provider.getNetwork()
  const addr = await wallet.getAddress()
  console.log(
    `${ts()} [keeper] start pid=${process.pid} chainId=${net.chainId} wallet=${addr} pools=${POOL_ADDRESSES.length} poolAddresses=${POOL_ADDRESSES.join(',')} intervalMs=${INTERVAL_MS} dryRun=${DRY_RUN} preflight=${KEEPER_PREFLIGHT} telegram=${TELEGRAM_ENABLED} telegramTimeoutMs=${TELEGRAM_TIMEOUT_MS} telegramRetries=${TELEGRAM_RETRIES} lowBalanceMon=${LOW_BALANCE_MON} errorAlertThreshold=${ERROR_ALERT_THRESHOLD}`,
  )

  await checkBalance(true)

  process.on('SIGINT', () => {
    console.log(`${ts()} [keeper] SIGINT received, shutting down...`)
    running = false
  })
  process.on('SIGTERM', () => {
    console.log(`${ts()} [keeper] SIGTERM received, shutting down...`)
    running = false
  })
  process.on('beforeExit', (code) => {
    console.log(`${ts()} [keeper] beforeExit code=${code} uptime=${fmtUptime(Date.now() - startedAtMs)}`)
  })
  process.on('exit', (code) => {
    console.log(`${ts()} [keeper] exit code=${code} uptime=${fmtUptime(Date.now() - startedAtMs)}`)
  })
  process.on('uncaughtException', async (err) => {
    const msg = err?.stack || err?.message || String(err)
    console.error(`${ts()} [keeper] uncaughtException: ${msg}`)
    await sendTelegram(`🚨 Monad Keeper uncaughtException\n${msg.slice(0, 3000)}`)
    process.exit(1)
  })
  process.on('unhandledRejection', async (reason) => {
    const msg = reason?.stack || reason?.message || String(reason)
    console.error(`${ts()} [keeper] unhandledRejection: ${msg}`)
    await sendTelegram(`🚨 Monad Keeper unhandledRejection\n${msg.slice(0, 3000)}`)
    process.exit(1)
  })

  while (running) {
    await tick()
    await sleep(INTERVAL_MS)
  }

  console.log(`${ts()} [keeper] stopped`)
}

main().catch(async (e) => {
  const msg = e?.shortMessage || e?.reason || e?.message || String(e)
  console.error(`${ts()} [keeper] fatal: ${msg}`)
  await sendTelegram(`🚨 Monad Keeper fatal\n${msg}`)
  process.exit(1)
})
