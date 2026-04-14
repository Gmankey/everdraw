import { ethers } from 'ethers';

const RPC = 'https://rpc.monad.xyz';
const POOL = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19';
const ABI = [
  'function buyTickets(uint32 ticketCount) payable',
  'function ticketPriceMON() view returns (uint96)',
  'function currentRoundId() view returns (uint256)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(POOL, ABI, provider);

  const price = await pool.ticketPriceMON();
  const rid = await pool.currentRoundId();
  console.log('ticketPriceMON:', ethers.formatEther(price), 'MON');
  console.log('currentRoundId:', rid.toString());

  const FAKE_WHALE = '0x1234567890123456789012345678901234567890';
  const value = price * 1n;
  
  // Try estimateGas with state override (fund fake wallet)
  try {
    const result = await provider.send('eth_estimateGas', [{
      from: FAKE_WHALE,
      to: POOL,
      value: '0x' + value.toString(16),
      data: pool.interface.encodeFunctionData('buyTickets', [1]),
    }, 'latest', {
      [FAKE_WHALE]: { balance: '0x' + (value + ethers.parseEther('10')).toString(16) }
    }]);
    console.log('estimateGas (1 ticket):', parseInt(result, 16));
  } catch(e) {
    console.log('estimateGas WITH override error:', e.message);
    // Decode revert if present
    try {
      const result2 = await provider.send('eth_call', [{
        from: FAKE_WHALE,
        to: POOL,
        value: '0x' + value.toString(16),
        data: pool.interface.encodeFunctionData('buyTickets', [1]),
      }, 'latest', {
        [FAKE_WHALE]: { balance: '0x' + (value + ethers.parseEther('10')).toString(16) }
      }]);
      console.log('eth_call result:', result2);
    } catch(e2) {
      console.log('eth_call error:', e2.message);
      if (e2.data) {
        console.log('revert data:', e2.data);
        try {
          // Try decoding as standard Error(string)
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + e2.data.slice(10));
          console.log('decoded revert:', decoded[0]);
        } catch(_) {
          // Try as custom error selector
          console.log('custom error selector:', e2.data.slice(0, 10));
        }
      }
    }
  }
}

main().catch(console.error);
