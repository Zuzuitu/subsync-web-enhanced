#!/usr/bin/env python3
import hashlib
import json
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "config" / "english-romanian-assets.json").read_text(encoding="utf-8"))
VOICE = CFG["englishFixtureVoice"]
OUT = ROOT / "tests" / "generated" / "piper"
EVIDENCE = ROOT / "tests" / "generated" / "en-ro-e2e"

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
            with urllib.request.urlopen(request, timeout=240) as response, partial.open("wb") as output:
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

def verify(path, expected):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"SHA-256 mismatch for {path.name}: {digest} != {expected}")
    return digest

download(VOICE["modelUrl"], model_path)
download(VOICE["configUrl"], config_path)

model_sha = verify(model_path, VOICE["modelSha256"])
config_sha = verify(config_path, VOICE["configSha256"])

voice_config = json.loads(config_path.read_text(encoding="utf-8"))
if voice_config.get("piper_version") != "1.0.0":
    raise SystemExit("Unexpected Piper voice config version")
if voice_config.get("language", {}).get("code") != "en_US":
    raise SystemExit("Unexpected Piper fixture language")
if voice_config.get("dataset") != "joe":
    raise SystemExit("Unexpected Piper fixture dataset")

evidence = {
    "provider": VOICE["provider"],
    "voice": VOICE["voice"],
    "revision": VOICE["revision"],
    "datasetLicense": VOICE["datasetLicense"],
    "modelSha256": model_sha,
    "configSha256": config_sha,
}
(EVIDENCE / "piper-fixture.json").write_text(
    json.dumps(evidence, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps(evidence, indent=2))
