#!/bin/sh
set -eu

echo "[keeper-v5] entrypoint start"
echo "[keeper-v5] drawManager=${DRAW_MANAGER_ADDRESS:-<unset>} claimManager=${CLAIM_MANAGER_ADDRESS:-<unset>} fromBlock=${V5_KEEPER_FROM_BLOCK:-<unset>}"
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "[keeper-v5] FATAL: PRIVATE_KEY not set (must be a Fly secret set by the operator)" >&2
fi

exec node scripts/keeper/v5-runtime-supervisor.mjs
