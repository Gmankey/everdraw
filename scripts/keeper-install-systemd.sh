#!/usr/bin/env bash
set -euo pipefail

cd /home/c/.openclaw/workspace/monad-prize

echo "[1/5] env validation"
bash scripts/keeper-env-check.sh

echo "[2/5] ensure logs dir"
mkdir -p logs

echo "[3/5] install service"
sudo cp scripts/monad-prize-keeper.service /etc/systemd/system/monad-prize-keeper.service

echo "[4/5] daemon reload + enable/start"
sudo systemctl daemon-reload
sudo systemctl enable --now monad-prize-keeper

echo "[5/5] status"
sudo systemctl status monad-prize-keeper --no-pager | sed -n '1,14p'

echo "[ok] systemd install/start complete"
