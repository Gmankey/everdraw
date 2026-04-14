import { useCallback, useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { modal } from './walletModal'

export const SHMON_ADDRESS = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
const PENDING_KEY = 'everdraw:shmon:pending'
export const EPOCH_SECONDS_ESTIMATE = 20 * 60 * 60
const EVENT_SCAN_BLOCKS = 120_000n

const SHMON_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256 assets)',
  'function previewRedeem(uint256 shares) view returns (uint256 assets)',
  'function requestUnstake(uint256 shares) returns (uint64 completionEpoch)',
  'function completeUnstake()',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  'function getInternalEpoch() view returns (uint64)',
  'event RequestUnstake(address indexed owner, uint256 shares, uint256 amountMon, uint256 completionEpoch)'
]

function getWalletProvider() {
  return modal.getWalletProvider() || window.ethereum || null
}

async function fetchNonce(address) {
  const rpcUrl = import.meta.env.VITE_RPC_URL || 'https://rpc.monad.xyz'
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'eth_getTransactionCount',
          params: [address.toLowerCase(), 'pending']
        })
      })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 700 * (i + 1)))
        continue
      }
      const json = await res.json()
      const n = parseInt(json.result, 16)
      if (!isNaN(n) && n >= 0) return n
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('Could not fetch nonce, RPC rate limited, try again in a few seconds')
}

function loadPendingMap() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function savePendingMap(map) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(map))
  } catch {}
}

function getPendingFor(address) {
  const map = loadPendingMap()
  return map[address?.toLowerCase?.() || ''] || null
}

function setPendingFor(address, pending) {
  const map = loadPendingMap()
  const key = address?.toLowerCase?.() || ''
  if (!key) return
  if (pending) map[key] = pending
  else delete map[key]
  savePendingMap(map)
}

function shortError(error) {
  const msg = error?.reason || error?.shortMessage || error?.message || 'Unknown error'
  const low = String(msg).toLowerCase()
  if (low.includes('user denied') || low.includes('rejected') || error?.code === 4001) return 'Transaction rejected'
  return msg
}

async function scanPendingFromEvents(contract, account) {
  if (!account) return null
  const provider = contract.runner?.provider
  if (!provider) return null

  const latestBlock = BigInt(await provider.getBlockNumber())
  const fromBlock = latestBlock > EVENT_SCAN_BLOCKS ? latestBlock - EVENT_SCAN_BLOCKS : 0n
  const events = await contract.queryFilter(contract.filters.RequestUnstake(account), Number(fromBlock), Number(latestBlock))
  const latestEvent = events.at(-1)
  if (!latestEvent) return null

  return {
    shares: latestEvent.args.shares.toString(),
    amountMon: latestEvent.args.amountMon.toString(),
    createdAt: Date.now(),
    completionEpoch: latestEvent.args.completionEpoch.toString(),
  }
}

export function formatUnits(value, digits = 4) {
  try {
    return Number(ethers.formatEther(value || 0n)).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    })
  } catch {
    return '0'
  }
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'ready now'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

