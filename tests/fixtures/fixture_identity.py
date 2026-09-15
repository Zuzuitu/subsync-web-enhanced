"""Byte-level identity for synthetic Romanian fixtures; never user media."""

import hashlib
from pathlib import Path
import wave


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fixture_identity(directory):
    directory = Path(directory)
    with wave.open(str(directory / "reference-romanian.wav"), "rb") as wav:
        audio = {
            "sampleRate": wav.getframerate(),
            "channels": wav.getnchannels(),
            "sampleWidth": wav.getsampwidth(),
            "frames": wav.getnframes(),
        }
        digest = hashlib.sha256()
        while True:
            frames = wav.readframes(65536)
            if not frames:
                break
            digest.update(frames)
        audio["sha256"] = digest.hexdigest()
    return {
        "pcm": audio,
        "subtitleSha256": sha256_file(directory / "target.rum.srt"),
        # Container metadata may vary between independent muxes. Replays must
        # still use the very same MKV bytes, not merely equal source PCM.
        "mkvSha256": sha256_file(directory / "reference-romanian.mkv"),
    }


def synthesis_parameters(deterministic):
    # Piper 1.8.0 /synthesize consumes noise_w_scale (not noise_w).
    # Source: OHF-Voice/piper1-gpl src/piper/http_server.py, tag v1.8.0.
    return {"length_scale": 1.0, "noise_scale": 0.0, "noise_w_scale": 0.0} if deterministic else {}
