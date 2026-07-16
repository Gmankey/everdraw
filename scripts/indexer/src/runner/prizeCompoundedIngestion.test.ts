import assert from 'node:assert/strict';
import { POOL_EVENT_ABI } from './abi.js';
import { SUPPORTED_EVENTS } from './service.js';

assert.equal(POOL_EVENT_ABI.some((entry) => entry.startsWith('event PrizeCompounded(')), true);
assert.equal(SUPPORTED_EVENTS.includes('PrizeCompounded'), true);

console.log('prizeCompoundedIngestion.test.ts ok');
