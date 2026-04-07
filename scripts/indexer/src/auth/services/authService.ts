import { randomBytes, randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthConfig } from '../config.js';
import { buildAuthMessage, parseAuthMessage } from '../message.js';
import type { AuthChallengeRequest, AuthVerifyRequest } from '../types.js';
import type { AuthNonceRepo } from '../repositories/authNonceRepo.js';
import type { AuthSessionRepo } from '../repositories/authSessionRepo.js';

export interface AuthService {
  createChallenge(input: AuthChallengeRequest): {
    wallet: string;
    nonce: string;
    chainId: number;
    statement: string;
    issuedAt: string;
    expiresAt: string;
    message: string;
  };
  verify(input: AuthVerifyRequest): Promise<{
    token: string;
    sessionId: string;
    wallet: string;
    expiresAt: string;
  }>;
  revoke(sessionId: string): void;
  verifyBearerToken(token: string): Promise<{ sessionId: string; wallet: string; expiresAt: string }>;
  cleanupExpired(nowIso?: string): void;
}

export function createAuthService(input: {
  config: AuthConfig;
  authNonceRepo: AuthNonceRepo;
  authSessionRepo: AuthSessionRepo;
}): AuthService {
  const { config, authNonceRepo, authSessionRepo } = input;
  const secret = new TextEncoder().encode(config.jwtSecret);

  return {
    createChallenge(request) {
      const wallet = ethers.getAddress(request.wallet);
      const chainId = request.chainId ?? config.chainId;
      const statement = request.statement?.trim() || config.statement;
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + config.nonceTtlSeconds * 1000).toISOString();
      const nonce = randomBytes(16).toString('hex');
      const message = buildAuthMessage({
        wallet,
        nonce,
        chainId,
        statement,
        issuedAt,
        expiresAt,
      });

      authNonceRepo.upsert({
        wallet,
        nonce,
        statement,
        chainId,
        issuedAt,
        expiresAt,
        consumedAt: null,
      });

      return { wallet, nonce, chainId, statement, issuedAt, expiresAt, message };
    },

    async verify(request) {
      const wallet = ethers.getAddress(request.wallet);
      const challenge = authNonceRepo.get(wallet);
      if (!challenge) throw new Error('Challenge not found for wallet');
      if (challenge.consumedAt) throw new Error('Challenge already consumed');
      if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('Challenge expired');

      const expectedMessage = buildAuthMessage({
        wallet,
        nonce: challenge.nonce,
        chainId: challenge.chainId,
        statement: challenge.statement,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      });

      if (request.message !== expectedMessage) {
        throw new Error('Signed message did not match stored challenge');
      }

      const parsed = parseAuthMessage(request.message);
      if (parsed.get('Wallet') !== wallet) throw new Error('Wallet mismatch in signed message');
      if (parsed.get('Nonce') !== challenge.nonce) throw new Error('Nonce mismatch in signed message');
      if (Number(parsed.get('Chain ID')) !== challenge.chainId) throw new Error('Chain ID mismatch in signed message');

      const recovered = ethers.verifyMessage(request.message, request.signature);
      if (ethers.getAddress(recovered) !== wallet) {
        throw new Error('Signature recovery mismatch');
      }

      authNonceRepo.markConsumed(wallet);

      const sessionId = randomUUID();
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString();

      authSessionRepo.insert({
        sessionId,
        wallet,
        issuedAt,
        expiresAt,
        revokedAt: null,
      });

      const token = await new SignJWT({ wallet })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setSubject(wallet)
        .setJti(sessionId)
        .setExpirationTime(expiresAt)
        .sign(secret);

      return { token, sessionId, wallet, expiresAt };
    },

    revoke(sessionId) {
      authSessionRepo.revoke(sessionId, new Date().toISOString());
    },

    async verifyBearerToken(token) {
      const verified = await jwtVerify(token, secret, {
        issuer: config.issuer,
        audience: config.audience,
      });

      const sessionId = verified.payload.jti;
      const wallet = verified.payload.sub;
      const expiresAt = verified.payload.exp ? new Date(verified.payload.exp * 1000).toISOString() : null;

      if (!sessionId || !wallet || !expiresAt) {
        throw new Error('Token missing required claims');
      }

      const session = authSessionRepo.get(sessionId);
      if (!session) throw new Error('Session not found');
      if (session.revokedAt) throw new Error('Session revoked');
      if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('Session expired');
      if (ethers.getAddress(session.wallet) !== ethers.getAddress(String(wallet))) {
        throw new Error('Session wallet mismatch');
      }

      return { sessionId, wallet: ethers.getAddress(String(wallet)), expiresAt: session.expiresAt };
    },

    cleanupExpired(nowIso = new Date().toISOString()) {
      authNonceRepo.deleteExpired(nowIso);
      authSessionRepo.deleteExpired(nowIso);
    },
  };
}
