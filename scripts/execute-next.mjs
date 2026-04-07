import fs from 'fs';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL;
const POOL_ADDRESS = process.env.POOL_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY; // must be funded for gas

if (!RPC_URL || !POOL_ADDRESS || !PRIVATE_KEY) {
  console.error('Missing RPC_URL / POOL_ADDRESS / PRIVATE_KEY in env');
  process.exit(1);
}

const artifact = JSON.parse(
  fs.readFileSync('./artifacts/src/TicketPrizePoolShmonShMonad.sol/TicketPrizePoolShmonShMonad.json', 'utf8')
);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const pool = new ethers.Contract(POOL_ADDRESS, artifact.abi, wallet);

const ACTION = ['None','Skip','Commit','Draw','Settle','Recommit'];

const [rid, action] = await pool.nextExecutable();
const actionNum = Number(action);

console.log('nextExecutable.roundId:', rid.toString());
console.log('nextExecutable.action:', actionNum, ACTION[actionNum] ?? 'Unknown');

if (actionNum === 0) {
  console.log('Nothing to execute right now (WAIT).');
  process.exit(0);
}

// Send tx
const tx = await pool.executeNext();
console.log('tx hash:', tx.hash);

const rcpt = await tx.wait();
console.log('mined in block:', rcpt.blockNumber);
console.log('status:', rcpt.status === 1 ? 'SUCCESS' : 'FAILED');

// Post-check
const currentRid = await pool.currentRoundId();
const info = await pool.getRoundInfo(rid);

console.log('post currentRoundId:', currentRid.toString());
console.log('post round state:', info.state.toString(), '(0 Open,1 Committed,2 Finalizing,3 Settled)');
console.log('post winner:', info.winner);
console.log('post winningTicket:', info.winningTicket.toString());
