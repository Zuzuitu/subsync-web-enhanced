#!/usr/bin/env python3
import hashlib
import json
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "config" / "romanian-asr.json").read_text(encoding="utf-8"))
VOICE = CFG["fixtureVoice"]
OUT = ROOT / "tests" / "generated" / "romanian-piper"
EVIDENCE = ROOT / "tests" / "generated" / "romanian-audio-e2e"

OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)

model_path = OUT / f'{VOICE["voice"]}.onnx'
config_path = OUT / f'{VOICE["voice"]}.onnx.json'


def download(url, destination):
    partial = destination.with_name(destination.name + ".part")
    errors = []
    for attempt in range(5):
        if partial.exists():
            partial.unlink()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "SubSync2-CI"})
            with urllib.request.urlopen(request, timeout=300) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output)
            partial.replace(destination)
            return
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            if partial.exists():
                partial.unlink()
            errors.append(f"attempt {attempt + 1}: {type(exc).__name__}: {exc}")
            if attempt < 4:
                time.sleep(min(2 ** (attempt + 1), 16))
    raise SystemExit(
        f"Unable to download pinned fixture asset {url}: " + " | ".join(errors)
    )


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


download(VOICE["modelUrl"], model_path)
download(VOICE["configUrl"], config_path)

model_sha = sha256(model_path)
if model_sha != VOICE["modelSha256"]:
    raise SystemExit(
        f"SHA-256 mismatch for {model_path.name}: {model_sha} != {VOICE['modelSha256']}"
    )

source_config_sha = sha256(config_path)
voice_config = json.loads(config_path.read_text(encoding="utf-8"))
if voice_config.get("piper_version") != "1.0.0":
    raise SystemExit("Unexpected Romanian Piper voice config version")
if voice_config.get("language", {}).get("code") != "ro_RO":
    raise SystemExit("Unexpected Romanian Piper fixture language")
if voice_config.get("dataset") != "mihai":
    raise SystemExit("Unexpected Romanian Piper fixture dataset")
if voice_config.get("audio", {}).get("sample_rate") != 22050:
    raise SystemExit("Unexpected Romanian Piper fixture sample rate")

# Piper's default noise controls intentionally vary both generated audio and
# phoneme widths. That is useful for speech generation, but it makes a timing
# regression fixture change between CI runs. Keep the downloaded model/config
# pinned and verified first, then make only the local CI copy deterministic.
inference = voice_config.setdefault("inference", {})
inference["length_scale"] = 1.0
inference["noise_scale"] = 0.0
inference["noise_w"] = 0.0
config_path.write_text(
    json.dumps(voice_config, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

deterministic_config_sha = sha256(config_path)
evidence = {
    "provider": VOICE["provider"],
    "voice": VOICE["voice"],
    "revision": VOICE["revision"],
    "datasetLicense": VOICE["datasetLicense"],
    "modelSha256": model_sha,
    "sourceConfigSha256": source_config_sha,
    "deterministicConfigSha256": deterministic_config_sha,
    "deterministicSynthesis": {
        "lengthScale": 1.0,
        "noiseScale": 0.0,
        "noiseWScale": 0.0,
    },
}
(EVIDENCE / "piper-fixture.json").write_text(
    json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(evidence, indent=2, ensure_ascii=False))
