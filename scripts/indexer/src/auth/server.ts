import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAuthConfig } from './config.js';
import { applySchema, openDatabase } from '../db/database.js';
import { createAuthNonceRepo } from './repositories/authNonceRepo.js';
import { createAuthSessionRepo } from './repositories/authSessionRepo.js';
import { createAuthService } from './services/authService.js';
import type { AuthChallengeRequest, AuthVerifyRequest } from './types.js';

const config = getAuthConfig();
const db = openDatabase();
applySchema(db);

const authNonceRepo = createAuthNonceRepo(db);
const authSessionRepo = createAuthSessionRepo(db);
const authService = createAuthService({ config, authNonceRepo, authSessionRepo });

const app = new Hono();

app.use('*', cors());
app.use('*', async (c, next) => {
  authService.cleanupExpired();
  await next();
});

app.get('/health', (c) => {
  return c.json({ ok: true, service: 'everdraw-auth', chainId: config.chainId });
});

app.post('/auth/challenge', async (c) => {
  const body = (await c.req.json()) as AuthChallengeRequest;
  const challenge = authService.createChallenge(body);
  return c.json(challenge);
});

app.post('/auth/verify', async (c) => {
  const body = (await c.req.json()) as AuthVerifyRequest;
  const session = await authService.verify(body);
  return c.json(session);
});

app.get('/auth/me', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing bearer token' }, 401);
  }

  try {
    const token = authHeader.slice('Bearer '.length);
    const session = await authService.verifyBearerToken(token);
    return c.json(session);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unauthorized' }, 401);
  }
});

app.post('/auth/logout', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing bearer token' }, 401);
  }

  try {
    const token = authHeader.slice('Bearer '.length);
    const session = await authService.verifyBearerToken(token);
    authService.revoke(session.sessionId);
    return c.json({ ok: true, sessionId: session.sessionId });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unauthorized' }, 401);
  }
});

console.log(`Everdraw auth service listening on :${config.port}`);
serve({
  fetch: app.fetch,
  port: config.port,
});
