import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Interface } from 'ethers';
import { POOL_EVENT_ABI } from './abi.js';

describe('POOL_EVENT_ABI', () => {
  it('parses a real V2 TicketsPurchased log', () => {
    const iface = new Interface(POOL_EVENT_ABI);
    const parsed = iface.parseLog({
      topics: [
        '0xa6aaa5e2ec01fca5d73121547630f5e3b57de10aeb84bb48b3ace454980a6bc9',
        '0x0000000000000000000000000000000000000000000000000000000000000002',
        '0x00000000000000000000000069b3f8fa1759272ef770103e5b014a2379dc9ebc',
      ],
      data: '0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000008eb92d6dcd16ae000000000000000000000000000000000000000000000000015967195d0f95b080000000000000000000000000000000000000000000000000000000000000000',
    });

    assert.ok(parsed);
    assert.equal(parsed.name, 'TicketsPurchased');
    assert.equal(parsed.args.roundId, 2n);
    assert.equal(parsed.args.buyer, '0x69b3F8FA1759272EF770103E5B014A2379dC9EBc');
    assert.equal(parsed.args.ticketCount, 1n);
    assert.equal(parsed.args.costMON, 1_000_000_000_000_000_000n);
  });
});
