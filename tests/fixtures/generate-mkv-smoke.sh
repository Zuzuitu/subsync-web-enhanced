#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-tests/generated}"
mkdir -p "$OUT_DIR"

cat > "$OUT_DIR/target.srt" <<'SRT'
1
00:00:00,200 --> 00:00:00,900
Română: ă â î ș ț Ă Â Î Ș Ț.

2
00:00:01,100 --> 00:00:01,800
Șapte țări își păstrează diacriticele corect.
SRT

python3 - "$OUT_DIR/target-windows-1250.srt" <<'PY'
from pathlib import Path
import sys

text = """1
00:00:00,200 --> 00:00:00,900
Română: ă â î ş ţ Ă Â Î Ş Ţ.

2
00:00:01,100 --> 00:00:01,800
Şapte ţări îşi păstrează diacriticele vechi corect.
"""
Path(sys.argv[1]).write_bytes(text.encode("cp1250"))
PY

make_video_audio_mkv() {
  local output="$1"
  local sample_rate="$2"
  local codec="$3"
  local bitrate="$4"

  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=black:s=32x32:r=2:d=2" \
    -f lavfi -i "sine=frequency=440:sample_rate=${sample_rate}:duration=2" \
    -map 0:v:0 -map 1:a:0 \
    -c:v mpeg4 -q:v 5 -pix_fmt yuv420p \
    -c:a "${codec}" -b:a "${bitrate}" \
    -metadata:s:a:0 language=ita \
    -shortest \
    -f matroska "$OUT_DIR/${output}"
}

make_video_audio_mkv "reference-aac.mkv" 16000 aac 64k
make_video_audio_mkv "reference-ac3.mkv" 48000 ac3 192k
make_video_audio_mkv "reference-eac3.mkv" 48000 eac3 192k

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=32x32:r=2:d=2" \
  -f lavfi -i "sine=frequency=330:sample_rate=16000:duration=2" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
  -map 0:v:0 -map 1:a:0 -map 2:a:0 \
  -c:v mpeg4 -q:v 5 -pix_fmt yuv420p \
  -c:a:0 aac -b:a:0 64k \
  -c:a:1 ac3 -b:a:1 192k \
  -metadata:s:a:0 language=eng \
  -metadata:s:a:1 language=ita \
  -shortest \
  -f matroska "$OUT_DIR/reference-multitrack.mkv"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=32x32:r=2:d=2" \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=2" \
  -i "$OUT_DIR/target.srt" \
  -map 0:v:0 -map 1:a:0 -map 2:s:0 \
  -c:v mpeg4 -q:v 5 -pix_fmt yuv420p \
  -c:a aac -b:a 64k \
  -c:s srt \
  -metadata:s:a:0 language=ita \
  -metadata:s:s:0 language=ron \
  -shortest \
  -f matroska "$OUT_DIR/reference-embedded-subs.mkv"

# Realistic modern-video container: H.264 video with stereo AAC audio.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=160x90:r=12:d=6" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 24 \
  -c:a aac -b:a 96k -ac 2 \
  -metadata title="SubSync2 H.264 stereo fixture" \
  -metadata:s:a:0 language=ita \
  -metadata:s:a:0 title="Italian stereo" \
  -shortest \
  -f matroska "$OUT_DIR/reference-h264-aac-stereo.mkv"

# Modern HEVC + 5.1 path. A mono source is deliberately fanned out to six
# channels so AudioDec + Resampler must process a real 5.1 channel layout.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=160x90:r=12:d=6" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -filter:a "pan=5.1|FL=c0|FR=c0|FC=c0|LFE=c0|BL=c0|BR=c0" \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx265 -preset ultrafast -x265-params log-level=error -pix_fmt yuv420p -g 24 \
  -c:a eac3 -b:a 384k \
  -metadata title="SubSync2 HEVC 5.1 fixture" \
  -metadata:s:a:0 language=ita \
  -metadata:s:a:0 title="Italian 5.1" \
  -shortest \
  -f matroska "$OUT_DIR/reference-hevc-eac3-5.1.mkv"

# Track-order stress: the desired English track is second and default while the
# first track is a different language. This catches accidental first-track use.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=64x64:r=2:d=6" \
  -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=6" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=6" \
  -map 0:v:0 -map 1:a:0 -map 2:a:0 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a:0 aac -b:a:0 64k -ac:a:0 2 \
  -c:a:1 ac3 -b:a:1 384k -ac:a:1 6 \
  -metadata:s:a:0 language=spa \
  -metadata:s:a:0 title="Spanish commentary" \
  -metadata:s:a:1 language=eng \
  -metadata:s:a:1 title="English main 5.1" \
  -disposition:a:0 0 -disposition:a:1 default \
  -shortest \
  -f matroska "$OUT_DIR/reference-multitrack-reversed.mkv"

# Long-duration, low-byte-size fixture used to validate time-window seeking like
# Synchronizer's parallel reference jobs. It stresses duration/seek behavior,
# not large-file browser memory pressure.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=black:s=64x64:r=1:d=125" \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=125" \
  -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 10 -keyint_min 10 -sc_threshold 0 \
  -c:a aac -b:a 32k \
  -metadata:s:a:0 language=ita \
  -shortest \
  -f matroska "$OUT_DIR/reference-long-seek.mkv"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=2" \
  -c:a pcm_s16le \
  "$OUT_DIR/reference-audio.wav"

MANIFEST="$OUT_DIR/mkv-fixture-manifest.json"
python3 - "$OUT_DIR" "$MANIFEST" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
files = [
    "reference-aac.mkv",
    "reference-ac3.mkv",
    "reference-eac3.mkv",
    "reference-multitrack.mkv",
    "reference-embedded-subs.mkv",
    "reference-h264-aac-stereo.mkv",
    "reference-hevc-eac3-5.1.mkv",
    "reference-multitrack-reversed.mkv",
    "reference-long-seek.mkv",
    "reference-audio.wav",
]
manifest = {}
for name in files:
    path = root / name
    raw = subprocess.check_output([
        "ffprobe", "-v", "error",
        "-show_entries",
        "format=format_name,duration:stream=index,codec_type,codec_name,channels,channel_layout:stream_tags=language,title",
        "-of", "json", str(path),
    ], text=True)
    manifest[name] = {
        "bytes": path.stat().st_size,
        "probe": json.loads(raw),
    }
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps(manifest, indent=2, ensure_ascii=False))
PY

for file in \
  reference-aac.mkv \
  reference-ac3.mkv \
  reference-eac3.mkv \
  reference-multitrack.mkv \
  reference-embedded-subs.mkv \
  reference-h264-aac-stereo.mkv \
  reference-hevc-eac3-5.1.mkv \
  reference-multitrack-reversed.mkv \
  reference-long-seek.mkv \
  reference-audio.wav
do
  echo "Generated fixture: $file"
done
