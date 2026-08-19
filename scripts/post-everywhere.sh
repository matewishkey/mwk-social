#!/usr/bin/env bash
# Post the same content (plus an image) to several accounts, and a video to
# YouTube. A thin wrapper over scripts/post.js, which is where the real work
# lives — so posts sent this way also carry the standard first comment.
#
# Usage:
#   scripts/post-everywhere.sh "Your post text" assets/ship-card.png assets/ship-video.mp4
set -euo pipefail
text="${1:?usage: post-everywhere.sh <text> <image> [video]}"
image="${2:?image file required}"
video="${3:-}"

# Positional-only, and it publishes immediately — so refuse anything that looks
# like a flag rather than silently ignoring it. (A stray --dry-run here once put
# a real post on the Page.) Use scripts/post.js directly for flags.
[ "$#" -le 3 ] || { echo "too many arguments; flags belong on scripts/post.js" >&2; exit 2; }
for arg in "$@"; do
  case "$arg" in
    --*) echo "$arg is not accepted here — use scripts/post.js for flags" >&2; exit 2 ;;
  esac
done
[ -f "$image" ] || { echo "image not found: $image" >&2; exit 2; }
[ -z "$video" ] || [ -f "$video" ] || { echo "video not found: $video" >&2; exit 2; }

here="$(cd "$(dirname "$0")" && pwd)"

# <image-accounts>: comma-separated IDs from `zernio accounts:list`
IMAGE_ACCOUNTS="${ZERNIO_IMAGE_ACCOUNTS:?export ZERNIO_IMAGE_ACCOUNTS=<id1>,<id2>,...}"
# <youtube-account>: optional, only used when a video is passed
YT_ACCOUNT="${ZERNIO_YT_ACCOUNT:-}"

"$here/post.js" --text "$text" --accounts "$IMAGE_ACCOUNTS" --media "$image"

if [ -n "$video" ] && [ -n "$YT_ACCOUNT" ]; then
  "$here/post.js" --text "$text" --accounts "$YT_ACCOUNT" --media "$video" \
    --title "${ZERNIO_YT_TITLE:-$text}"
fi
