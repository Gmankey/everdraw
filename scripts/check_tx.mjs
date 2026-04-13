import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz');
const USER = '0x47331C390000000000000000000000000000000000'.slice(0,42); // placeholder

// Get recent txs by checking latest block
const block = await provider.getBlockNumber();
console.log('Current block:', block);

// Check latest 3 blocks for txs from our pool address
const POOL = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19';
const logs = await provider.getLogs({
  address: POOL,
  fromBlock: block - 1000,
  toBlock: block,
});
console.log('Recent pool logs (last 1000 blocks):', logs.length);
if (logs.length > 0) {
  const recent = logs.slice(-5);
  for (const l of recent) {
    console.log('  block:', l.blockNumber, 'tx:', l.transactionHash.slice(0,18), 'topic:', l.topics[0].slice(0,10));
  }
}
