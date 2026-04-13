import { ethers } from 'ethers'
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz')
const addr = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c'
const iface = new ethers.Interface([
  'function getInternalEpoch() view returns (uint64)',
  'function pendingUnstake(address) view returns (uint256 shares, uint64 completionEpoch)',
  'function unstakeInfo(address) view returns (uint256 shares, uint64 completionEpoch)',
  'function unstakes(address) view returns (uint256 shares, uint64 completionEpoch)',
  'function pendingUnstakes(address) view returns (uint256 shares, uint64 completionEpoch)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function previewDeposit(uint256) view returns (uint256)',
  'function previewWithdraw(uint256) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function convertToShares(uint256) view returns (uint256)',
  'function requestUnstake(uint256) returns (uint64)',
  'function completeUnstake()',
  'function completeUnstake(uint256)',
])
const c = new ethers.Contract(addr, iface, provider)
const tests = [
  ['getInternalEpoch', []],
  ['pendingUnstake', ['0x0000000000000000000000000000000000000001']],
  ['unstakeInfo', ['0x0000000000000000000000000000000000000001']],
  ['unstakes', ['0x0000000000000000000000000000000000000001']],
  ['pendingUnstakes', ['0x0000000000000000000000000000000000000001']],
  ['name', []],
  ['symbol', []],
  ['decimals', []],
  ['asset', []],
  ['totalSupply', []],
  ['previewDeposit', [1000000000000000000n]],
  ['previewWithdraw', [1000000000000000000n]],
  ['previewRedeem', [1000000000000000000n]],
  ['convertToAssets', [1000000000000000000n]],
  ['convertToShares', [1000000000000000000n]],
]
for (const [name,args] of tests) {
  try {
    const out = await c[name](...args)
    console.log(JSON.stringify({ name, ok: true, out: typeof out === 'bigint' ? out.toString() : out }, null, 2))
  } catch (e) {
    console.log(JSON.stringify({ name, ok: false, code: e.code, message: e.shortMessage || e.reason || e.message }, null, 2))
  }
}
console.log('selector completeUnstake()', iface.getFunction('completeUnstake()').selector)
console.log('selector completeUnstake(uint256)', iface.getFunction('completeUnstake(uint256)').selector)
console.log('selector requestUnstake(uint256)', iface.getFunction('requestUnstake').selector)
