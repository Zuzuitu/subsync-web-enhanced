#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "generated" / "romanian-audio-e2e"
OUT.mkdir(parents=True, exist_ok=True)

PHRASES = [
    "Prietenul meu așteaptă răspunsul important în această dimineață.",
    "Oamenii discută împreună despre familie și despre oraș.",
    "Poliția a primit întrebarea corectă și caută răspunsul.",
    "Această problemă diferită are o soluție foarte simplă.",
    "Mulțumesc pentru ajutorul oferit în această seară frumoasă.",
    "Părintele își amintește povestea despre fereastra deschisă.",
    "Astăzi înțelegem mai bine întrebarea și răspunsul complet.",
    "Niciodată nu uităm prietenii care așteaptă acasă împreună.",
    "Dimineața orașul devine liniștit iar oamenii merg înainte.",
    "Familia pregătește mâncarea și vorbește despre ziua următoare.",
    "Întrebarea importantă primește răspuns după câteva minute.",
    "Prietenii ascultă muzică românească și privesc strada liniștită.",
    "Această fetiță zâmbește când vede părinții lângă fereastră.",
    "Răspunsul corect poate schimba complet această problemă dificilă.",
    "Oamenii se întorc acasă înainte de începutul serii liniștite.",
    "Mulțumesc prietenilor pentru răbdare și pentru ajutorul important.",
    "Copiii privesc curcubeul colorat deasupra grădinii liniștite.",
    "Profesorul explică problema folosind exemple clare și răbdătoare.",
    "Călătorii așteaptă trenul dimineții lângă clădirea principală.",
    "Bunica pregătește prăjitura preferată pentru întreaga familie.",
    "Vecinii discută despre vreme și despre străzile aglomerate.",
    "Biblioteca păstrează povești interesante pentru cititorii curioși.",
    "Fereastra rămâne deschisă deoarece aerul dimineții este plăcut.",
    "Prietenii găsesc împreună răspunsul potrivit pentru întrebare.",
]

RATE = 16000
WIDTH = 2
CHANNELS = 1
OFFSET = 8.0
INITIAL_SILENCE = 1.0
GAP = 0.65
PIPER_URL = "http://127.0.0.1:5001/synthesize"
MIN_CORRELATION_BUCKETS = 20
SPARSE_REGRESSION = os.environ.get("SUBSYNC_ROMANIAN_SPARSE_REGRESSION", "1") == "1"
SPARSE_DURATION = 481.0
SPARSE_EDGE_MARGIN = 18.0
MIN_SPEECH_SPAN_RATIO = 0.85

if len(PHRASES) <= MIN_CORRELATION_BUCKETS:
    raise SystemExit(
        f"Romanian E2E fixture must have more than {MIN_CORRELATION_BUCKETS} subtitle cues; "
        f"got {len(PHRASES)}"
    )

def synthesize(text, destination):
    body = json.dumps({"text": text}).encode("utf-8")
    request = urllib.request.Request(
        PIPER_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        if response.status != 200:
            raise SystemExit(f"Piper HTTP {response.status} for {text!r}")
        destination.write_bytes(response.read())

def srt_ts(seconds):
    millis_total = round(seconds * 1000)
    hours, rem = divmod(millis_total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds_i, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds_i:02d},{millis:03d}"

segments = []

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    for idx, phrase in enumerate(PHRASES):
        raw = tmp / f"{idx:02d}-raw.wav"
        normalized = tmp / f"{idx:02d}.wav"
        synthesize(phrase, raw)
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(raw),
            "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le",
            str(normalized),
        ], check=True)

        with wave.open(str(normalized), "rb") as wav:
            if (
                wav.getframerate() != RATE
                or wav.getnchannels() != CHANNELS
                or wav.getsampwidth() != WIDTH
            ):
                raise SystemExit(f"Unexpected normalized audio format for fixture item {idx}")
            frames = wav.readframes(wav.getnframes())

        segments.append({
            "phrase": phrase,
            "frames": frames,
            "duration": len(frames) / WIDTH / RATE,
        })

timeline = []

