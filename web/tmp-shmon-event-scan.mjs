import { ethers } from 'ethers'
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz')
const addr = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
const latest = await provider.getBlockNumber()
const sigs = [
  'event UnstakeRequested(address indexed user, uint256 shares, uint64 completionEpoch)',
  'event UnstakeCompleted(address indexed user, uint256 shares, uint256 assets)',
  'event Redeem(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)'
]
for (const sig of sigs) {
  const iface = new ethers.Interface([sig])
  const topic0 = iface.getEvent(iface.fragments[0].name).topicHash
  let found = null
  for (let from = latest - 5000; from <= latest; from += 100) {
    const to = Math.min(latest, from + 99)
    const logs = await provider.getLogs({ address: addr, fromBlock: from, toBlock: to, topics: [topic0] }).catch(() => [])
    if (logs.length) { found = { from, to, log: logs[0], count: logs.length }; break }
  }
  console.log(JSON.stringify({ sig, topic0, found }, null, 2))
  if (found) {
    try { console.log('PARSED', iface.parseLog(found.log).args) } catch (e) { console.log('PARSE_FAIL', e.message) }
  }
}
