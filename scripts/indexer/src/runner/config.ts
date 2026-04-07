export interface RunnerConfig {
  rpcUrl: string;
  poolAddress: string;
  deployBlock: number;
  confirmations: number;
  chunkSize: number;
  pollIntervalMs: number;
}

export function getRunnerConfig(): RunnerConfig {
  const rpcUrl = process.env.RPC_URL ?? process.env.INDEXER_RPC_URL;
  const poolAddress = process.env.POOL_ADDRESS ?? process.env.INDEXER_POOL_ADDRESS;
  const deployBlock = Number(process.env.START_BLOCK ?? process.env.INDEXER_DEPLOY_BLOCK ?? 0);

  if (!rpcUrl) throw new Error('Missing RPC_URL');
  if (!poolAddress) throw new Error('Missing POOL_ADDRESS');
  if (!deployBlock) throw new Error('Missing START_BLOCK');

  return {
    rpcUrl,
    poolAddress,
    deployBlock,
    confirmations: Number(process.env.INDEXER_CONFIRMATIONS ?? 0),
    chunkSize: Number(process.env.INDEXER_CHUNK_SIZE ?? 100),
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 2000),
  };
}
