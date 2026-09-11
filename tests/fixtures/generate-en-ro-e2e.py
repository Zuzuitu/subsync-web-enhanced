#!/usr/bin/env python3
import json
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "generated" / "en-ro-e2e"
OUT.mkdir(parents=True, exist_ok=True)

PAIRS = [
    ("Always remember this important answer.", "always", "mereu"),
    ("Because people need help today.", "because", "deoarece"),
    ("My friend will come with us tonight.", "friend", "prieten"),
    ("Many people are waiting outside.", "people", "oameni"),
    ("This problem has a different answer.", "problem", "problemă"),
    ("We can work together on this.", "together", "împreună"),
    ("I understand your important question.", "understand", "înțelege"),
    ("The world can be beautiful today.", "world", "mondial"),
    ("Good morning my friend.", "morning", "dimineață"),
    ("Please wait one minute here.", "minute", "minut"),
    ("Today we have an important meeting.", "today", "astăzi"),
    ("We will come home tonight.", "tonight", "deseară"),
    ("My father is coming home.", "father", "părinte"),
    ("The police are waiting outside.", "police", "poliție"),
    ("This is the right answer.", "right", "corect"),
    ("That answer is wrong.", "wrong", "greșit"),
    ("Never forget your family.", "never", "niciodată"),
    ("Maybe we can help today.", "maybe", "poate"),
    ("Sorry I made a mistake.", "sorry", "scuzați"),
    ("Thank you for your answer.", "thank", "mulțumesc"),
    ("Hello my friend.", "hello", "salut"),
    ("A little problem can become important.", "little", "fetiță"),
    ("This answer is different.", "different", "diferit"),
    ("This question is important.", "important", "important"),
    ("The city is beautiful today.", "beautiful", "frumos"),
    ("Please answer this question.", "answer", "răspuns"),
    ("I have another question.", "question", "întrebare"),
    ("We are waiting for the answer.", "waiting", "așteptare"),
    ("Please listen to my question.", "listen", "asculta"),
    ("My friend is coming home.", "coming", "venire"),
    ("Remember this important answer.", "remember", "aminti"),
    ("My mother is waiting at home.", "mother", "maternă"),
    ("This answer is better today.", "better", "îmbunătăți"),
]

RATE = 16000
WIDTH = 2
CHANNELS = 1
OFFSET = 8.0
INITIAL_SILENCE = 1.0
GAP = 0.65
DICT_PATH = OUT / "dictionary" / "dict" / "eng-rum.dict"
PIPER_URL = "http://127.0.0.1:5000/synthesize"

def load_dictionary():
    result = {}
    for line in DICT_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        result[parts[0].lower()] = set(parts[1:])
    return result

def verify_pairs(dictionary):
    for _, english, romanian in PAIRS:
        translations = dictionary.get(english)
        if not translations:
            raise SystemExit(f"Pinned dictionary is missing English key: {english}")
        if romanian not in translations:
            raise SystemExit(
                f"Pinned dictionary does not contain expected pair {english!r} -> {romanian!r}"
            )
        if len(romanian) < 5:
            raise SystemExit(f"Romanian fixture token is shorter than product minWordLen: {romanian}")

def synthesize(phrase, destination):
    body = json.dumps({"text": phrase}).encode("utf-8")
    request = urllib.request.Request(
        PIPER_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise SystemExit(f"Piper HTTP {response.status} for phrase {phrase!r}")
        destination.write_bytes(response.read())

def srt_ts(seconds):
    ms = round(seconds * 1000)
    hours, rem = divmod(ms, 3600000)
    minutes, rem = divmod(rem, 60000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

dictionary = load_dictionary()
verify_pairs(dictionary)

combined = bytearray(b"\x00" * int(RATE * INITIAL_SILENCE) * WIDTH)
timeline = []

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    for idx, (phrase, english, romanian) in enumerate(PAIRS):
        raw = tmp / f"{idx:02d}-{english}-raw.wav"
        norm = tmp / f"{idx:02d}-{english}.wav"

        synthesize(phrase, raw)
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
    "mode": "piper-joe-v1",
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
    "duration": len(combined) / WIDTH / RATE,
}, indent=2))