if SPARSE_REGRESSION:
    # The sparse regression must resemble a real long title: speech is spread
    # across the whole timeline instead of being front-loaded and followed by
    # synthetic silence. This gives distributed probes independent evidence
    # without coupling the fixture to the planner implementation.
    total_samples = round(SPARSE_DURATION * RATE)
    combined = bytearray(b"\x00" * total_samples * WIDTH)
    previous_end = 0.0
    centers_span = SPARSE_DURATION - 2 * SPARSE_EDGE_MARGIN

    for idx, segment in enumerate(segments):
        center = (
            SPARSE_EDGE_MARGIN
            if len(segments) == 1
            else SPARSE_EDGE_MARGIN + idx * centers_span / (len(segments) - 1)
        )
        start = center - segment["duration"] / 2
        end = start + segment["duration"]

        if start < 0 or end > SPARSE_DURATION:
            raise SystemExit(
                f"Distributed Romanian fixture segment {idx} falls outside timeline: "
                f"{start:.3f}-{end:.3f}s"
            )
        if idx and start <= previous_end:
            raise SystemExit(
                f"Distributed Romanian fixture segments overlap at {idx}: "
                f"{start:.3f}s <= {previous_end:.3f}s"
            )

        start_sample = round(start * RATE)
        end_sample = start_sample + len(segment["frames"]) // WIDTH
        byte_start = start_sample * WIDTH
        byte_end = byte_start + len(segment["frames"])
        combined[byte_start:byte_end] = segment["frames"]

        actual_start = start_sample / RATE
        actual_end = end_sample / RATE
        timeline.append({
            "phrase": segment["phrase"],
            "audioStart": actual_start,
            "audioEnd": actual_end,
            "subtitleStart": actual_start + OFFSET,
            "subtitleEnd": actual_end + OFFSET,
        })
        previous_end = actual_end

    speech_span = timeline[-1]["audioEnd"] - timeline[0]["audioStart"]
    speech_span_ratio = speech_span / SPARSE_DURATION
    if speech_span_ratio < MIN_SPEECH_SPAN_RATIO:
        raise SystemExit(
            f"Distributed Romanian fixture covers only {speech_span_ratio:.3f} of timeline"
        )
else:
    combined = bytearray(b"\x00" * int(RATE * INITIAL_SILENCE) * WIDTH)
    for segment in segments:
        start = len(combined) / WIDTH / RATE
        combined.extend(segment["frames"])
        end = len(combined) / WIDTH / RATE
        timeline.append({
            "phrase": segment["phrase"],
            "audioStart": start,
            "audioEnd": end,
            "subtitleStart": start + OFFSET,
            "subtitleEnd": end + OFFSET,
        })
        combined.extend(b"\x00" * int(RATE * GAP) * WIDTH)
    speech_span = timeline[-1]["audioEnd"] - timeline[0]["audioStart"]
    speech_span_ratio = speech_span / (len(combined) / WIDTH / RATE)

wav_path = OUT / "reference-romanian.wav"
with wave.open(str(wav_path), "wb") as wav:
    wav.setnchannels(CHANNELS)
    wav.setsampwidth(WIDTH)
    wav.setframerate(RATE)
    wav.writeframes(bytes(combined))

srt_lines = []
for idx, item in enumerate(timeline, 1):
    srt_lines.extend([
        str(idx),
        f"{srt_ts(item['subtitleStart'])} --> {srt_ts(item['subtitleEnd'])}",
        item["phrase"],
        "",
    ])
srt_path = OUT / "target.rum.srt"
srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=32x32:r=2",
    "-i", str(wav_path),
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "mpeg4", "-q:v", "5", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-metadata:s:a:0", "language=ron",
    "-shortest",
    "-f", "matroska",
    str(OUT / "reference-romanian.mkv"),
], check=True)

fixture = {
    "mode": "piper-ro_RO-mihai-medium",
    "offsetSeconds": OFFSET,
    "sampleRate": RATE,
    "phrases": timeline,
    "reference": "reference-romanian.mkv",
    "subtitle": "target.rum.srt",
    "durationSeconds": len(combined) / WIDTH / RATE,
    "sparseRegression": SPARSE_REGRESSION,
    "speechSpanSeconds": speech_span,
    "speechSpanRatio": speech_span_ratio,
    "speechLayout": "distributed" if SPARSE_REGRESSION else "sequential",
}
(OUT / "fixture.json").write_text(
    json.dumps(fixture, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps({
    "mode": fixture["mode"],
    "offsetSeconds": OFFSET,
    "segments": len(timeline),
    "durationSeconds": fixture["durationSeconds"],
    "sparseRegression": SPARSE_REGRESSION,
    "speechSpanRatio": fixture["speechSpanRatio"],
    "speechLayout": fixture["speechLayout"],
}, indent=2, ensure_ascii=False))
