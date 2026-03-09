#!/usr/bin/env bash
set -euo pipefail

SERVICE="monad-prize-keeper"
OUT_LOG="/home/c/.openclaw/workspace/monad-prize/logs/keeper.out.log"
ERR_LOG="/home/c/.openclaw/workspace/monad-prize/logs/keeper.err.log"

echo "== keeper health =="
echo "time: $(date -Is)"

echo
echo "[systemd]"
systemctl is-enabled "$SERVICE" 2>/dev/null || true
systemctl is-active "$SERVICE" 2>/dev/null || true
systemctl status "$SERVICE" --no-pager | sed -n '1,12p' || true

echo
echo "[recent keeper.out]"
if [[ -f "$OUT_LOG" ]]; then
  tail -n 80 "$OUT_LOG"
else
  echo "missing: $OUT_LOG"
fi

echo
echo "[summary metrics from keeper.out]"
if [[ -f "$OUT_LOG" ]]; then
  echo "errors(last200): $(tail -n 200 "$OUT_LOG" | grep -c '\[keeper\] error #' || true)"
  echo "recommit warnings(last200): $(tail -n 200 "$OUT_LOG" | grep -c 'recommit required' || true)"
  echo "last balance: $(grep -E '\[keeper\] wallet balance=' "$OUT_LOG" | tail -n 1 || echo n/a)"
  echo "last heartbeat: $(grep -E '\[keeper\] heartbeat ' "$OUT_LOG" | tail -n 1 || echo n/a)"
  echo "last mined tx: $(grep -E '\[keeper\] mined tx=' "$OUT_LOG" | tail -n 1 || echo n/a)"
fi

echo
echo "[recent keeper.err]"
if [[ -f "$ERR_LOG" ]]; then
  tail -n 40 "$ERR_LOG"
else
  echo "missing: $ERR_LOG"
fi
