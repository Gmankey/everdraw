import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz');
const SHMON = '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c';
const POOL_A = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19'; // has 0.65 shares
const FAKE_A = '0x1111111111111111111111111111111111111111';
const FAKE_B = '0x2222222222222222222222222222222222222222';

const ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256) returns (bool)',
  'function redeem(uint256,address,address) returns (uint256)',
  'function withdraw(uint256,address,address) returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function previewWithdraw(uint256) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function requestUnstake(uint256) returns (uint64)',
  'function maxRedeem(address) view returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
];

const iface = new ethers.Interface(ABI);
const shmon = new ethers.Contract(SHMON, ABI, provider);

async function tryStaticCall(label, data, from, value = 0n) {
  try {
    const result = await provider.send('eth_call', [{
      from, to: SHMON, data, value: '0x' + value.toString(16),
    }, 'latest', {
      // Give FAKE_A some share balance + allowance to FAKE_B via state override is hard
      // so just test with real pool-held shares where possible
    }]);
    console.log('  ✓', label, '→ result:', result.slice(0, 20) + (result.length > 20 ? '...' : ''));
    return result;
  } catch (e) {
    const data = e.data || e.error?.data;
    const msg = e.shortMessage || e.message?.slice(0, 80);
    console.log('  ✗', label, '→', msg, data ? '(data: ' + data.slice(0,18) + ')' : '');
    return null;
  }
}

console.log('=== ERC-4626 withdraw paths ===');
// 1. Can the pool call transfer on its own shares?
const poolBal = await shmon.balanceOf(POOL_A);
console.log('POOL_A balance:', ethers.formatEther(poolBal), 'shMON');

// 2. Static-call transfer from pool to fake address (eth_call as pool)
await tryStaticCall(
  'pool.transfer(FAKE_A, 0.1 shares)',
  iface.encodeFunctionData('transfer', [FAKE_A, ethers.parseEther('0.1')]),
  POOL_A
);

// 3. Static-call transferFrom (as FAKE_B spending pool's shares — should fail: no allowance)
await tryStaticCall(
  'FAKE_B.transferFrom(POOL, FAKE_A, 0.1) [no allowance]',
  iface.encodeFunctionData('transferFrom', [POOL_A, FAKE_A, ethers.parseEther('0.1')]),
  FAKE_B
);

// 4. Can the pool call approve?
await tryStaticCall(
  'pool.approve(FAKE_B, 0.1)',
  iface.encodeFunctionData('approve', [FAKE_B, ethers.parseEther('0.1')]),
  POOL_A
);

// 5. Try redeem as pool (0.1 of its 0.65 shares)
await tryStaticCall(
  'pool.redeem(0.1, pool, pool) [instant?]',
  iface.encodeFunctionData('redeem', [ethers.parseEther('0.1'), POOL_A, POOL_A]),
  POOL_A
);

// 6. Try withdraw as pool
await tryStaticCall(
  'pool.withdraw(0.1, pool, pool) [instant?]',
  iface.encodeFunctionData('withdraw', [ethers.parseEther('0.1'), POOL_A, POOL_A]),
  POOL_A
);

// 7. Try requestUnstake as pool
await tryStaticCall(
  'pool.requestUnstake(0.1) [slow path]',
  iface.encodeFunctionData('requestUnstake', [ethers.parseEther('0.1')]),
  POOL_A
);

// 8. Check maxRedeem / maxWithdraw for pool (tells us if instant path is allowed)
try {
  const mR = await shmon.maxRedeem(POOL_A);
  console.log('  maxRedeem(pool):', ethers.formatEther(mR));
} catch (e) { console.log('  maxRedeem reverted:', e.shortMessage); }
try {
  const mW = await shmon.maxWithdraw(POOL_A);
  console.log('  maxWithdraw(pool):', ethers.formatEther(mW));
} catch (e) { console.log('  maxWithdraw reverted:', e.shortMessage); }

// 9. Rate comparison at different amounts
console.log('\n=== rate spread analysis ===');
for (const sh of ['0.1', '1', '10', '100']) {
  try {
    const amt = ethers.parseEther(sh);
    const ca = await shmon.convertToAssets(amt);
    const pr = await shmon.previewRedeem(amt);
    const spread = ((Number(ca - pr) / Number(ca)) * 100).toFixed(4);
    console.log('  ' + sh + ' shares: convertToAssets=' + ethers.formatEther(ca) + ' previewRedeem=' + ethers.formatEther(pr) + ' spread=' + spread + '%');
  } catch (e) { console.log('  ' + sh + ' failed:', e.shortMessage); }
}
