import { useCallback, useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { modal } from './walletModal.ts'
import './V5UatApp.css'

const DEFAULTS = {
  chainId: 10143,
  rpcUrl: 'https://testnet-rpc.monad.xyz',
  drawManager: '0x58502275bE5d5e998fE8318eC6343a0bc2A81C7c',
  prizeVault: '0x5dB2AA29ACf832baf43d10BAEd6ff53a23549f10',
  twabController: '0x165A546828e122935DE6B96ec894Ef14705194d7',
  claimManager: '0x885b117Dd7268bc8F26F5800330900d2Fb3dD1ac',
}

const VAULT_ABI = [
  'function deposit() payable returns (uint256)',
  'function withdraw(uint256 amount) returns (uint256)',
  'function boostDeposit() payable returns (uint256)',
  'function boostWithdraw(uint256 amount) returns (uint256)',
  'function principalOf(address) view returns (uint256)',
  'function boosterPrincipalOf(address) view returns (uint256)',
  'function totalPrincipal() view returns (uint256)',
  'function totalParticipantPrincipal() view returns (uint256)',
  'function totalBoosterPrincipal() view returns (uint256)',
  'function availableYield() view returns (uint256)',
  'function paused() view returns (bool)',
  'function stoppedAt() view returns (uint64)',
]

const DRAW_MANAGER_ABI = [
  'function currentDrawId() view returns (uint256)',
  'function nextPeriodStart() view returns (uint64)',
  'function drawPeriod() view returns (uint64)',
  'function previewStartDraw() view returns (bool due,bool willSkip,uint256 requiredFee)',
  'function draws(uint256) view returns (uint64 periodStart,uint64 periodEnd,uint64 randomnessRequestId,bytes32 seed,uint256 totalTwab,uint256 totalPayout,uint32 winnerCount,uint32 rewardLegCount,bytes32 root,uint64 proposedAt,address proposer,uint8 status,uint256 grossYield,uint256 sponsorYield,uint256 feeAmount)',
]

const TWAB_ABI = [
  'function getTotalTwabBetween(address vault,uint256 startTime,uint256 endTime) view returns (uint256)',
  'function getDelegateTwabBetween(address vault,address delegate,uint256 startTime,uint256 endTime) view returns (uint256)',
  'function BOOSTER_DELEGATE() view returns (address)',
]

const CLAIM_MANAGER_ABI = [
  'function claimMany(tuple(bytes32 distributionId,uint256 leafIndex,address account,address token,uint256 amount)[] leaves, bytes32[][] proofs)',
  'function isClaimed(bytes32 distributionId,uint256 leafIndex) view returns (bool)',
]

const STATUS_LABELS = ['None', 'Awaiting Seed', 'Seeded', 'Proposed', 'Finalized', 'Skipped']

function envAddress(name, fallback) {
  const value = import.meta.env[name] || fallback
  return ethers.isAddress(value) ? value : fallback
}

function config() {
  return {
    chainId: Number(import.meta.env.VITE_CHAIN_ID || DEFAULTS.chainId),
    rpcUrl: import.meta.env.VITE_RPC_URL || DEFAULTS.rpcUrl,
    drawManager: envAddress('VITE_V5_DRAW_MANAGER_ADDRESS', DEFAULTS.drawManager),
    prizeVault: envAddress('VITE_V5_PRIZE_VAULT_ADDRESS', DEFAULTS.prizeVault),
    twabController: envAddress('VITE_V5_TWAB_CONTROLLER_ADDRESS', DEFAULTS.twabController),
    claimManager: envAddress('VITE_V5_CLAIM_MANAGER_ADDRESS', DEFAULTS.claimManager),
  }
}

function getWalletProvider() {
  return modal.getWalletProvider() || window.ethereum || null
}

function fmt(value, digits = 4) {
  try {
    return Number(ethers.formatEther(value || 0n)).toFixed(digits)
  } catch {
    return '0.0000'
  }
}

function short(addr) {
  if (!addr || !ethers.isAddress(addr)) return 'Not connected'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function parseMon(value) {
  const clean = String(value || '').trim()
  if (!clean || Number(clean) <= 0) throw new Error('Enter an amount greater than zero')
  return ethers.parseEther(clean)
}

async function switchToChain(provider, chainId, rpcUrl) {
  const hexChainId = `0x${Number(chainId).toString(16)}`
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] })
  } catch (err) {
    if (err?.code !== 4902) throw err
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hexChainId,
        chainName: 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        rpcUrls: [rpcUrl],
        blockExplorerUrls: ['https://testnet.monadexplorer.com'],
      }],
    })
  }
}

