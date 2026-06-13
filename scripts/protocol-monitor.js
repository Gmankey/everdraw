#!/usr/bin/env node
import 'dotenv/config'
import { JsonRpcProvider, Contract, formatEther } from 'ethers'
import { loadCanonicalKeeperPools } from './keeper-active-pools.mjs'

const RPC_URL = process.env.RPC_URL || process.env.MONAD_MAINNET_RPC_URL || 'https://rpc.monad.xyz'
const EXPECTED_CHAIN_ID = Number(process.env.PROTOCOL_MONITOR_CHAIN_ID || '143')
const VRF_LOW_THRESHOLD_MON = Number(process.env.VRF_LOW_THRESHOLD_MON || '5')
const VRF_TIMEOUT_SEC = Number(process.env.VRF_TIMEOUT_SEC || '3600')
const HEALTHCHECK_URL = process.env.PROTOCOL_MONITOR_HEALTHCHECK_URL || ''
const HEALTHCHECK_FAIL_URL = process.env.PROTOCOL_MONITOR_HEALTHCHECK_FAIL_URL || ''
const ALERT_ON_ACTIONABLE = String(process.env.PROTOCOL_MONITOR_ALERT_ON_ACTIONABLE || 'true').toLowerCase() !== 'false'
const TIMEOUT_MS = Number(process.env.PROTOCOL_MONITOR_TIMEOUT_MS || '12000')

const ABI = [
  'function paused() view returns (bool)',
  'function stoppedAt() view returns (uint64)',
  'function nextExecutable() view returns (uint256 rid, uint8 action)',
  'function currentRoundId() view returns (uint256)',
  'function getRoundState(uint256 rid) view returns (uint8)',
  'function getRoundTimes(uint256 rid) view returns (uint64 salesEndTime, uint64 vrfRequestTime)',
]

const ACTION_NAMES = {
  0: 'None',
  1: 'Skip',
  2: 'Commit',
  3: 'Finalize',
}

const STATE_NAMES = {
  0: 'Open',
  1: 'AwaitingVRF',
  2: 'Drawn',
  3: 'Settled',
}

function ts() {
  return new Date().toISOString()
}

function isoFromSeconds(value) {
  const n = Number(value)
  if (!n) return 'n/a'
  return new Date(n * 1000).toISOString()
}

async function pingHealthcheck(url, status, body) {
  if (!url) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    console.error(`${ts()} [protocol-monitor] healthcheck ${status} ping failed: ${err?.message || err}`)
  } finally {
    clearTimeout(timeout)
  }
}

async function pingOk(body) {
  await pingHealthcheck(HEALTHCHECK_URL, 'ok', body)
}

async function pingFail(body) {
  if (HEALTHCHECK_FAIL_URL) {
    await pingHealthcheck(HEALTHCHECK_FAIL_URL, 'fail', body)
    return
  }
  if (!HEALTHCHECK_URL) return
  await pingHealthcheck(`${HEALTHCHECK_URL.replace(/\/$/, '')}/fail`, 'fail', body)
}

async function inspectPool(provider, address) {
  const contract = new Contract(address, ABI, provider)
  const [code, balance, paused, stoppedAt, next, ridValue] = await Promise.all([
    provider.getCode(address),
    provider.getBalance(address),
    contract.paused().catch(() => false),
    contract.stoppedAt().catch(() => 0n),
    contract.nextExecutable(),
    contract.currentRoundId(),
  ])

  const rid = Number(ridValue)
  const state = Number(await contract.getRoundState(rid))
  const [salesEndTime, vrfRequestTime] = await contract.getRoundTimes(rid)
  const action = Number(next[1])
  const nextRid = Number(next[0])
  const reserveMon = Number(formatEther(balance))
  const commitDue = Number(salesEndTime) ? Number(salesEndTime) + 518100 : 0
  const nowSec = Math.floor(Date.now() / 1000)

  const failures = []
  if (!code || code === '0x') failures.push('no runtime bytecode')
  if (reserveMon < VRF_LOW_THRESHOLD_MON) {
    failures.push(`VRF reserve ${reserveMon.toFixed(4)} MON below ${VRF_LOW_THRESHOLD_MON}`)
  }
  if (ALERT_ON_ACTIONABLE && action !== 0 && Number(stoppedAt) === 0 && !paused) {
    failures.push(`keeper action pending: round=${nextRid} action=${ACTION_NAMES[action] || action}`)
  }
  if (state === 1 && Number(vrfRequestTime) > 0 && nowSec - Number(vrfRequestTime) >= VRF_TIMEOUT_SEC) {
    failures.push(`VRF timeout: round=${rid} awaiting callback for ${Math.floor((nowSec - Number(vrfRequestTime)) / 60)}m`)
  }

  return {
    address,
    reserveMon,
    paused,
    stoppedAt: Number(stoppedAt),
    currentRoundId: rid,
    state,
    stateName: STATE_NAMES[state] || `Unknown(${state})`,
    salesEndAt: isoFromSeconds(salesEndTime),
    commitDueAt: isoFromSeconds(commitDue),
    vrfRequestAt: isoFromSeconds(vrfRequestTime),
    nextRoundId: nextRid,
    nextAction: action,
    nextActionName: ACTION_NAMES[action] || `Unknown(${action})`,
    failures,
  }
}

function formatReport(results, failures) {
  const lines = [
    `EverDraw protocol monitor ${failures.length ? 'FAIL' : 'OK'} at ${ts()}`,
    `rpc=${RPC_URL}`,
    `pools=${results.length}`,
    '',
  ]
  for (const result of results) {
    lines.push(
      [
        result.address,
        `reserve=${result.reserveMon.toFixed(4)} MON`,
        `round=${result.currentRoundId}`,
        `state=${result.stateName}`,
        `next=${result.nextActionName}`,
        `salesEnd=${result.salesEndAt}`,
        `commitDue=${result.commitDueAt}`,
        result.failures.length ? `FAIL=${result.failures.join('; ')}` : 'ok',
      ].join(' | '),
    )
  }
  return lines.join('\n')
}

async function main() {
  const provider = new JsonRpcProvider(RPC_URL)
  const network = await provider.getNetwork()
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(`wrong chainId: got ${network.chainId}, expected ${EXPECTED_CHAIN_ID}`)
  }

  const pools = loadCanonicalKeeperPools()
  const results = []
  for (const address of pools) {
    results.push(await inspectPool(provider, address))
  }

  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.address}: ${failure}`))
  const report = formatReport(results, failures)
  console.log(report)

  if (failures.length) {
    await pingFail(report)
    process.exit(1)
  }

  await pingOk(report)
}

main().catch(async (err) => {
  const msg = `EverDraw protocol monitor CRASH at ${ts()}\n${err?.stack || err?.message || err}`
  console.error(msg)
  await pingFail(msg)
  process.exit(1)
})
