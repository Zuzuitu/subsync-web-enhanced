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

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=2" \
  -c:a pcm_s16le \
  "$OUT_DIR/reference-audio.wav"

for file in \
  reference-aac.mkv \
  reference-ac3.mkv \
  reference-eac3.mkv \
  reference-multitrack.mkv \
  reference-embedded-subs.mkv \
  reference-audio.wav
do
  echo "Generated fixture: $file"
  ffprobe -v error \
    -show_entries format=format_name,duration:stream=index,codec_type,codec_name:stream_tags=language \
    -of json "$OUT_DIR/$file"
done