function Metric({ label, value, sub }) {
  return (
    <div className="v5-uat-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  )
}

export default function V5UatApp() {
  const cfg = useMemo(config, [])
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState('1')
  const [boostAmount, setBoostAmount] = useState('1')
  const [claimJson, setClaimJson] = useState('')
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const readProvider = useMemo(() => new ethers.JsonRpcProvider(cfg.rpcUrl), [cfg.rpcUrl])
  const vault = useMemo(() => new ethers.Contract(cfg.prizeVault, VAULT_ABI, readProvider), [cfg.prizeVault, readProvider])
  const manager = useMemo(() => new ethers.Contract(cfg.drawManager, DRAW_MANAGER_ABI, readProvider), [cfg.drawManager, readProvider])
  const twab = useMemo(() => new ethers.Contract(cfg.twabController, TWAB_ABI, readProvider), [cfg.twabController, readProvider])

  const refresh = useCallback(async (targetAccount = account) => {
    setError('')
    const [
      block,
      currentDrawId,
      nextPeriodStart,
      drawPeriod,
      preview,
      totalPrincipal,
      totalParticipantPrincipal,
      availableYield,
      paused,
      stoppedAt,
      code,
    ] = await Promise.all([
      readProvider.getBlock('latest'),
      manager.currentDrawId(),
      manager.nextPeriodStart(),
      manager.drawPeriod(),
      manager.previewStartDraw().catch(() => null),
      vault.totalPrincipal(),
      vault.totalParticipantPrincipal(),
      vault.availableYield(),
      vault.paused(),
      vault.stoppedAt(),
      readProvider.getCode(cfg.prizeVault),
    ])

    const draw = currentDrawId > 0n ? await manager.draws(currentDrawId).catch(() => null) : null
    const boosterDelegate = await twab.BOOSTER_DELEGATE().catch(() => ethers.ZeroAddress)
    let boosterTwab = 0n
    if (draw && boosterDelegate !== ethers.ZeroAddress) {
      boosterTwab = await twab.getDelegateTwabBetween(cfg.prizeVault, boosterDelegate, draw.periodStart, draw.periodEnd).catch(() => 0n)
    }

    const user = ethers.isAddress(targetAccount || '') ? targetAccount : ''
    const [principal, boosterPrincipal, balance] = user ? await Promise.all([
      vault.principalOf(user).catch(() => 0n),
      vault.boosterPrincipalOf(user).catch(() => null),
      readProvider.getBalance(user).catch(() => 0n),
    ]) : [0n, 0n, 0n]

    setState({
      block,
      currentDrawId,
      nextPeriodStart,
      drawPeriod,
      preview,
      draw,
      totalPrincipal,
      totalParticipantPrincipal,
      totalBoosterPrincipal: await vault.totalBoosterPrincipal().catch(() => null),
      availableYield,
      paused,
      stoppedAt,
      principal,
      boosterPrincipal,
      balance,
      boosterTwab,
      boosterSupported: code !== '0x' && boosterPrincipal !== null,
    })
  }, [account, cfg.prizeVault, manager, readProvider, twab, vault])

  useEffect(() => {
    refresh().catch((err) => setError(err?.message || String(err)))
    const id = setInterval(() => refresh().catch(() => {}), 20_000)
    return () => clearInterval(id)
  }, [refresh])

  const connect = useCallback(async () => {
    setError('')
    await modal.open()
    const provider = getWalletProvider()
    if (!provider) return
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    const next = accounts?.[0] || ''
    setAccount(next)
    await switchToChain(provider, cfg.chainId, cfg.rpcUrl)
    await refresh(next)
  }, [cfg.chainId, cfg.rpcUrl, refresh])

  const transact = useCallback(async (label, fn) => {
    setBusy(label)
    setMessage('')
    setError('')
    try {
      const provider = getWalletProvider()
      if (!provider) throw new Error('Connect wallet first')
      await switchToChain(provider, cfg.chainId, cfg.rpcUrl)
      const browserProvider = new ethers.BrowserProvider(provider)
      const signer = await browserProvider.getSigner()
      const tx = await fn(signer)
      setMessage(`${label} submitted: ${tx.hash}`)
      const receipt = await tx.wait()
      setMessage(`${label} mined: ${receipt.hash}`)
      const signerAddress = await signer.getAddress()
      setAccount(signerAddress)
      await refresh(signerAddress)
    } catch (err) {
      setError(err?.shortMessage || err?.message || String(err))
    } finally {
      setBusy('')
    }
  }, [cfg.chainId, cfg.rpcUrl, refresh])

  const claimFromJson = useCallback(async (signer) => {
    const parsed = JSON.parse(claimJson)
    const leaves = parsed.leaves || parsed.claims || (parsed.leaf ? [parsed.leaf] : [])
    const proofs = parsed.proofs || leaves.map((leaf) => leaf.proof || [])
    if (!Array.isArray(leaves) || leaves.length === 0) throw new Error('Paste JSON with leaves/claims and proofs')
    const normalized = leaves.map((leaf) => ({
      distributionId: leaf.distributionId,
      leafIndex: leaf.leafIndex,
      account: leaf.account,
      token: leaf.token,
      amount: leaf.amount,
    }))
    const claims = new ethers.Contract(cfg.claimManager, CLAIM_MANAGER_ABI, signer)
    return claims.claimMany(normalized, proofs)
  }, [cfg.claimManager, claimJson])

  const draw = state?.draw
  const now = Number(state?.block?.timestamp || 0)
  const periodEnd = Number((state?.nextPeriodStart || 0n) + (state?.drawPeriod || 0n))
  const nextAction = state?.preview
    ? state.preview.due ? (state.preview.willSkip ? 'Draw due: will skip' : `Draw due: fee ${fmt(state.preview.requiredFee)} MON`) : 'Draw not due'
    : 'Preview unavailable'

  return (
    <main className="v5-uat-shell">
      <section className="v5-uat-banner">
        <div>
          <p className="v5-uat-eyebrow">V5 TESTNET UAT ONLY</p>
          <h1>EverDraw V5 UAT</h1>
          <p>Separate Vercel project, Monad testnet contracts, no production envs or domains.</p>
        </div>
        <button className="v5-uat-btn" onClick={connect}>{account ? short(account) : 'Connect wallet'}</button>
      </section>

      <section className="v5-uat-warning">
        <strong>Not production.</strong> Use testnet MON only. Degen/Prize Booster actions require a vault deployed with ADR-0040 booster functions.
      </section>

      <section className="v5-uat-grid">
        <Metric label="Draw Manager" value={short(cfg.drawManager)} sub={cfg.drawManager} />
        <Metric label="Prize Vault" value={short(cfg.prizeVault)} sub={cfg.prizeVault} />
        <Metric label="Claim Manager" value={short(cfg.claimManager)} sub={cfg.claimManager} />
        <Metric label="Chain" value={`Monad testnet ${cfg.chainId}`} sub={cfg.rpcUrl} />
      </section>

      <section className="v5-uat-grid">
        <Metric label="Total Principal" value={`${fmt(state?.totalPrincipal)} MON`} />
        <Metric label="Participant Principal" value={`${fmt(state?.totalParticipantPrincipal)} MON`} />
        <Metric label="Degen Principal" value={state?.totalBoosterPrincipal === null ? 'Unsupported' : `${fmt(state?.totalBoosterPrincipal)} MON`} />
        <Metric label="Available Prize Yield" value={`${fmt(state?.availableYield)} MON`} />
        <Metric label="Current Draw" value={state?.currentDrawId?.toString() || '...'} sub={draw ? STATUS_LABELS[Number(draw.status)] || 'Unknown' : nextAction} />
        <Metric label="Next Period End" value={periodEnd ? new Date(periodEnd * 1000).toLocaleString() : '...'} sub={`now ${new Date(now * 1000).toLocaleTimeString()}`} />
      </section>

      {!state?.boosterSupported ? (
        <section className="v5-uat-warning danger">
          The configured vault does not expose booster reads. Degen-pool UI is built here, but this address likely needs an ADR-0040 redeploy before boost deposit/withdraw can work.
        </section>
      ) : null}

      <section className="v5-uat-actions">
        <div className="v5-uat-card">
          <h2>Participant Vault</h2>
          <p>Odds-bearing V5 principal. Deposits can win; withdrawals stay live.</p>
          <label>Amount MON</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          <div className="v5-uat-row">
            <button className="v5-uat-btn" disabled={Boolean(busy)} onClick={() => transact('Deposit', (signer) => new ethers.Contract(cfg.prizeVault, VAULT_ABI, signer).deposit({ value: parseMon(amount) }))}>Deposit</button>
            <button className="v5-uat-btn secondary" disabled={Boolean(busy)} onClick={() => transact('Withdraw', (signer) => new ethers.Contract(cfg.prizeVault, VAULT_ABI, signer).withdraw(parseMon(amount)))}>Withdraw</button>
          </div>
          <Metric label="Your Participant Principal" value={`${fmt(state?.principal)} MON`} sub={`wallet balance ${fmt(state?.balance)} MON`} />
        </div>

        <div className="v5-uat-card booster">
          <h2>Degen Pool / Prize Booster</h2>
          <p>Zero win odds. Principal withdrawable. Yield goes to the public prize; points campaign is off-chain.</p>
          <label>Amount MON</label>
          <input value={boostAmount} onChange={(e) => setBoostAmount(e.target.value)} inputMode="decimal" />
          <div className="v5-uat-row">
            <button className="v5-uat-btn" disabled={Boolean(busy) || !state?.boosterSupported} onClick={() => transact('Boost deposit', (signer) => new ethers.Contract(cfg.prizeVault, VAULT_ABI, signer).boostDeposit({ value: parseMon(boostAmount) }))}>Boost Deposit</button>
            <button className="v5-uat-btn secondary" disabled={Boolean(busy) || !state?.boosterSupported} onClick={() => transact('Boost withdraw', (signer) => new ethers.Contract(cfg.prizeVault, VAULT_ABI, signer).boostWithdraw(parseMon(boostAmount)))}>Boost Withdraw</button>
          </div>
          <Metric label="Your Degen Principal" value={state?.boosterPrincipal === null ? 'Unsupported' : `${fmt(state?.boosterPrincipal)} MON`} sub={`current draw booster TWAB ${fmt(state?.boosterTwab)} MON`} />
        </div>

        <div className="v5-uat-card">
          <h2>Claim</h2>
          <p>Paste a ClaimManager leaf/proof JSON from the keeper or indexer to self-claim finalized V5 prizes.</p>
          <textarea value={claimJson} onChange={(e) => setClaimJson(e.target.value)} placeholder='{"leaves":[...],"proofs":[...]}' />
          <button className="v5-uat-btn" disabled={Boolean(busy) || !claimJson.trim()} onClick={() => transact('Claim', claimFromJson)}>Claim Many</button>
        </div>
      </section>

      <section className="v5-uat-log">
        {busy ? <p>Working: {busy}</p> : null}
        {message ? <p>{message}</p> : null}
        {error ? <p className="v5-uat-error">{error}</p> : null}
        <button className="v5-uat-btn ghost" onClick={() => refresh()}>Refresh</button>
      </section>
    </main>
  )
}
