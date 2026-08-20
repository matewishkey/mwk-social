#!/usr/bin/env bash
# Install (or refresh) the systemd --user timers this pipeline runs on.
#
#   scripts/install-timers.sh                 # both
#   scripts/install-timers.sh first-comment   # just one
#
# Logs:  journalctl --user -u mwk-first-comment -f
#        journalctl --user -u mwk-mirror -f
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"

# Both units run through zsh so ~/.secrets is sourced: the transcription keys
# live there and it is shell syntax, which systemd's EnvironmentFile cannot
# parse. mise owns node and systemd gets no login shell, so PATH is spelled out.
unit() {
  local name="$1" description="$2" command="$3" schedule="$4" timer_description="$5"
  cat > "$unit_dir/$name.service" <<UNIT
[Unit]
Description=$description
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$repo
ExecStart=/usr/bin/zsh -c 'source ~/.secrets && exec $command'
UNIT

  cat > "$unit_dir/$name.timer" <<UNIT
[Unit]
Description=$timer_description

[Timer]
OnCalendar=$schedule
Persistent=true
Unit=$name.service

[Install]
WantedBy=timers.target
UNIT
}

want="${1:-all}"

if [[ "$want" == all || "$want" == first-comment ]]; then
  unit mwk-first-comment \
    'Post the standard first comment on new MWK posts' \
    "$repo/scripts/first-comment.js" \
    '*:00' \
    'Check for new MWK posts needing their first comment'
fi

if [[ "$want" == all || "$want" == mirror ]]; then
  # At :10, ten minutes behind the comment run, so a clip this mirror publishes
  # has settled before the watcher looks for it. --scheduled is what makes an
  # hourly timer produce "a few a day": the pace lives in the script, so a hand
  # run obeys it too, and the timer stays a dumb heartbeat.
  unit mwk-mirror \
    'Mirror new MWK reels to the platforms Restream misses' \
    "$repo/scripts/mirror.js --apply --scheduled" \
    '*:10' \
    'Check whether a reel is due to be mirrored'
fi

systemctl --user daemon-reload
for name in mwk-first-comment mwk-mirror; do
  [[ -f "$unit_dir/$name.timer" ]] || continue
  systemctl --user enable --now "$name.timer"
done
systemctl --user list-timers 'mwk-*' --no-pager
