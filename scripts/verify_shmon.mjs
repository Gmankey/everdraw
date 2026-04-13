import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz');
const POOL = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19';

// Get shMON address from the pool
const pool = new ethers.Contract(POOL, ['function shmon() view returns (address)'], provider);
const shmonAddr = await pool.shmon();
console.log('shMON address:', shmonAddr);

// Try a comprehensive ERC-4626 + ERC-20 surface
const ABI = [
  // ERC-20
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256) returns (bool)',
  // ERC-4626
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function convertToShares(uint256) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function previewDeposit(uint256) view returns (uint256)',
  'function deposit(uint256,address) payable returns (uint256)',
  'function maxMint(address) view returns (uint256)',
  'function previewMint(uint256) view returns (uint256)',
  'function mint(uint256,address) payable returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
  'function previewWithdraw(uint256) view returns (uint256)',
  'function maxRedeem(address) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  // ShMonad-specific (guessing from V1 contract)
  'function requestUnstake(uint256) returns (uint64)',
  'function completeUnstake()',
  'function getInternalEpoch() view returns (uint64)',
];

const shmon = new ethers.Contract(shmonAddr, ABI, provider);

async function tryCall(label, fn) {
  try {
    const r = await fn();
    console.log('  ✓', label, ':', typeof r === 'bigint' ? r.toString() : r);
    return r;
  } catch (e) {
    console.log('  ✗', label, ':', e.shortMessage || e.message?.slice(0,60));
    return null;
  }
}

console.log('\n=== ERC-20 surface ===');
await tryCall('name()', () => shmon.name());
await tryCall('symbol()', () => shmon.symbol());
await tryCall('decimals()', () => shmon.decimals());
await tryCall('totalSupply()', () => shmon.totalSupply());

console.log('\n=== ERC-4626 surface ===');
await tryCall('asset()', () => shmon.asset());
await tryCall('totalAssets()', () => shmon.totalAssets());
const shares1 = await tryCall('convertToShares(1e18)', () => shmon.convertToShares(ethers.parseEther('1')));
const assets1 = await tryCall('convertToAssets(1e18)', () => shmon.convertToAssets(ethers.parseEther('1')));
await tryCall('previewDeposit(1e18)', () => shmon.previewDeposit(ethers.parseEther('1')));
await tryCall('previewMint(1e18)', () => shmon.previewMint(ethers.parseEther('1')));
await tryCall('previewRedeem(1e18)', () => shmon.previewRedeem(ethers.parseEther('1')));
await tryCall('previewWithdraw(1e18)', () => shmon.previewWithdraw(ethers.parseEther('1')));
await tryCall('maxDeposit(0x0)', () => shmon.maxDeposit(ethers.ZeroAddress));
await tryCall('maxMint(0x0)', () => shmon.maxMint(ethers.ZeroAddress));

console.log('\n=== ShMonad-specific ===');
await tryCall('getInternalEpoch()', () => shmon.getInternalEpoch());

console.log('\n=== pool balance / allowance sanity ===');
await tryCall('balanceOf(pool)', () => shmon.balanceOf(POOL));
await tryCall('allowance(pool, pool)', () => shmon.allowance(POOL, POOL));

// Rate summary
if (shares1 !== null && assets1 !== null) {
  const rateShares = Number(ethers.formatEther(shares1));
  const rateAssets = Number(ethers.formatEther(assets1));
  console.log('\n=== rate summary ===');
  console.log('  1 MON  → ', rateShares.toFixed(6), 'shMON shares');
  console.log('  1 share → ', rateAssets.toFixed(6), 'MON');
  console.log('  implied APY vs 1:1:', ((rateAssets - 1) * 100).toFixed(4) + '%');
}

// Check contract bytecode size (sanity — contract exists)
const code = await provider.getCode(shmonAddr);
console.log('\n=== contract size ===');
console.log('  bytecode length:', code.length, 'bytes');
