#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-tests/generated/large-file-stress}"
mkdir -p "$OUT_DIR"

DURATION_SECONDS="${SUBSYNC2_LARGE_MKV_SECONDS:-90}"
MIN_BYTES="${SUBSYNC2_LARGE_MKV_MIN_BYTES:-134217728}"

cat > "$OUT_DIR/target.rum.srt" <<'SRT'
1
00:00:02,000 --> 00:00:05,000
prieten familie oameni muzică stradă

2
00:00:08,000 --> 00:00:11,000
dimineață poliție întrebare răspuns fereastră
SRT

# Keep this fixture representative of a real direct-MKV path instead of
# inflating it with an artificial attachment or huge uncompressed side track.
# A deterministic, high-entropy 720p H.264 stream encoded losslessly provides
# the byte pressure while the selected English AAC track exercises the normal
# demux -> audio decode -> resample -> speech path.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=${DURATION_SECONDS}" \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=${DURATION_SECONDS}" \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset ultrafast -crf 0 -pix_fmt yuv420p -g 48 \
  -c:a aac -b:a 64k -ar 16000 -ac 1 \
  -metadata title="SubSync2 large-file browser stress fixture" \
  -metadata:s:a:0 language=eng \
  -metadata:s:a:0 title="English reference" \
  -disposition:a:0 default \
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
    "stream=index,codec_type,codec_name,width,height,channels,channel_layout,disposition:"
    "stream_tags=language,title",
    "-of", "json", str(mkv),
], text=True)
probe = json.loads(raw)
video = [s for s in probe.get("streams", []) if s.get("codec_type") == "video"]
audio = [s for s in probe.get("streams", []) if s.get("codec_type") == "audio"]

if len(video) != 1 or video[0].get("codec_name") != "h264":
    raise SystemExit("Large fixture must contain one H.264 video stream")
if video[0].get("width") != 1280 or video[0].get("height") != 720:
    raise SystemExit("Large fixture video dimensions changed")
if len(audio) != 1 or audio[0].get("codec_name") != "aac":
    raise SystemExit("Large fixture must contain one AAC audio stream")
if audio[0].get("tags", {}).get("language") != "eng":
    raise SystemExit("English reference stream language metadata changed")
if audio[0].get("tags", {}).get("title") != "English reference":
    raise SystemExit("English reference stream title metadata changed")

manifest = {
    "bytes": size,
    "mib": round(size / (1024 * 1024), 2),
    "probe": probe,
    "purpose": (
        "Large direct-MKV browser/WORKERFS stress using a high-byte-rate "
        "H.264 video stream plus the normal selected English AAC reference path."
    ),
}
manifest_path.write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(manifest, indent=2, ensure_ascii=False))
PY
