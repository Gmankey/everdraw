#!/usr/bin/env node
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Contract, FallbackProvider, Interface, JsonRpcProvider, formatEther, getAddress } from 'ethers'
import { assertCanonicalKeeperPools, parseAddressList } from './keeper-active-pools.mjs'

const MAX_CATCHUP_BLOCKS = Number(process.env.ALERT_WATCHER_MAX_CATCHUP_BLOCKS || '50000')
const BOOT_LOOKBACK_BLOCKS = Number(process.env.ALERT_WATCHER_BOOT_LOOKBACK_BLOCKS || '5000')
const POLL_MS = Number(process.env.ALERT_WATCHER_POLL_MS || '15000')
const LOG_CHUNK_BLOCKS = Number(process.env.ALERT_WATCHER_LOG_CHUNK_BLOCKS || '5000')
const HEARTBEAT_MS = 15 * 60_000
const VRF_CHECK_MS = Number(process.env.ALERT_WATCHER_VRF_CHECK_MS || String(60 * 60_000))
const ACTION_OVERDUE_CHECK_MS = Number(process.env.ALERT_WATCHER_ACTION_OVERDUE_CHECK_MS || String(60 * 1000))
const ACTION_OVERDUE_MS = Number(process.env.ALERT_WATCHER_ACTION_OVERDUE_MS || String(10 * 60_000))
const VRF_LOW_THRESHOLD_MON = Number(process.env.VRF_LOW_THRESHOLD_MON || '5')
const VRF_FEE_ESTIMATE_MON = Number(process.env.VRF_FEE_ESTIMATE_MON || '0.05')
const STATE_FILE = process.env.KEEPER_ALERT_STATE_FILE || '/data/keeper-alert-watcher-state.json'
const HEALTHCHECK_URL = process.env.ALERT_WATCHER_HEALTHCHECK_URL || process.env.HEALTHCHECKS_ALERT_WATCHER_URL || ''
const HEALTHCHECK_FAIL_URL = process.env.ALERT_WATCHER_HEALTHCHECK_FAIL_URL || ''

const RPC_URL = process.env.RPC_URL || ''
const RPC_URL_FALLBACK = process.env.RPC_URL_FALLBACK || ''
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''
const POOLS = parseAddressList(process.env.POOL_ADDRESSES || process.env.POOL_ADDRESS)
const poolReconcile = assertCanonicalKeeperPools(POOLS)

const ABI = [
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  'event EntropyChangeQueued(address newEntropy, address newProvider, uint64 effectiveAt)',
  'event EntropyChanged(address entropy, address entropyProvider)',
  'event EntropyChangeCancelled()',
  'event FeeUpdated(uint16 feeBps, address feeRecipient)',
  'event KeeperSet(address indexed keeper, bool allowed)',
  'event Paused(address indexed by)',
  'event Unpaused(address indexed by)',
  'event VRFReserveWithdrawn(address indexed to, uint256 amount)',
  'event EmergencyForceSettled(uint256 indexed roundId)',
  'function nextExecutable() view returns (uint256 rid, uint8 action)',
  'function currentRoundId() view returns (uint256)',
  'function getRoundTimes(uint256 rid) view returns (uint64 salesEndTime, uint64 vrfRequestTime)',
]

const iface = new Interface(ABI)
const eventTopics = ABI
  .filter((fragment) => fragment.startsWith('event '))
  .map((fragment) => iface.getEvent(fragment.split('(')[0].replace('event ', '')).topicHash)
const provider = makeProvider(RPC_URL, RPC_URL_FALLBACK)

let stopping = false
let state = readState()

function ts() {
  return new Date().toISOString()
}

function log(message) {
  console.log(`${ts()} [alert-watcher] ${message}`)
}

function validateEnv() {
  if (!RPC_URL) throw new Error('Missing RPC_URL')
  if (!POOLS.length) throw new Error('Missing POOL_ADDRESSES')
  if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN')
  if (!TELEGRAM_CHAT_ID) throw new Error('Missing TELEGRAM_CHAT_ID')
  if (!Number.isFinite(VRF_LOW_THRESHOLD_MON) || VRF_LOW_THRESHOLD_MON <= 0) {
    throw new Error('VRF_LOW_THRESHOLD_MON must be a positive number')
  }
}

function makeProvider(primaryUrl, fallbackUrl) {
  const primary = new JsonRpcProvider(primaryUrl)
  if (!fallbackUrl) return primary
  return new FallbackProvider([
    { provider: primary, priority: 1, stallTimeout: 2000 },
    { provider: new JsonRpcProvider(fallbackUrl), priority: 2, stallTimeout: 2000 },
  ], undefined, { quorum: 1 })
}

