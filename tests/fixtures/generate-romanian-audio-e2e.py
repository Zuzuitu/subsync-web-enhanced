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

combined = bytearray(b"\x00" * int(RATE * INITIAL_SILENCE) * WIDTH)
timeline = []

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

        start = len(combined) / WIDTH / RATE
        combined.extend(frames)
        end = len(combined) / WIDTH / RATE
        timeline.append({
            "phrase": phrase,
            "audioStart": start,
            "audioEnd": end,
            "subtitleStart": start + OFFSET,
            "subtitleEnd": end + OFFSET,
        })
        combined.extend(b"\x00" * int(RATE * GAP) * WIDTH)

if SPARSE_REGRESSION:
    current_duration = len(combined) / WIDTH / RATE
    if current_duration >= SPARSE_DURATION:
        raise SystemExit(
            f"Base Romanian fixture unexpectedly exceeds sparse target: {current_duration:.3f}s"
        )
    padding_samples = round((SPARSE_DURATION - current_duration) * RATE)
    combined.extend(b"\x00" * padding_samples * WIDTH)

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
}, indent=2, ensure_ascii=False))