export function useShmon({ account, expectedChainId, getReadProvider, ensureCorrectNetwork }) {
  const [state, setState] = useState({
    loading: false,
    error: '',
    balance: 0n,
    monEquivalent: 0n,
    previewRedeem: 0n,
    epoch: null,
    pending: null,
    txBusy: false,
    success: '',
  })

  const normalizePending = useCallback((pending, epochValue = null) => {
    if (!pending) return null
    const completionEpoch = BigInt(pending.completionEpoch)
    return {
      ...pending,
      isReady: epochValue == null ? false : BigInt(epochValue) >= completionEpoch,
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!account) {
      setState((s) => ({ ...s, loading: false, error: '', balance: 0n, monEquivalent: 0n, previewRedeem: 0n, epoch: null, pending: null }))
      return
    }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const provider = await getReadProvider()
      const contract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, provider)

      const balance = await contract.balanceOf(account)

      const epochResult = await contract.getInternalEpoch()
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, error }))
      const epoch = epochResult.ok ? epochResult.value : null

      const assetsResult = balance > 0n
        ? await Promise.allSettled([
            contract.convertToAssets(balance),
            contract.previewRedeem(balance),
          ])
        : []
      const monEquivalent = balance > 0n && assetsResult[0]?.status === 'fulfilled' ? assetsResult[0].value : 0n
      const previewRedeem = balance > 0n && assetsResult[1]?.status === 'fulfilled' ? assetsResult[1].value : 0n

      let pending = getPendingFor(account)
      if (!pending && epoch != null) {
        pending = await scanPendingFromEvents(contract, account).catch(() => null)
        if (pending) setPendingFor(account, pending)
      }
      const normalizedPending = normalizePending(pending, epoch)

      let softError = ''
      if (!epochResult.ok) {
        softError = 'Internal epoch unavailable right now. Balance is still shown, but scheduled-unstake readiness may be temporarily unavailable.'
      }

      setState((s) => ({
        ...s,
        loading: false,
        error: softError,
        balance,
        monEquivalent,
        previewRedeem,
        epoch: epoch == null ? null : Number(epoch),
        pending: normalizedPending,
      }))
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: shortError(error) }))
    }
  }, [account, getReadProvider, normalizePending])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!account) return
    const id = window.setInterval(() => {
      refresh()
    }, 30000)
    return () => window.clearInterval(id)
  }, [account, refresh])

  const requestUnstake = useCallback(async (shares) => {
    const walletProvider = getWalletProvider()
    if (!walletProvider) throw new Error('Connect wallet first')
    const provider = new ethers.BrowserProvider(walletProvider)
    await ensureCorrectNetwork(provider, expectedChainId)
    const signer = await provider.getSigner(account)
    const nonce = await fetchNonce(account)
    const contract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, signer)

    setState((s) => ({ ...s, txBusy: true, error: '', success: '' }))
    try {
      const currentEpoch = await contract.getInternalEpoch()
      const tx = await contract.requestUnstake(shares, { nonce })
      const receipt = await tx.wait()
      let completionEpoch = (currentEpoch + 1n).toString()
      let amountMon = null
      let parsedEvent = false
      const iface = contract.interface
      for (const log of receipt.logs || []) {
        try {
          const parsed = iface.parseLog(log)
          if (parsed?.name === 'RequestUnstake') {
            completionEpoch = parsed.args.completionEpoch.toString()
            amountMon = parsed.args.amountMon.toString()
            parsedEvent = true
            break
          }
        } catch {}
      }
      if (!parsedEvent) {
        console.warn('[shMON] RequestUnstake event parse failed, falling back to currentEpoch + 1. Check ABI drift.')
      }
      const pending = normalizePending({
        shares: shares.toString(),
        amountMon,
        createdAt: Date.now(),
        completionEpoch,
      }, currentEpoch)
      setPendingFor(account, pending)
      setState((s) => ({ ...s, txBusy: false, success: 'Scheduled unstake requested.' }))
      await refresh()
      return pending
    } catch (error) {
      setState((s) => ({ ...s, txBusy: false, error: shortError(error) }))
      throw error
    }
  }, [account, ensureCorrectNetwork, expectedChainId, normalizePending, refresh])

  const instantRedeem = useCallback(async (shares) => {
    const walletProvider = getWalletProvider()
    if (!walletProvider) throw new Error('Connect wallet first')
    const provider = new ethers.BrowserProvider(walletProvider)
    await ensureCorrectNetwork(provider, expectedChainId)
    const signer = await provider.getSigner(account)
    const nonce = await fetchNonce(account)
    const contract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, signer)

    setState((s) => ({ ...s, txBusy: true, error: '', success: '' }))
    try {
      const tx = await contract.redeem(shares, account, account, { nonce })
      await tx.wait()
      setState((s) => ({ ...s, txBusy: false, success: 'Instant unstake completed.' }))
      await refresh()
    } catch (error) {
      setState((s) => ({ ...s, txBusy: false, error: shortError(error) }))
      throw error
    }
  }, [account, ensureCorrectNetwork, expectedChainId, refresh])

  const completeUnstake = useCallback(async () => {
    const walletProvider = getWalletProvider()
    if (!walletProvider) throw new Error('Connect wallet first')
    const provider = new ethers.BrowserProvider(walletProvider)
    await ensureCorrectNetwork(provider, expectedChainId)
    const signer = await provider.getSigner(account)
    const nonce = await fetchNonce(account)
    const contract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, signer)

    setState((s) => ({ ...s, txBusy: true, error: '', success: '' }))
    try {
      const tx = await contract.completeUnstake({ nonce })
      await tx.wait()
      setPendingFor(account, null)
      setState((s) => ({ ...s, txBusy: false, success: 'Scheduled unstake completed.' }))
      await refresh()
    } catch (error) {
      setState((s) => ({ ...s, txBusy: false, error: shortError(error) }))
      throw error
    }
  }, [account, ensureCorrectNetwork, expectedChainId, refresh])

  const previewScheduledAssets = useCallback(async (shares) => {
    const provider = await getReadProvider()
    const contract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, provider)
    return contract.convertToAssets(shares)
  }, [getReadProvider])

  const previewInstantAssets = useCallback(async (shares) => {
    const provider = await getReadProvider()
    const contract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, provider)
    return contract.previewRedeem(shares)
  }, [getReadProvider])

  const pendingSummary = useMemo(() => {
    if (!state.pending || state.epoch == null) return null
    const completionEpoch = BigInt(state.pending.completionEpoch)
    const currentEpoch = BigInt(state.epoch)
    const epochsRemainingBig = completionEpoch > currentEpoch ? completionEpoch - currentEpoch : 0n
    const epochsRemaining = epochsRemainingBig > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(epochsRemainingBig)
    return {
      shares: BigInt(state.pending.shares),
      amountMon: state.pending.amountMon ? BigInt(state.pending.amountMon) : null,
      completionEpoch,
      epochsRemaining,
      secondsRemaining: epochsRemaining * EPOCH_SECONDS_ESTIMATE,
      isReady: Boolean(state.pending.isReady),
    }
  }, [state.pending, state.epoch])

  return {
    ...state,
    pendingSummary,
    refresh,
    requestUnstake,
    instantRedeem,
    completeUnstake,
    previewScheduledAssets,
    previewInstantAssets,
  }
}

// PM decision, 2026-04-08:
// Scheduled unstake is single-slot reset semantics.
// If a wallet already has pending shMON unstaking, a new requestUnstake must be treated as destructive:
// it resets the timer on the full pending amount. Keep the UI warning copy aligned with that PM note.
