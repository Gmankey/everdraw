export interface RunnerConfig {
  rpcUrl: string;
  poolAddresses: string[];
  deployBlock: number;
  confirmations: number;
  chunkSize: number;
  pollIntervalMs: number;
}

export function getRunnerConfig(): RunnerConfig {
  const rpcUrl = process.env.RPC_URL ?? process.env.INDEXER_RPC_URL;
  const raw = process.env.POOL_ADDRESSES ?? process.env.POOL_ADDRESS ?? process.env.INDEXER_POOL_ADDRESS ?? '';
  const poolAddresses = raw.split(',').map((a) => a.trim()).filter(Boolean);
  const deployBlock = Number(process.env.START_BLOCK ?? process.env.INDEXER_DEPLOY_BLOCK ?? 0);

  if (!rpcUrl) throw new Error('Missing RPC_URL');
  if (!poolAddresses.length) throw new Error('Missing POOL_ADDRESSES');
  if (!deployBlock) throw new Error('Missing START_BLOCK');

  return {
    rpcUrl,
    poolAddresses,
    deployBlock,
    confirmations: Number(process.env.INDEXER_CONFIRMATIONS ?? 0),
    chunkSize: Number(process.env.INDEXER_CHUNK_SIZE ?? 100),
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 2000),
  };
}
