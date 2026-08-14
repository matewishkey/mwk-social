#!/usr/bin/env bash
# Post the same content (plus an image) to several accounts, and a video to
# YouTube, using the Zernio CLI. Fill in your own account IDs from
# `zernio accounts:list`.
#
# Usage:
#   scripts/post-everywhere.sh "Your post text" assets/ship-card.png assets/ship-video.mp4
set -euo pipefail
text="${1:?usage: post-everywhere.sh <text> <image> [video]}"
image="${2:?image file required}"
video="${3:-}"

zernio() { ./node_modules/.bin/zernio "$@"; }

# <image-accounts>: comma-separated IDs from `zernio accounts:list`
IMAGE_ACCOUNTS="${ZERNIO_IMAGE_ACCOUNTS:?export ZERNIO_IMAGE_ACCOUNTS=<id1>,<id2>,...}"
# <youtube-account>: optional, only used when a video is passed
YT_ACCOUNT="${ZERNIO_YT_ACCOUNT:-}"

img_url=$(zernio media:upload "$image" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).url))')
zernio posts:create --text "$text" --accounts "$IMAGE_ACCOUNTS" --media "$img_url" --pretty

if [ -n "$video" ] && [ -n "$YT_ACCOUNT" ]; then
  vid_url=$(zernio media:upload "$video" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).url))')
  zernio posts:create --title "${ZERNIO_YT_TITLE:-$text}" --text "$text" \
    --accounts "$YT_ACCOUNT" --media "$vid_url" --pretty
fi
