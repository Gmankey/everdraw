import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const pool = new ethers.Contract(
  process.env.POOL_ADDRESS,
  [
    'function currentRoundId() view returns(uint256)',
    // keep your current guess for now; we will inspect raw tuple shape
    'function getRoundInfo(uint256) view returns(uint32 ticketCount,uint96 prizePotMON,uint96 principalPoolMON,address winner,uint64 salesEndTime,uint64 unstakeCompletionEpoch,uint8 state,uint32 winningTicket)',
    'function ownerOfTicket(uint256,uint32) view returns(address)'
  ],
  provider
);

const rid = await pool.currentRoundId();
const info = await pool.getRoundInfo(rid);

console.log('roundId =', rid.toString());
console.log('\nNamed decode:');
console.log({
  ticketCount: info.ticketCount?.toString?.() ?? String(info.ticketCount),
  prizePotMON: info.prizePotMON?.toString?.() ?? String(info.prizePotMON),
  principalPoolMON: info.principalPoolMON?.toString?.() ?? String(info.principalPoolMON),
  winner: info.winner,
  salesEndTime: info.salesEndTime?.toString?.() ?? String(info.salesEndTime),
  unstakeCompletionEpoch: info.unstakeCompletionEpoch?.toString?.() ?? String(info.unstakeCompletionEpoch),
  state: info.state?.toString?.() ?? String(info.state),
  winningTicket: info.winningTicket?.toString?.() ?? String(info.winningTicket),
});

console.log('\nRaw tuple by index:');
for (let i = 0; i < info.length; i++) {
  const v = info[i];
  console.log(`info[${i}] =`, v?.toString?.() ?? String(v));
}

console.log('\nTicket owner scan (0..20):');
for (let i = 0; i <= 20; i++) {
  try {
    const owner = await pool.ownerOfTicket(rid, i);
    console.log(`ticket ${i}: ${owner}`);
  } catch {
    console.log(`ticket ${i}: REVERT`);
    break;
  }
}
