#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-tests/generated}"
mkdir -p "$OUT_DIR"

cat > "$OUT_DIR/target.srt" <<'SRT'
1
00:00:00,200 --> 00:00:00,900
SubSync2 deterministic subtitle fixture.

2
00:00:01,100 --> 00:00:01,800
External SRT path is alive.
SRT

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=32x32:r=2:d=2" \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=2" \
  -map 0:v:0 -map 1:a:0 \
  -c:v mpeg4 -q:v 5 -pix_fmt yuv420p \
  -c:a aac -b:a 64k \
  -metadata:s:a:0 language=eng \
  -shortest \
  -f matroska "$OUT_DIR/reference-aac.mkv"

ffprobe -v error \
  -show_entries format=format_name,duration:stream=index,codec_type,codec_name:stream_tags=language \
  -of json "$OUT_DIR/reference-aac.mkv"
