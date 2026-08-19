#!/usr/bin/env bash
# Install (or refresh) the systemd --user timer that runs first-comment.js.
#
#   scripts/install-first-comment-timer.sh            # hourly
#   INTERVAL=30min scripts/install-first-comment-timer.sh
#
# Logs: journalctl --user -u mwk-first-comment -f
set -euo pipefail
interval="${INTERVAL:-1h}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"

cat > "$unit_dir/mwk-first-comment.service" <<UNIT
[Unit]
Description=Post the standard first comment on new MWK posts
After=network-online.target

[Service]
Type=oneshot
# mise owns node; systemd gets no login shell, so spell the PATH out.
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$repo
# Sourced through zsh because the transcription keys live in ~/.secrets, which is
# shell syntax systemd's EnvironmentFile cannot parse. Same pattern as the crontab.
ExecStart=/usr/bin/zsh -c 'source ~/.secrets && exec $repo/scripts/first-comment.js'
UNIT

cat > "$unit_dir/mwk-first-comment.timer" <<UNIT
[Unit]
Description=Check for new MWK posts needing their first comment

[Timer]
OnBootSec=5min
OnUnitActiveSec=$interval
Unit=mwk-first-comment.service

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now mwk-first-comment.timer
systemctl --user list-timers mwk-first-comment.timer --no-pager
