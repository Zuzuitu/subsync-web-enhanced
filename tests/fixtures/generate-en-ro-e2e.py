#!/usr/bin/env python3
import json
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "generated" / "en-ro-e2e"
OUT.mkdir(parents=True, exist_ok=True)

PAIRS = [
    ("always remember this", "always", "mereu"),
    ("because we need help", "because", "deoarece"),
    ("friend come with me", "friend", "prieten"),
    ("people are waiting", "people", "oameni"),
    ("problem is very important", "problem", "problemă"),
    ("together we can work", "together", "împreună"),
    ("understand what I mean", "understand", "înțelege"),
    ("world is beautiful today", "world", "mondial"),
    ("morning comes very early", "morning", "dimineață"),
    ("minute please wait here", "minute", "minut"),
    ("today we are together", "today", "astăzi"),
    ("tonight we will meet", "tonight", "deseară"),
    ("father is coming home", "father", "părinte"),
    ("police are coming now", "police", "poliție"),
    ("right answer is important", "right", "corect"),
    ("wrong answer is different", "wrong", "greșit"),
    ("never forget your friend", "never", "niciodată"),
    ("maybe we can help", "maybe", "poate"),
    ("sorry I was wrong", "sorry", "scuzați"),
    ("thank you my friend", "thank", "mulțumesc"),
    ("hello my friend", "hello", "salut"),
    ("little things are important", "little", "fetiță"),
    ("different answer is possible", "different", "diferit"),
    ("important question today", "important", "important"),
    ("beautiful world today", "beautiful", "frumos"),
    ("answer this question", "answer", "răspuns"),
    ("question is very important", "question", "întrebare"),
    ("waiting for my friend", "waiting", "așteptare"),
    ("listen to my answer", "listen", "asculta"),
    ("coming home tonight", "coming", "venire"),
    ("remember my answer", "remember", "aminti"),
    ("mother is coming home", "mother", "maternă"),
    ("better answer is possible", "better", "îmbunătăți"),
]

RATE = 16000
WIDTH = 2
CHANNELS = 1
OFFSET = 8.0
INITIAL_SILENCE = 1.0
GAP = 0.70

def srt_ts(seconds):
    ms = round(seconds * 1000)
    hours, rem = divmod(ms, 3600000)
    minutes, rem = divmod(rem, 60000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

combined = bytearray(b"\x00" * int(RATE * INITIAL_SILENCE) * WIDTH)
timeline = []

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    for idx, (phrase, english, romanian) in enumerate(PAIRS):
        raw = tmp / f"{idx:02d}-{english}-raw.wav"
        norm = tmp / f"{idx:02d}-{english}.wav"

        subprocess.run([
            "espeak-ng", "-v", "en-us", "-s", "145", "-p", "50",
            "-w", str(raw), phrase,
        ], check=True)

        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(raw),
            "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le",
            str(norm),
        ], check=True)

        with wave.open(str(norm), "rb") as wav:
            if wav.getframerate() != RATE or wav.getnchannels() != CHANNELS or wav.getsampwidth() != WIDTH:
                raise SystemExit(f"Unexpected normalized format for {english}")
            frames = wav.readframes(wav.getnframes())
            duration = wav.getnframes() / RATE

        start = len(combined) / WIDTH / RATE
        combined.extend(frames)
        end = len(combined) / WIDTH / RATE

        timeline.append({
            "phrase": phrase,
            "english": english,
            "romanian": romanian,
            "audioStart": start,
            "audioEnd": end,
            "subtitleStart": start + OFFSET,
            "subtitleEnd": end + OFFSET,
            "duration": duration,
        })

        combined.extend(b"\x00" * int(RATE * GAP) * WIDTH)

wav_path = OUT / "reference-english.wav"
with wave.open(str(wav_path), "wb") as wav:
    wav.setnchannels(CHANNELS)
    wav.setsampwidth(WIDTH)
    wav.setframerate(RATE)
    wav.writeframes(bytes(combined))

srt = []
for i, item in enumerate(timeline, 1):
    srt.extend([
        str(i),
        f"{srt_ts(item['subtitleStart'])} --> {srt_ts(item['subtitleEnd'])}",
        item["romanian"],
        "",
    ])
(OUT / "target.rum.srt").write_text("\n".join(srt), encoding="utf-8")

subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=32x32:r=2",
    "-i", str(wav_path),
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "mpeg4", "-q:v", "5", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-metadata:s:a:0", "language=eng",
    "-shortest",
    "-f", "matroska",
    str(OUT / "reference-english.mkv"),
], check=True)

fixture = {
    "offsetSeconds": OFFSET,
    "sampleRate": RATE,
    "pairs": timeline,
    "reference": "reference-english.mkv",
    "subtitle": "target.rum.srt",
}
(OUT / "fixture.json").write_text(
    json.dumps(fixture, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(fixture, indent=2, ensure_ascii=False))
