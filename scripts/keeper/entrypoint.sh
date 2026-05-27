#!/bin/sh
set -eu

mkdir -p /app/logs
touch /app/logs/keeper-mainnet-live.out.log /app/logs/keeper-mainnet-live.err.log

node scripts/keeper-watchdog.js &
watchdog_pid="$!"

tail -n +1 -F /app/logs/keeper-mainnet-live.out.log /app/logs/keeper-mainnet-live.err.log &
tail_pid="$!"

shutdown() {
  kill "$watchdog_pid" "$tail_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  wait "$tail_pid" 2>/dev/null || true
}

trap shutdown INT TERM

set +e
wait "$watchdog_pid"
status="$?"
set -e

kill "$tail_pid" 2>/dev/null || true
wait "$tail_pid" 2>/dev/null || true
exit "$status"
