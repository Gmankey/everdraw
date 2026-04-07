export function buildAuthMessage(input: {
  wallet: string;
  nonce: string;
  chainId: number;
  statement: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    input.statement,
    '',
    `Wallet: ${input.wallet}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expires At: ${input.expiresAt}`,
  ].join('\n');
}

export function parseAuthMessage(message: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of message.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}
