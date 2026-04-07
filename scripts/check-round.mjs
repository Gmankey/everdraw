import fs from 'fs';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const artifact = JSON.parse(
  fs.readFileSync('./artifacts/src/TicketPrizePoolShmonShMonad.sol/TicketPrizePoolShmonShMonad.json', 'utf8')
);

const pool = new ethers.Contract(process.env.POOL_ADDRESS, artifact.abi, provider);

const rid = await pool.currentRoundId();
const info = await pool.getRoundInfo(rid);

console.log('roundId:', rid.toString());
console.log('state:', info.state.toString());
console.log('salesEndTime:', info.salesEndTime.toString());
console.log('totalTickets:', info.totalTickets.toString());
console.log('totalPrincipalMON:', ethers.formatEther(info.totalPrincipalMON));
console.log('totalShmonShares:', info.totalShmonShares.toString());
console.log('winner:', info.winner);
console.log('winningTicket:', info.winningTicket.toString());

console.log('\nownerOfTicket scan:');
for (let i = 0; i < 20; i++) {
  try {
    console.log(i, await pool.ownerOfTicket(rid, i));
  } catch {
    console.log(i, 'REVERT');
    break;
  }
}
