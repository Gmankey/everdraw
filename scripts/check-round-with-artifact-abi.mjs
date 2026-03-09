import fs from 'fs';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL;
const POOL_ADDRESS = process.env.POOL_ADDRESS;

// Change this path if your deployed pool is a different contract variant:
const ARTIFACT_PATH = './artifacts/src/TicketPrizePoolShmonShMonad.sol/TicketPrizePoolShmonShMonad.json';

if (!RPC_URL || !POOL_ADDRESS) {
  console.error('Missing RPC_URL or POOL_ADDRESS in env');
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
const abi = artifact.abi;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const pool = new ethers.Contract(POOL_ADDRESS, abi, provider);

const rid = await pool.currentRoundId();
const info = await pool.getRoundInfo(rid);

console.log('POOL_ADDRESS:', POOL_ADDRESS);
console.log('roundId:', rid.toString());

console.log('\ngetRoundInfo (raw):');
for (let i = 0; i < info.length; i++) {
  const v = info[i];
  console.log(`  [${i}]`, v?.toString?.() ?? String(v));
}

console.log('\ngetRoundInfo (named fields if present):');
for (const k of Object.keys(info)) {
  if (!/^\d+$/.test(k)) {
    const v = info[k];
    console.log(`  ${k}:`, v?.toString?.() ?? String(v));
  }
}

if (info.principalPoolMON !== undefined) {
  try {
    console.log('\nprincipalPoolMON (ether):', ethers.formatEther(info.principalPoolMON));
  } catch {}
}
if (info.prizePotMON !== undefined) {
  try {
    console.log('prizePotMON (ether):', ethers.formatEther(info.prizePotMON));
  } catch {}
}

console.log('\nownerOfTicket scan (0..20):');
let derivedCount = 0;
for (let i = 0; i <= 20; i++) {
  try {
    const owner = await pool.ownerOfTicket(rid, i);
    console.log(`  ticket#${i}: ${owner}`);
    derivedCount++;
  } catch {
    console.log(`  ticket#${i}: REVERT`);
    break;
  }
}
console.log('\nDerived ticket count from ownerOfTicket:', derivedCount);

if (info.ticketCount !== undefined) {
  console.log('Reported ticketCount from getRoundInfo:', info.ticketCount.toString());
}
