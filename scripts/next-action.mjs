import fs from 'fs';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const artifact = JSON.parse(
  fs.readFileSync('./artifacts/src/TicketPrizePoolShmonShMonad.sol/TicketPrizePoolShmonShMonad.json', 'utf8')
);
const pool = new ethers.Contract(process.env.POOL_ADDRESS, artifact.abi, provider);

const ACTION = ['None','Skip','Commit','Draw','Settle','Recommit'];

const rid = await pool.currentRoundId();
const info = await pool.getRoundInfo(rid);
const [nextRid, nextAction] = await pool.nextExecutable();
const now = Math.floor(Date.now() / 1000);

console.log('POOL:', process.env.POOL_ADDRESS);
console.log('currentRoundId:', rid.toString());
console.log('state:', info.state.toString(), '(0 Open,1 Committed,2 Finalizing,3 Settled)');
console.log('salesEndTime:', info.salesEndTime.toString(), `(in ${Number(info.salesEndTime)-now}s)`);
console.log('totalTickets:', info.totalTickets.toString());
console.log('totalPrincipalMON:', ethers.formatEther(info.totalPrincipalMON));
console.log('activeFinalizingRoundId:', (await pool.activeFinalizingRoundId()).toString());
console.log('');
console.log('nextExecutable.roundId:', nextRid.toString());
console.log('nextExecutable.action:', Number(nextAction), ACTION[Number(nextAction)] ?? 'Unknown');

if (Number(nextAction) === 0) {
  console.log('\nSuggested next step: WAIT');
} else {
  console.log('\nSuggested next step: call executeNext()');
}
