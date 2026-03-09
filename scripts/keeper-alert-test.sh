#!/usr/bin/env bash
set -euo pipefail

cd /home/c/.openclaw/workspace/monad-prize

if [[ -f scripts/keeper.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source scripts/keeper.env
  set +a
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "[error] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in scripts/keeper.env"
  exit 1
fi

TS="$(date -Is)"
TEXT="✅ Everdraw keeper alert test\nTime: ${TS}\nHost: $(hostname)\nService: monad-prize-keeper"

RESP="$(curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${TEXT}\"}")"

if echo "$RESP" | grep -q '"ok":true'; then
  echo "[ok] Telegram alert test sent"
  echo "$RESP"
  exit 0
else
  echo "[error] Telegram alert test failed"
  echo "$RESP"
  exit 1
fi
