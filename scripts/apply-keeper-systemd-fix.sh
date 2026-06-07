#!/usr/bin/env bash
set -euo pipefail

cat > /tmp/monad-prize-keeper.service <<'UNIT'
[Unit]
Description=EverDraw Monad Prize Keeper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=c
WorkingDirectory=/home/c/.openclaw/workspace/everdraw-clean
EnvironmentFile=/home/c/.config/everdraw/keeper-mainnet.env
ExecStart=/usr/bin/node /home/c/.openclaw/workspace/everdraw-clean/scripts/keeper-execute-next.js
Restart=always
RestartSec=5
StandardOutput=append:/home/c/.openclaw/workspace/everdraw-clean/logs/keeper-systemd.out.log
StandardError=append:/home/c/.openclaw/workspace/everdraw-clean/logs/keeper-systemd.err.log

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=false

[Install]
WantedBy=multi-user.target
UNIT

sudo install -m 0644 /tmp/monad-prize-keeper.service /etc/systemd/system/monad-prize-keeper.service
sudo systemctl daemon-reload
sudo systemctl enable --now monad-prize-keeper.service
systemctl status monad-prize-keeper.service --no-pager
