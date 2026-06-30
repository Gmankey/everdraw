#!/usr/bin/env node
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { JsonRpcProvider, Contract, formatEther } from 'ethers'
import { loadCanonicalKeeperPools, parseAddressList } from './keeper-active-pools.mjs'

const RPC_URL = process.env.RPC_URL || process.env.MONAD_MAINNET_RPC_URL || 'https://rpc.monad.xyz'
const EXPECTED_CHAIN_ID = Number(process.env.PROTOCOL_MONITOR_CHAIN_ID || '143')
const VRF_LOW_THRESHOLD_MON = Number(process.env.VRF_LOW_THRESHOLD_MON || '5')
const VRF_TIMEOUT_SEC = Number(process.env.VRF_TIMEOUT_SEC || '3600')
const HEALTHCHECK_URL = process.env.PROTOCOL_MONITOR_HEALTHCHECK_URL || ''
const HEALTHCHECK_FAIL_URL = process.env.PROTOCOL_MONITOR_HEALTHCHECK_FAIL_URL || ''
const ALERT_ON_ACTIONABLE = String(process.env.PROTOCOL_MONITOR_ALERT_ON_ACTIONABLE || 'true').toLowerCase() !== 'false'
const TIMEOUT_MS = Number(process.env.PROTOCOL_MONITOR_TIMEOUT_MS || '12000')
const ADMIN_LOOKBACK_BLOCKS = Number(process.env.PROTOCOL_MONITOR_ADMIN_LOOKBACK_BLOCKS || '7200')
const MONITOR_POOLS = String(process.env.PROTOCOL_MONITOR_SKIP_POOLS || 'false').toLowerCase() !== 'true'
const V5_VAULTS = parseAddressList(process.env.PROTOCOL_MONITOR_V5_VAULTS || process.env.V5_PRIZE_VAULT_ADDRESS || '')

const ABI = [
  'function paused() view returns (bool)',
  'function stoppedAt() view returns (uint64)',
  'function nextExecutable() view returns (uint256 rid, uint8 action)',
  'function currentRoundId() view returns (uint256)',
  'function getRoundState(uint256 rid) view returns (uint8)',
  'function getRoundTimes(uint256 rid) view returns (uint64 salesEndTime, uint64 vrfRequestTime)',
]

const V5_VAULT_ABI = [
  'function paused() view returns (bool)',
  'function stoppedAt() view returns (uint64)',
  'function depositCap() view returns (uint256)',
  'function pendingOwner() view returns (address)',
  'function pendingStrategy() view returns (address)',
  'function pendingStrategyEffectiveAt() view returns (uint64)',
  'function pendingDrawManager() view returns (address)',
  'function pendingDrawManagerEffectiveAt() view returns (uint64)',
  'event StrategyChangeQueued(address indexed strategy, uint64 effectiveAt)',
  'event DrawManagerChangeQueued(address indexed drawManager, uint64 effectiveAt)',
  'event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  'event Paused(address indexed by)',
  'event Unpaused(address indexed by)',
  'event VaultStopped(uint64 stoppedAt)',
  'event DepositCapUpdated(uint256 depositCap)',
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

export function eventArg(event, name, index) {
  return event?.args?.[name] ?? event?.args?.[index]
}

export function describeAdminEvent(event) {
  const name = event.fragment?.name || 'Unknown'
  if (name === 'StrategyChangeQueued') {
    return `queued strategy change: strategy=${eventArg(event, 'strategy', 0)} effectiveAt=${isoFromSeconds(eventArg(event, 'effectiveAt', 1))}`
  }
  if (name === 'DrawManagerChangeQueued') {
    return `queued draw-manager change: drawManager=${eventArg(event, 'drawManager', 0)} effectiveAt=${isoFromSeconds(eventArg(event, 'effectiveAt', 1))}`
  }
  if (name === 'OwnershipTransferStarted') {
    return `ownership transfer pending: previousOwner=${eventArg(event, 'previousOwner', 0)} pendingOwner=${eventArg(event, 'pendingOwner', 1)}`
  }
  if (name === 'OwnershipTransferred') {
    return `ownership accepted: previousOwner=${eventArg(event, 'previousOwner', 0)} newOwner=${eventArg(event, 'newOwner', 1)}`
  }
  if (name === 'Paused') return `vault paused: by=${eventArg(event, 'by', 0)}`
  if (name === 'Unpaused') return `vault unpaused: by=${eventArg(event, 'by', 0)}`
  if (name === 'VaultStopped') return `vault stopped: stoppedAt=${isoFromSeconds(eventArg(event, 'stoppedAt', 0))}`
  if (name === 'DepositCapUpdated') return `deposit cap changed: depositCap=${formatEther(eventArg(event, 'depositCap', 0) || 0n)} MON`
  return `admin event ${name}`
}

async function queryAdminEvents(contract, fromBlock, toBlock) {
  const filters = [
    contract.filters.StrategyChangeQueued(),
    contract.filters.DrawManagerChangeQueued(),
    contract.filters.OwnershipTransferStarted(),
    contract.filters.OwnershipTransferred(),
    contract.filters.Paused(),
    contract.filters.Unpaused(),
    contract.filters.VaultStopped(),
    contract.filters.DepositCapUpdated(),
  ]
  const batches = await Promise.all(filters.map((filter) => contract.queryFilter(filter, fromBlock, toBlock).catch((err) => {
    throw new Error(`query ${filter.fragment?.name || filter.topics?.[0]} failed: ${err?.message || err}`)
  })))
  return batches.flat().sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
    return a.index - b.index
  })
}

