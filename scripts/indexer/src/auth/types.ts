export interface AuthNonceRow {
  wallet: string;
  nonce: string;
  statement: string;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface AuthSessionRow {
  sessionId: string;
  wallet: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AuthChallengeRequest {
  wallet: string;
  chainId?: number;
  statement?: string;
}

export interface AuthVerifyRequest {
  wallet: string;
  message: string;
  signature: string;
}
