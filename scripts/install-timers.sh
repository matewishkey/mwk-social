#!/usr/bin/env bash
# Install (or refresh) the systemd --user timers this pipeline runs on.
#
#   scripts/install-timers.sh                 # all of them
#   scripts/install-timers.sh first-comment   # just one
#
# Logs:  journalctl --user -u mwk-replies -f
#        journalctl --user -u mwk-first-comment -f
#        journalctl --user -u mwk-ship-events -f
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"

# Every unit runs through scripts/with-secrets.sh: the transcription keys live in
# ~/.secrets and the dashboard's ingest token in td-sops, and neither is
# something systemd's EnvironmentFile can read. mise owns node and systemd gets
# no login shell, so PATH is spelled out.
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
ExecStart=$repo/scripts/with-secrets.sh $command
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

if [[ "$want" == all || "$want" == ship-events ]]; then
  # Every two minutes. It is cheap, it sends an empty batch when idle, and that
  # heartbeat is the only thing that stops "nothing happened" and "the box is
  # off" looking identical on the dashboard.
  unit mwk-ship-events \
    'Ship the MWK event log to the dashboard' \
    "$repo/scripts/ship-events.js" \
    '*:0/2' \
    'Ship new MWK events to Cloudflare'
fi

if [[ "$want" == all || "$want" == queue ]]; then
  # Every five minutes, so something queued goes out within five rather than
  # waiting up to an hour for a tick. This is safe to run often because the pace
  # lives in lib/pace.js, not here: whyNotNow() says no most of the time and this
  # is a dumb heartbeat asking it.
  #
  # It STOPS at :45, and that gap is load-bearing. The comment watcher runs at
  # :00, and Zernio posts the native first comment seconds after a post goes
  # live — so a post published at :55 could be looked at before its own comment
  # had landed, and the watcher, seeing no marker, would post a second one.
  # Fifteen minutes of clearance is what stops that.
  unit mwk-queue \
    'Post the next queued MWK item, if it is a good moment' \
    "$repo/scripts/run-queue.js --scheduled" \
    '*:05,10,15,20,25,30,35,40,45' \
    'Check whether a queued post is due'
fi

if [[ "$want" == all || "$want" == ship-stats ]]; then
  # Hourly, not every two minutes: these come from Zernio rather than off the
  # disk, and a month of analytics is not worth re-fetching 30 times an hour.
  unit mwk-ship-stats \
    'Ship MWK analytics, follower counts and the platform table' \
    "$repo/scripts/ship-stats.js" \
    '*:35' \
    'Ship MWK analytics to the dashboard'
fi

if [[ "$want" == all || "$want" == yt-notes ]]; then
  # Daily, not hourly. It reads every video's current description through
  # yt-dlp and transcribes the ones it has not seen, so a run is minutes rather
  # than seconds — and a description does not change on its own between runs.
  unit mwk-yt-notes \
    'Draft YouTube show notes and file them for approval' \
    "$repo/scripts/yt-description.js --sync" \
    '05:40' \
    'Draft MWK YouTube show notes'
fi

if [[ "$want" == all || "$want" == replies ]]; then
  # Every twenty minutes, all day. Two reasons it can be this often and still be
  # cheap: the search carries a per-query high-water mark, so a run that finds
  # nothing new reads nothing and costs nothing, and the daily cap lives in
  # config/replies.json rather than in the schedule. Frequency is the point —
  # X rewards a reply posted while the post is still gaining, and an hourly
  # timer would miss that window on most posts.
  #
  # :07 past, deliberately off every other unit's slot: this one makes model
  # calls and the box is 15 GB with earlyoom watching.
  unit mwk-replies \
    'Find X posts worth replying to, send what he approved' \
    "$repo/scripts/replies.js --find" \
    '*:07/20' \
    'Draft and send MWK X replies'
fi

systemctl --user daemon-reload
for name in mwk-first-comment mwk-ship-events mwk-queue mwk-ship-stats mwk-yt-notes mwk-replies; do
  [[ -f "$unit_dir/$name.timer" ]] || continue
  systemctl --user enable --now "$name.timer"
done
systemctl --user list-timers 'mwk-*' --no-pager
