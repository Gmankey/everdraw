import { ethers } from 'ethers'
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz')
const addr = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
const latest = await provider.getBlockNumber()
const targets = [
  'event UnstakeRequested(address indexed user, uint256 shares, uint64 completionEpoch)',
  'event UnstakeCompleted(address indexed user, uint256 shares, uint256 assets)',
  'event UnstakeCompleted(address indexed user, uint256 assets)',
  'event UnstakeClaimed(address indexed user, uint256 shares, uint256 assets)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
  'event Redeem(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)'
]
for (const sig of targets) {
  const iface = new ethers.Interface([sig])
  const ev = iface.fragments[0]
  const topic0 = iface.getEvent(ev.name).topicHash
  let sample = null
  let total = 0
  let errors = 0
  for (let from = latest - 10000; from <= latest; from += 100) {
    const to = Math.min(latest, from + 99)
    try {
      const logs = await provider.getLogs({ address: addr, fromBlock: from, toBlock: to, topics: [topic0] })
      total += logs.length
      if (!sample && logs[0]) sample = logs[0]
    } catch (e) {
      errors++
    }
  }
  console.log('SIG', sig)
  console.log('TOPIC0', topic0)
  console.log('TOTAL_LAST_10K', total)
  console.log('ERROR_WINDOWS', errors)
  if (sample) {
    console.log('SAMPLE_BLOCK', sample.blockNumber)
    console.log('SAMPLE_TOPICS', JSON.stringify(sample.topics))
    console.log('SAMPLE_DATA', sample.data)
    try {
      console.log('PARSED', JSON.stringify(iface.parseLog(sample).args, (_,v)=> typeof v==='bigint'? v.toString(): v, 2))
    } catch (e) {
      console.log('PARSE_FAIL', e.message)
    }
  }
  console.log('---')
}
