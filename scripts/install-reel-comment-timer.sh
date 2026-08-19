#!/usr/bin/env bash
# Install (or refresh) the systemd --user timer that runs reel-first-comment.js.
#
#   scripts/install-reel-comment-timer.sh            # every 15 minutes
#   INTERVAL=30min scripts/install-reel-comment-timer.sh
#
# Logs: journalctl --user -u mwk-reel-comment -f
set -euo pipefail
interval="${INTERVAL:-15min}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"

cat > "$unit_dir/mwk-reel-comment.service" <<UNIT
[Unit]
Description=Post the standard first comment on new MWK reels
After=network-online.target

[Service]
Type=oneshot
# mise owns node; systemd gets no login shell, so spell the PATH out.
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$repo
ExecStart=$repo/scripts/reel-first-comment.js
UNIT

cat > "$unit_dir/mwk-reel-comment.timer" <<UNIT
[Unit]
Description=Check for new MWK reels needing their first comment

[Timer]
OnBootSec=5min
OnUnitActiveSec=$interval
Unit=mwk-reel-comment.service

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now mwk-reel-comment.timer
systemctl --user list-timers mwk-reel-comment.timer --no-pager
