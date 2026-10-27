#!/usr/bin/env python3
"""Local legal eSpeak Romanian probes for issue #111 (no user media)."""
from pathlib import Path
import subprocess
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "tests/generated/issue111-espeak"
DEST.mkdir(parents=True, exist_ok=True)
SENTENCES = {
    "A": (
        "Astăzi am mers la bibliotecă pentru a căuta o carte veche despre istoria "
        "orașului. Prietenul meu mi-a spus că acolo putem găsi răspunsuri importante, "
        "chiar dacă vremea de afară este foarte rece."
    ),
    "B": (
        "În această dimineață, profesorul explică o problemă dificilă, iar colegii "
        "lui ascultă cu mare atenție. După câteva minute, toată lumea înțelege "
        "răspunsul și discută despre soluția corectă."
    ),
}
for label, sentence in SENTENCES.items():
    with tempfile.TemporaryDirectory(prefix="subsync2-espeak-") as directory:
        temp = Path(directory)
        source = temp / "speech.wav"
        pcm = temp / "mono16k.wav"
        subprocess.run(
            ["espeak", "-v", "ro", "-s", "133", "-a", "195", "-w", str(source), sentence],
            check=True,
        )
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(source), "-ar", "16000", "-ac", "1",
             "-c:a", "pcm_s16le", str(pcm)],
            check=True,
        )
        with wave.open(str(pcm), "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                raise SystemExit("Unexpected synthesized PCM format")
            samples = wav.readframes(wav.getnframes())
        fixed = samples[:480000].ljust(480000, b"\x00")
        with wave.open(str(DEST / (label + ".wav")), "wb") as wav:
            wav.setframerate(16000)
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.writeframes(fixed)
print("Prepared two 15s deterministic eSpeak Romanian WAV controls; synthetic only.")