function readState() {
  try {
    if (!existsSync(STATE_FILE)) return { lastSeenBlock: 0, recentLogKeys: [], reserveLowAlerts: {}, actionDueAlerts: {} }
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return {
      lastSeenBlock: Number(parsed.lastSeenBlock || 0),
      recentLogKeys: Array.isArray(parsed.recentLogKeys) ? parsed.recentLogKeys.slice(-500) : [],
      reserveLowAlerts: parsed.reserveLowAlerts && typeof parsed.reserveLowAlerts === 'object' ? parsed.reserveLowAlerts : {},
      actionDueAlerts: parsed.actionDueAlerts && typeof parsed.actionDueAlerts === 'object' ? parsed.actionDueAlerts : {},
    }
  } catch (error) {
    log(`state read failed; starting with empty state: ${error?.message || error}`)
    return { lastSeenBlock: 0, recentLogKeys: [], reserveLowAlerts: {}, actionDueAlerts: {} }
  }
}

function writeState() {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(tmp, STATE_FILE)
}

function rememberLog(log) {
  const key = `${log.transactionHash}:${log.index}`
  if (state.recentLogKeys.includes(key)) return false
  state.recentLogKeys.push(key)
  if (state.recentLogKeys.length > 500) state.recentLogKeys = state.recentLogKeys.slice(-500)
  return true
}

