#!/usr/bin/env python3
import json
import re
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "generated" / "en-ro-e2e"
OUT.mkdir(parents=True, exist_ok=True)

CANDIDATES = [
    "always", "because", "friend", "people", "problem", "together",
    "understand", "world", "morning", "minute", "today", "tonight",
    "father", "police", "right", "wrong", "never", "maybe", "sorry",
    "thank", "hello", "little", "different", "important", "beautiful",
    "answer", "question", "waiting", "listen", "coming", "remember",
    "mother", "better", "money", "house", "water", "think", "place",
    "where", "there", "about", "after", "again", "around", "believe",
    "bring", "brother", "called", "children", "country", "course",
    "death", "doing", "drink", "everything", "family", "found",
    "happen", "heart", "home", "inside", "leave", "looking", "matter",
    "night", "other", "person", "please", "pretty", "ready", "really",
    "school", "something", "sometimes", "still", "story", "talking",
    "thing", "things", "through", "trying", "wanted", "woman", "women",
    "work", "years", "young",
]

RATE = 16000
WIDTH = 2
CHANNELS = 1
OFFSET = 8.0
INITIAL_SILENCE = 1.0
GAP = 0.45

DICT_PATH = OUT / "dictionary" / "dict" / "eng-rum.dict"

def load_dictionary():
    if not DICT_PATH.is_file():
        raise SystemExit(f"Pinned dictionary missing: {DICT_PATH}")

    result = {}
    for line in DICT_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        key = parts[0].lower()
        values = []
        for value in parts[1:]:
            if len(value) < 5:
                continue
            if "[" in value or "/" in value or "," in value:
                continue
            if not re.fullmatch(r"[A-Za-zĂÂÎȘŞȚŢăâîșşțţ-]+", value):
                continue
            values.append(value)
        if values:
            result[key] = values
    return result

def srt_ts(seconds):
    ms = round(seconds * 1000)
    hours, rem = divmod(ms, 3600000)
    minutes, rem = divmod(rem, 60000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

dictionary = load_dictionary()
pairs = []
for word in CANDIDATES:
    translations = dictionary.get(word)
    if translations:
        pairs.append({
            "phrase": f"please say {word} clearly today",
            "english": word,
            "romanian": translations[0],
        })

if len(pairs) < 60:
    raise SystemExit(f"Calibration corpus too small: {len(pairs)} dictionary-backed words")

combined = bytearray(b"\x00" * int(RATE * INITIAL_SILENCE) * WIDTH)
timeline = []

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    for idx, pair in enumerate(pairs):
        phrase = pair["phrase"]
        english = pair["english"]
        romanian = pair["romanian"]

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
            **pair,
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
    "mode": "calibration",
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
print(json.dumps({
    "mode": fixture["mode"],
    "offsetSeconds": OFFSET,
    "segments": len(timeline),
    "words": [item["english"] for item in timeline],
}, indent=2, ensure_ascii=False))
