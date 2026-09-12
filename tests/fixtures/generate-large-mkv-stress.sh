#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-tests/generated/large-file-stress}"
mkdir -p "$OUT_DIR"

DURATION_SECONDS="${SUBSYNC2_LARGE_MKV_SECONDS:-48}"
MIN_BYTES="${SUBSYNC2_LARGE_MKV_MIN_BYTES:-134217728}"

cat > "$OUT_DIR/target.rum.srt" <<'SRT'
1
00:00:02,000 --> 00:00:05,000
prieten familie oameni muzică stradă

2
00:00:08,000 --> 00:00:11,000
dimineață poliție întrebare răspuns fereastră
SRT

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=160x90:r=12:d=${DURATION_SECONDS}" \
  -f lavfi -i "anullsrc=channel_layout=7.1:sample_rate=96000" \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=${DURATION_SECONDS}" \
  -map 0:v:0 -map 1:a:0 -map 2:a:0 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 \
  -c:a:0 pcm_s32le -ar:a:0 96000 -ac:a:0 8 \
  -c:a:1 aac -b:a:1 64k -ar:a:1 16000 -ac:a:1 1 \
  -metadata title="SubSync2 large-file browser stress fixture" \
  -metadata:s:a:0 language=spa \
  -metadata:s:a:0 title="Stress ballast 7.1 PCM" \
  -metadata:s:a:1 language=eng \
  -metadata:s:a:1 title="English reference" \
  -disposition:a:0 0 -disposition:a:1 default \
  -t "${DURATION_SECONDS}" \
  -f matroska "$OUT_DIR/reference-large.mkv"

python3 - "$OUT_DIR/reference-large.mkv" "$OUT_DIR/fixture.json" "$MIN_BYTES" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

mkv = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
min_bytes = int(sys.argv[3])

size = mkv.stat().st_size
if size < min_bytes:
    raise SystemExit(f"Large MKV fixture too small: {size} < {min_bytes}")

raw = subprocess.check_output([
    "ffprobe", "-v", "error",
    "-show_entries",
    "format=format_name,duration,size:"
    "stream=index,codec_type,codec_name,channels,channel_layout,disposition:"
    "stream_tags=language,title",
    "-of", "json", str(mkv),
], text=True)
probe = json.loads(raw)
audio = [s for s in probe.get("streams", []) if s.get("codec_type") == "audio"]

if len(audio) < 2:
    raise SystemExit(f"Expected at least two audio streams, got {len(audio)}")
if audio[0].get("codec_name") != "pcm_s32le" or audio[0].get("channels") != 8:
    raise SystemExit("Large ballast stream is not 7.1 PCM s32le")
if audio[0].get("tags", {}).get("language") != "spa":
    raise SystemExit("Large ballast stream language metadata changed")
if audio[1].get("codec_name") != "aac":
    raise SystemExit("English reference stream is not AAC")
if audio[1].get("tags", {}).get("language") != "eng":
    raise SystemExit("English reference stream language metadata changed")
if audio[1].get("tags", {}).get("title") != "English reference":
    raise SystemExit("English reference stream title metadata changed")

manifest = {
    "bytes": size,
    "mib": round(size / (1024 * 1024), 2),
    "probe": probe,
    "purpose": (
        "Large direct-MKV browser/WORKERFS stress with an unselected high-byte-rate "
        "PCM track and a selected English AAC reference track."
    ),
}
manifest_path.write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(manifest, indent=2, ensure_ascii=False))
PY