function poolLabel(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

async function sendTelegram(text, attempts = 3) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), Number(process.env.TELEGRAM_TIMEOUT_MS || '8000'))
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (res.ok) return
      throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`)
    } catch (error) {
      if (attempt === attempts) {
        log(`telegram send failed after ${attempts} attempts: ${error?.message || error}`)
        return
      }
      await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)))
    }
  }
}

async function alert(text) {
  log(`ALERT ${text.replaceAll('\n', ' | ')}`)
  await sendTelegram(text)
}

async function pingHealthcheck(url, label) {
  if (!url) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HEALTHCHECK_TIMEOUT_MS || '8000'))
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    log(`healthcheck ping failed label=${label}: ${error?.message || error}`)
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

function formatEventAlert(log, parsed) {
  const vault = poolLabel(getAddress(log.address))
  const tx = log.transactionHash
  const args = parsed.args

  switch (parsed.name) {
    case 'OwnershipTransferred':
      return `🚨 Ownership transferred on ${vault}: ${args.previousOwner} -> ${args.newOwner}, tx ${tx}. If unexpected, investigate immediately.`
    case 'EntropyChangeQueued': {
      const effectiveAt = Number(args.effectiveAt)
      const hours = Math.max(0, (effectiveAt * 1000 - Date.now()) / 3_600_000)
      return `🚨 Entropy change queued on ${vault}: entropy=${args.newEntropy}, provider=${args.newProvider}, takes effect at ${new Date(effectiveAt * 1000).toISOString()} (in ${hours.toFixed(1)}h). If unauthorized, call cancelEntropyChange before the deadline. Tx ${tx}.`
    }
    case 'EntropyChanged':
      return `Entropy change committed on ${vault}: ${args.entropy} / ${args.entropyProvider}, tx ${tx}.`
    case 'EntropyChangeCancelled':
      return `Entropy change cancelled on ${vault}, tx ${tx}.`
    case 'FeeUpdated':
      return `Fee updated on ${vault}: ${args.feeBps} bps -> ${args.feeRecipient}, tx ${tx}. Effective next round opened.`
    case 'KeeperSet':
      return `Keeper ${args.keeper} ${args.allowed ? 'authorized' : 'revoked'} on ${vault}, tx ${tx}.`
    case 'Paused':
      return `${vault} paused by ${args.by}, tx ${tx}.`
    case 'Unpaused':
      return `${vault} unpaused by ${args.by}, tx ${tx}.`
    case 'VRFReserveWithdrawn':
      return `🚨 VRF reserve withdrawn from ${vault}: ${formatEther(args.amount)} MON to ${args.to}, tx ${tx}.`
    case 'EmergencyForceSettled':
      return `Round ${args.roundId} emergency-force-settled on ${vault}, tx ${tx}.`
    default:
      return `${parsed.name} on ${vault}, tx ${tx}.`
  }
}

async function processLogs(fromBlock, toBlock) {
  let count = 0
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = Math.min(toBlock, start + LOG_CHUNK_BLOCKS - 1)
    const logs = await provider.getLogs({
      address: POOLS,
      topics: [eventTopics],
      fromBlock: start,
      toBlock: end,
    })

    logs.sort((a, b) => a.blockNumber !== b.blockNumber ? a.blockNumber - b.blockNumber : a.index - b.index)
    for (const logEntry of logs) {
      if (!rememberLog(logEntry)) continue
      const parsed = iface.parseLog({ topics: [...logEntry.topics], data: logEntry.data })
      if (!parsed) continue
      await alert(formatEventAlert(logEntry, parsed))
      count += 1
    }

    state.lastSeenBlock = end
    writeState()
  }
  return count
}

async function scanOnce() {
  const currentBlock = await provider.getBlockNumber()
  if (!state.lastSeenBlock) {
    state.lastSeenBlock = Math.max(0, currentBlock - BOOT_LOOKBACK_BLOCKS)
    writeState()
  }

  if (state.lastSeenBlock >= currentBlock) return { currentBlock, scanned: 0, alerts: 0 }

  const gap = currentBlock - state.lastSeenBlock
  if (gap > MAX_CATCHUP_BLOCKS) {
    await alert(`⚠️ EverDraw alert watcher restarted after an extended ${gap}-block gap. Skipping automatic catch-up; manually review governance events from block ${state.lastSeenBlock + 1} to ${currentBlock}.`)
    state.lastSeenBlock = currentBlock
    writeState()
    return { currentBlock, scanned: 0, alerts: 0 }
  }

  const fromBlock = state.lastSeenBlock + 1
  const alerts = await processLogs(fromBlock, currentBlock)
  return { currentBlock, scanned: currentBlock - fromBlock + 1, alerts }
}

async function checkVrfReserve() {
  for (const address of POOLS) {
    const balance = await provider.getBalance(address)
    const mon = Number(formatEther(balance))
    const rounds = VRF_FEE_ESTIMATE_MON > 0 ? mon / VRF_FEE_ESTIMATE_MON : 0
    if (mon >= VRF_LOW_THRESHOLD_MON) continue

    const now = Date.now()
    const lastAlertAt = Number(state.reserveLowAlerts[address] || 0)
    if (now - lastAlertAt < VRF_CHECK_MS) continue

    state.reserveLowAlerts[address] = now
    writeState()
    await alert(`⚠️ VRF reserve on ${poolLabel(address)} is ${mon.toFixed(4)} MON (~${rounds.toFixed(1)} rounds runway). Threshold=${VRF_LOW_THRESHOLD_MON} MON.`)
  }
}

function actionName(action) {
  return {
    0: 'None',
    1: 'Skip',
    2: 'Commit',
    3: 'Finalize',
  }[action] || `Unknown(${action})`
}

async function checkActionOverdue() {
  const now = Date.now()
  for (const address of POOLS) {
    const contract = new Contract(address, ABI, provider)
    const [ridValue, actionValue] = await contract.nextExecutable()
    const rid = String(ridValue)
    const action = Number(actionValue)
    const key = `${address}:${rid}:${action}`

    if (action === 0) {
      for (const existing of Object.keys(state.actionDueAlerts)) {
        if (existing.startsWith(`${address}:`)) delete state.actionDueAlerts[existing]
      }
      writeState()
      continue
    }

    const record = state.actionDueAlerts[key] || { firstSeenAt: now, lastAlertAt: 0 }
    state.actionDueAlerts[key] = record
    if (now - Number(record.firstSeenAt || now) < ACTION_OVERDUE_MS) {
      writeState()
      continue
    }
    if (now - Number(record.lastAlertAt || 0) < VRF_CHECK_MS) {
      writeState()
      continue
    }

    record.lastAlertAt = now
    writeState()
    await alert(`🚨 EverDraw keeper action overdue on ${poolLabel(address)}\nround=${rid}\naction=${actionName(action)}\noverdueMinutes=${Math.floor((now - Number(record.firstSeenAt || now)) / 60000)}\nExpected keeper executeNext() to clear this.`)
  }
}

async function loop(name, intervalMs, fn) {
  while (!stopping) {
    try {
      await fn()
    } catch (error) {
      log(`${name} failed: ${error?.stack || error?.message || error}`)
    }
    await sleep(intervalMs)
  }
}

process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })
process.on('uncaughtException', (error) => {
  log(`uncaught exception: ${error?.stack || error?.message || error}`)
  pingHealthcheckFail('uncaughtException').finally(() => {})
  process.exit(1)
})
process.on('unhandledRejection', (error) => {
  log(`unhandled rejection: ${error?.stack || error?.message || error}`)
  pingHealthcheckFail('unhandledRejection').finally(() => {})
  process.exit(1)
})

validateEnv()
log(`start pid=${process.pid} watching ${POOLS.length} pools canonicalPoolReconcile=${poolReconcile.strict} pollMs=${POLL_MS} stateFile=${STATE_FILE} fallback=${Boolean(RPC_URL_FALLBACK)} vrfThresholdMon=${VRF_LOW_THRESHOLD_MON} actionOverdueMs=${ACTION_OVERDUE_MS} healthcheck=${Boolean(HEALTHCHECK_URL)}`)
await sendTelegram(`✅ EverDraw governance alert watcher online\npools=${POOLS.length}\ntime=${ts()}`)
await pingHealthcheck(HEALTHCHECK_URL, 'start')
await scanOnce()
await checkVrfReserve()
await checkActionOverdue()

loop('scan', POLL_MS, async () => {
  const result = await scanOnce()
  if (result.scanned || result.alerts) log(`scan currentBlock=${result.currentBlock} scanned=${result.scanned} alerts=${result.alerts}`)
})
loop('vrf-reserve-check', VRF_CHECK_MS, checkVrfReserve)
loop('action-overdue-check', ACTION_OVERDUE_CHECK_MS, checkActionOverdue)
loop('heartbeat', HEARTBEAT_MS, async () => {
  log(`heartbeat watching ${POOLS.length} pools lastSeenBlock=${state.lastSeenBlock}`)
  await pingHealthcheck(HEALTHCHECK_URL, 'heartbeat')
})
