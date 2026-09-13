#!/usr/bin/env bash
# Copy the box-only pipeline state to the share, which is backed up nightly.
# scripts/install-timers.sh runs this at 03:20 UTC; by hand it is the same.
# Why: see the state-copy block in install-timers.sh.
set -euo pipefail

src="${XDG_STATE_HOME:-$HOME/.local/state}/mwk-social"
dest="$HOME/share/work/mat-mwk-social/state"

[[ -d "$src" ]] || { echo "nothing at $src"; exit 0; }
mkdir -p "$dest"
rsync -a --delete \
  --include='first-comments.json' --include='ship-cursor.json' \
  --include='topics/***' --include='yt-descriptions/***' \
  --exclude='*' \
  "$src/" "$dest/"
echo "copied $(du -sh "$dest" | cut -f1) to $dest"