async function inspectV5Vault(provider, address, fromBlock, toBlock) {
  const contract = new Contract(address, V5_VAULT_ABI, provider)
  const [
    code,
    paused,
    stoppedAt,
    depositCap,
    pendingOwner,
    pendingStrategy,
    pendingStrategyEffectiveAt,
    pendingDrawManager,
    pendingDrawManagerEffectiveAt,
    events,
  ] = await Promise.all([
    provider.getCode(address),
    contract.paused().catch(() => false),
    contract.stoppedAt().catch(() => 0n),
    contract.depositCap().catch(() => 0n),
    contract.pendingOwner().catch(() => '0x0000000000000000000000000000000000000000'),
    contract.pendingStrategy().catch(() => '0x0000000000000000000000000000000000000000'),
    contract.pendingStrategyEffectiveAt().catch(() => 0n),
    contract.pendingDrawManager().catch(() => '0x0000000000000000000000000000000000000000'),
    contract.pendingDrawManagerEffectiveAt().catch(() => 0n),
    queryAdminEvents(contract, fromBlock, toBlock),
  ])

  const failures = []
  if (!code || code === '0x') failures.push('no runtime bytecode')
  if (paused) failures.push('vault currently paused')
  if (Number(stoppedAt) !== 0) failures.push(`vault stopped at ${isoFromSeconds(stoppedAt)}`)
  if (pendingOwner !== '0x0000000000000000000000000000000000000000') {
    failures.push(`ownership transfer pending: pendingOwner=${pendingOwner}`)
  }
  if (Number(pendingStrategyEffectiveAt) !== 0) {
    failures.push(`strategy change pending: strategy=${pendingStrategy} effectiveAt=${isoFromSeconds(pendingStrategyEffectiveAt)}`)
  }
  if (Number(pendingDrawManagerEffectiveAt) !== 0) {
    failures.push(`draw-manager change pending: drawManager=${pendingDrawManager} effectiveAt=${isoFromSeconds(pendingDrawManagerEffectiveAt)}`)
  }
  failures.push(...events.map((event) => `${describeAdminEvent(event)} block=${event.blockNumber} tx=${event.transactionHash}`))

  return {
    address,
    paused,
    stoppedAt: Number(stoppedAt),
    depositCapMon: formatEther(depositCap),
    pendingOwner,
    pendingStrategy,
    pendingStrategyEffectiveAt: Number(pendingStrategyEffectiveAt),
    pendingDrawManager,
    pendingDrawManagerEffectiveAt: Number(pendingDrawManagerEffectiveAt),
    fromBlock,
    toBlock,
    eventCount: events.length,
    failures,
  }
}

function formatReport(results, v5Results, failures) {
  const lines = [
    `EverDraw protocol monitor ${failures.length ? 'FAIL' : 'OK'} at ${ts()}`,
    `rpc=${RPC_URL}`,
    `pools=${results.length}`,
    `v5Vaults=${v5Results.length}`,
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
  for (const result of v5Results) {
    lines.push(
      [
        `V5 ${result.address}`,
        `cap=${result.depositCapMon} MON`,
        `paused=${result.paused}`,
        `stoppedAt=${isoFromSeconds(result.stoppedAt)}`,
        `events=${result.eventCount}`,
        `blocks=${result.fromBlock}-${result.toBlock}`,
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

  const results = []
  if (MONITOR_POOLS) {
    const pools = loadCanonicalKeeperPools()
    for (const address of pools) {
      results.push(await inspectPool(provider, address))
    }
  }
  const latestBlock = await provider.getBlockNumber()
  const fromBlock = Math.max(0, latestBlock - ADMIN_LOOKBACK_BLOCKS)
  const v5Results = []
  for (const address of V5_VAULTS) {
    v5Results.push(await inspectV5Vault(provider, address, fromBlock, latestBlock))
  }

  const failures = [
    ...results.flatMap((result) => result.failures.map((failure) => `${result.address}: ${failure}`)),
    ...v5Results.flatMap((result) => result.failures.map((failure) => `${result.address}: ${failure}`)),
  ]
  const report = formatReport(results, v5Results, failures)
  console.log(report)

  if (failures.length) {
    await pingFail(report)
    process.exit(1)
  }

  await pingOk(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    const msg = `EverDraw protocol monitor CRASH at ${ts()}\n${err?.stack || err?.message || err}`
    console.error(msg)
    await pingFail(msg)
    process.exit(1)
  })
}
