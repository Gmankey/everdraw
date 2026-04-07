# Everdraw Auth Service

Minimal wallet auth service for the indexer/backend side.

## Flow
1. `POST /auth/challenge` with `{ wallet, chainId? }`
2. Wallet signs returned `message`
3. `POST /auth/verify` with `{ wallet, message, signature }`
4. Service returns `{ token, sessionId, wallet, expiresAt }`
5. Use `Authorization: Bearer <token>` on `GET /auth/me`
6. `POST /auth/logout` revokes the DB-backed session

## Required env
- `AUTH_JWT_SECRET` (required)

## Optional env
- `AUTH_PORT` (default `8787`)
- `AUTH_CHAIN_ID` (default `10143`)
- `AUTH_NONCE_TTL_SECONDS` (default `600`)
- `AUTH_SESSION_TTL_SECONDS` (default `604800`)
- `AUTH_STATEMENT`
- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`

## Start
- `npm run indexer:auth`
