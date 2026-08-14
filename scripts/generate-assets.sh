#!/usr/bin/env bash
# Generate the announcement card (1080x1080), wide card (1920x1080) and a 10s
# 1080p video from the wide card. Requires ImageMagick (`convert`) and ffmpeg.
# Usage: scripts/generate-assets.sh [output-dir]
set -euo pipefail
out="${1:-assets}"
mkdir -p "$out"

grid() { # subtle background grid: grid <w> <h>
  local w=$1 h=$2 i
  for i in $(seq 0 60 "$w"); do printf 'line %s,0 %s,%s ' "$i" "$i" "$h"; done
  for i in $(seq 0 60 "$h"); do printf 'line 0,%s %s,%s ' "$i" "$w" "$i"; done
}

convert -size 1080x1080 gradient:'#0b1026-#1e1b4b' \
  \( -size 1080x1080 xc:none -stroke '#ffffff10' -strokewidth 1 -draw "$(grid 1080 1080)" \) \
  -composite \
  -font DejaVu-Sans-Bold -fill '#facc15' -pointsize 54 -gravity north -annotate +0+150 'SHIPPED IN ONE HOUR  ⚡' \
  -font DejaVu-Sans-Bold -fill white -pointsize 96 -gravity center -annotate +0-120 'A full social' \
  -font DejaVu-Sans-Bold -fill white -pointsize 96 -gravity center -annotate +0-10 'posting pipeline.' \
  -font DejaVu-Sans -fill '#a5b4fc' -pointsize 44 -gravity center -annotate +0+130 'Facebook · LinkedIn · Instagram · YouTube' \
  -font DejaVu-Sans-Bold -fill '#34d399' -pointsize 40 -gravity south -annotate +0+180 '5 accounts  ·  1 CLI  ·  1 API' \
  -font DejaVu-Sans -fill '#818cf8' -pointsize 34 -gravity south -annotate +0+110 'powered by zernio.com' \
  "$out/ship-card.png"

convert -size 1920x1080 gradient:'#0b1026-#1e1b4b' \
  \( -size 1920x1080 xc:none -stroke '#ffffff10' -strokewidth 1 -draw "$(grid 1920 1080)" \) \
  -composite \
  -font DejaVu-Sans-Bold -fill '#facc15' -pointsize 52 -gravity north -annotate +0+140 'SHIPPED IN ONE HOUR  ⚡' \
  -font DejaVu-Sans-Bold -fill white -pointsize 110 -gravity center -annotate +0-80 'A full social posting pipeline.' \
  -font DejaVu-Sans -fill '#a5b4fc' -pointsize 46 -gravity center -annotate +0+60 'Facebook · LinkedIn · Instagram · YouTube' \
  -font DejaVu-Sans-Bold -fill '#34d399' -pointsize 42 -gravity south -annotate +0+160 '5 accounts  ·  1 CLI  ·  1 API' \
  -font DejaVu-Sans -fill '#818cf8' -pointsize 34 -gravity south -annotate +0+100 'powered by zernio.com' \
  "$out/ship-wide.png"

ffmpeg -y -loglevel error -loop 1 -i "$out/ship-wide.png" -f lavfi -i anullsrc=r=44100:cl=stereo \
  -filter_complex "[0:v]scale=2112:1188,zoompan=z='1+0.10*in/250':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=250:s=1920x1080:fps=25,fade=t=in:st=0:d=0.8,fade=t=out:st=9.2:d=0.8[v]" \
  -map "[v]" -map 1:a -t 10 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$out/ship-video.mp4"

echo "done: $out/ship-card.png $out/ship-wide.png $out/ship-video.mp4"
