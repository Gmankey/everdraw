#!/usr/bin/env bash
set -euo pipefail

cd /home/c/.openclaw/workspace/monad-prize

if [[ ! -f scripts/keeper.env ]]; then
  echo "[error] missing scripts/keeper.env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source scripts/keeper.env
set +a

missing=0

require_nonempty() {
  local key="$1"
  local val="${!key:-}"
  if [[ -z "$val" ]]; then
    echo "[error] ${key} is empty"
    missing=1
  else
    echo "[ok] ${key} set"
  fi
}

require_nonempty RPC_URL
require_nonempty PRIVATE_KEY

if [[ -n "${POOL_ADDRESSES:-}" ]]; then
  echo "[ok] POOL_ADDRESSES set"
elif [[ -n "${POOL_ADDRESS:-}" ]]; then
  echo "[ok] POOL_ADDRESS set"
else
  echo "[error] POOL_ADDRESS or POOL_ADDRESSES is empty"
  missing=1
fi

# Optional but recommended
for key in KEEPER_INTERVAL_MS KEEPER_DRY_RUN KEEPER_LOW_BALANCE_MON KEEPER_ERROR_ALERT_THRESHOLD KEEPER_HEARTBEAT_LOG_EVERY_TICKS; do
  if [[ -z "${!key:-}" ]]; then
    echo "[warn] ${key} not set (will use defaults)"
  else
    echo "[ok] ${key}=${!key}"
  fi
done

if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "[ok] Telegram alerts configured"
elif [[ -z "${TELEGRAM_BOT_TOKEN:-}" && -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "[warn] Telegram alerts not configured"
else
  echo "[error] Telegram partially configured (set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  echo "[error] env check failed"
  exit 1
fi

echo "[ok] env check passed"
