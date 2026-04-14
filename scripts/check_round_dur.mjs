import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://rpc.monad.xyz');
const POOL = '0x47D339aa0d8d43d0a69E3e4ae4E9A56932e3AB19';
const c = new ethers.Contract(POOL, ['function roundDurationSec() view returns (uint32)'], provider);
const d = await c.roundDurationSec();
console.log('roundDurationSec:', d.toString(), '=', Number(d)/3600, 'hours');
