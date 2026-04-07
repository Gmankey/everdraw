#!/usr/bin/env bash
set -euo pipefail

# Collects keeper runtime evidence and appends a checkpoint block to Gate C markdown.
# Usage:
#   ./scripts/collect-gate-c-evidence.sh "T+6h"
#   ./scripts/collect-gate-c-evidence.sh "T+12h" tasks/everdraw-gate-c-evidence-2026-03-02.md

LABEL="${1:-manual}"
EVIDENCE_FILE="${2:-tasks/everdraw-gate-c-evidence-2026-03-02.md}"
SERVICE="monad-prize-keeper"
OUT_LOG="logs/keeper.out.log"
ERR_LOG="logs/keeper.err.log"
TS_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ ! -f "$EVIDENCE_FILE" ]]; then
  echo "[error] Evidence file not found: $EVIDENCE_FILE" >&2
  echo "Create it first, then rerun." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[error] systemctl not found" >&2
  exit 1
fi

ACTIVE_STATE="$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
ENABLED_STATE="$(systemctl is-enabled "$SERVICE" 2>/dev/null || true)"

STATUS_SNIPPET="$(systemctl status "$SERVICE" --no-pager 2>/dev/null | sed -n '1,12p' || true)"

LAST_BALANCE_LINE=""
LAST_HEARTBEAT_LINE=""
LAST_PENDING_LINE=""
LAST_MINED_LINE=""
ERROR_COUNT_LAST_200="0"

if [[ -f "$OUT_LOG" ]]; then
  LAST_BALANCE_LINE="$(grep -E '\[keeper\] wallet balance=' "$OUT_LOG" | tail -n 1 || true)"
  LAST_HEARTBEAT_LINE="$(grep -E '\[keeper\] heartbeat ' "$OUT_LOG" | tail -n 1 || true)"
  LAST_PENDING_LINE="$(grep -E '\[keeper\] pending ' "$OUT_LOG" | tail -n 1 || true)"
  LAST_MINED_LINE="$(grep -E '\[keeper\] mined tx=' "$OUT_LOG" | tail -n 1 || true)"
  ERROR_COUNT_LAST_200="$(tail -n 200 "$OUT_LOG" | grep -c '\[keeper\] error #' || true)"
fi

if [[ -f "$ERR_LOG" ]]; then
  ERR_RECENT="$(tail -n 30 "$ERR_LOG" || true)"
else
  ERR_RECENT="(no error log file present)"
fi

RESULT="PASS"
NOTES="service active=${ACTIVE_STATE}, enabled=${ENABLED_STATE}, errors(last200)=${ERROR_COUNT_LAST_200}"
if [[ "$ACTIVE_STATE" != "active" ]]; then
  RESULT="FAIL"
  NOTES="service not active (active=${ACTIVE_STATE}, enabled=${ENABLED_STATE})"
fi

{
  echo
  echo "### ${LABEL}"
  echo "- Captured at (UTC): ${TS_UTC}"
  echo "- Result: ${RESULT}"
  echo "- Notes: ${NOTES}"
  echo "- Service status (first lines):"
  echo '```'
  echo "$STATUS_SNIPPET"
  echo '```'
  echo "- Latest balance log: ${LAST_BALANCE_LINE:-n/a}"
  echo "- Latest heartbeat log: ${LAST_HEARTBEAT_LINE:-n/a}"
  echo "- Latest pending log: ${LAST_PENDING_LINE:-n/a}"
  echo "- Latest mined tx log: ${LAST_MINED_LINE:-n/a}"
  echo "- Recent stderr tail:"
  echo '```'
  echo "$ERR_RECENT"
  echo '```'
} >> "$EVIDENCE_FILE"

echo "[ok] Appended checkpoint '${LABEL}' to ${EVIDENCE_FILE}"