const DEFAULT_CHAIN_ID = 10143;
const DEFAULT_NONCE_TTL_SECONDS = 10 * 60;
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_STATEMENT = 'Sign this message to authenticate with Everdraw.';
const DEFAULT_PORT = 8787;

export interface AuthConfig {
  chainId: number;
  nonceTtlSeconds: number;
  sessionTtlSeconds: number;
  statement: string;
  jwtSecret: string;
  issuer: string;
  audience: string;
  port: number;
}

export function getAuthConfig(): AuthConfig {
  const jwtSecret = process.env.AUTH_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('Missing AUTH_JWT_SECRET');
  }

  return {
    chainId: Number(process.env.AUTH_CHAIN_ID ?? DEFAULT_CHAIN_ID),
    nonceTtlSeconds: Number(process.env.AUTH_NONCE_TTL_SECONDS ?? DEFAULT_NONCE_TTL_SECONDS),
    sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS),
    statement: process.env.AUTH_STATEMENT ?? DEFAULT_STATEMENT,
    jwtSecret,
    issuer: process.env.AUTH_JWT_ISSUER ?? 'everdraw-indexer-auth',
    audience: process.env.AUTH_JWT_AUDIENCE ?? 'everdraw',
    port: Number(process.env.AUTH_PORT ?? DEFAULT_PORT),
  };
}
