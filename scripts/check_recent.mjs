import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz');
const POOL = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19';

const block = await provider.getBlockNumber();
console.log('Current block:', block);

for (let b = block; b >= block - 30; b--) {
  const blk = await provider.getBlock(b, true);
  if (!blk || !blk.prefetchedTransactions) continue;
  for (const tx of blk.prefetchedTransactions) {
    if (tx.to && tx.to.toLowerCase() === POOL.toLowerCase()) {
      const receipt = await provider.getTransactionReceipt(tx.hash);
      const gasInfo = receipt ? receipt.gasUsed.toString() + '/' + tx.gasLimit.toString() : 'n/a';
      console.log('POOL TX block:', b, 'hash:', tx.hash.slice(0,20), 'status:', receipt?.status, 'gas used/limit:', gasInfo, 'from:', tx.from.slice(0,12));
    }
  }
}
