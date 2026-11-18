function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export class WatcherJobBudget {
  constructor({ maxRequests, maxBlocks }) {
    this.maxRequests = positiveInteger(maxRequests, "WATCHER_MAX_RPC_REQUESTS_PER_JOB");
    this.maxBlocks = positiveInteger(maxBlocks, "WATCHER_MAX_TOTAL_BLOCKS_PER_JOB");
    this.requests = 0;
    this.blocks = 0;
    this.requestRoles = {};
    this.blockRoles = {};
  }

  reserveRequests(role, count = 1) {
    const amount = positiveInteger(count, "RPC request count");
    if (this.requests + amount > this.maxRequests) {
      const error = new Error(`WATCHER_JOB_REQUEST_BUDGET_EXHAUSTED used=${this.requests} requested=${amount} max=${this.maxRequests}`);
      error.code = "WATCHER_JOB_REQUEST_BUDGET_EXHAUSTED";
      throw error;
    }
    this.requests += amount;
    this.requestRoles[role] = (this.requestRoles[role] || 0) + amount;
  }

  reserveRange(role, fromBlock, targetBlock) {
    const from = Number(fromBlock);
    const target = Number(targetBlock);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(target) || from < 0 || target < from) {
      throw new Error(`Invalid watcher range ${fromBlock}-${targetBlock}`);
    }
    const remaining = this.maxBlocks - this.blocks;
    if (remaining < 1) {
      const error = new Error(`WATCHER_JOB_BLOCK_BUDGET_EXHAUSTED used=${this.blocks} max=${this.maxBlocks}`);
      error.code = "WATCHER_JOB_BLOCK_BUDGET_EXHAUSTED";
      throw error;
    }
    const end = Math.min(target, from + remaining - 1);
    const amount = end - from + 1;
    this.blocks += amount;
    this.blockRoles[role] = (this.blockRoles[role] || 0) + amount;
    return end;
  }

  snapshot() {
    return {
      requests: this.requests,
      maxRequests: this.maxRequests,
      requestRoles: { ...this.requestRoles },
      blocks: this.blocks,
      maxBlocks: this.maxBlocks,
      blockRoles: { ...this.blockRoles },
    };
  }
}
