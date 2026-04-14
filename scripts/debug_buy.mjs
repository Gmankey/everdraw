import { ethers } from 'ethers';

const RPC = 'https://rpc.monad.xyz';
const POOL = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19';
const ABI = [
  'function buyTickets(uint32 ticketCount) payable',
  'function ticketPriceMON() view returns (uint96)',
  'function currentRoundId() view returns (uint256)',
  'function getRoundInfo(uint256 rid) view returns (tuple(uint8 state, uint64 salesEndTime, uint64 finalizationStartTime, uint64 targetBlockNumber, uint32 totalTickets, uint256 totalPrincipalMON, uint256 totalShmonShares, address winner, uint32 winningTicket, bool prizeClaimed))',
  'function paused() view returns (bool)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const pool = new ethers.Contract(POOL, ABI, provider);

  const [price, rid, paused] = await Promise.all([
    pool.ticketPriceMON(),
    pool.currentRoundId(),
    pool.paused(),
  ]);
  console.log('ticketPriceMON:', ethers.formatEther(price), 'MON');
  console.log('currentRoundId:', rid.toString());
  console.log('paused:', paused);

  const info = await pool.getRoundInfo(rid);
  const states = ['Open','Committed','Finalizing','Settled','Skipped'];
  const now = Math.floor(Date.now()/1000);
  console.log('round state:', states[info.state] || info.state);
  console.log('salesEndTime:', new Date(Number(info.salesEndTime)*1000).toISOString());
  console.log('now:', new Date(now*1000).toISOString());
  console.log('sales still open?', now < Number(info.salesEndTime));
  console.log('totalTickets:', info.totalTickets.toString());

  // Try eth_call to get exact revert reason
  const FAKE = '0x1234567890123456789012345678901234567890';
  const value = price * 1n;
  try {
    await provider.send('eth_call', [{
      from: FAKE,
      to: POOL,
      value: '0x' + value.toString(16),
      data: pool.interface.encodeFunctionData('buyTickets', [1]),
    }, 'latest', {
      [FAKE]: { balance: '0x' + (value + ethers.parseEther('10')).toString(16) }
    }]);
    console.log('eth_call: SUCCESS (no revert)');
  } catch(e) {
    console.log('eth_call revert:', e.message);
    if (e.data) {
      console.log('raw revert data:', e.data);
      // Check known selectors
      const sel = e.data.slice(0,10);
      const known = {
        '0x78b786cc': 'BadState()',
        '0x7b64b2ce': 'SalesEnded()',
        '0x5f6a61b5': 'ZeroTickets()',
        '0x8f4eb604': 'WrongValue()',
        '0x6f3d82a4': 'ZeroSharesMinted()',
      };
      console.log('selector:', sel, '->', known[sel] || 'unknown');
    }
  }
}

main().catch(console.error);
