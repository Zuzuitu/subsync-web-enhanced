#!/usr/bin/env python3
import hashlib
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PINS_PATH = ROOT / "config" / "test-fixture-pins.json"
OUT_ROOT = ROOT / "tests" / "generated"
MODEL_ROOT = OUT_ROOT / "speech-model"

pins = json.loads(PINS_PATH.read_text(encoding="utf-8"))
asset = pins["sc0tySpeechItalian"]

OUT_ROOT.mkdir(parents=True, exist_ok=True)
archive_path = OUT_ROOT / asset["filename"]

print(f"Downloading pinned speech fixture: {asset['url']}")
with urllib.request.urlopen(asset["url"], timeout=120) as response, archive_path.open("wb") as output:
    shutil.copyfileobj(response, output)

digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
expected = asset["sha256"]
if digest != expected:
    raise SystemExit(f"Speech fixture SHA-256 mismatch: {digest} != {expected}")

(OUT_ROOT / "speech-ita.sha256").write_text(
    f"{digest}  {archive_path.name}\n",
    encoding="utf-8",
)

if MODEL_ROOT.exists():
    shutil.rmtree(MODEL_ROOT)
MODEL_ROOT.mkdir(parents=True)

with zipfile.ZipFile(archive_path) as archive:
    root_resolved = MODEL_ROOT.resolve()
    for info in archive.infolist():
        destination = (MODEL_ROOT / info.filename).resolve()
        if root_resolved not in destination.parents and destination != root_resolved:
            raise SystemExit(f"Unsafe path in speech fixture: {info.filename}")
    archive.extractall(MODEL_ROOT)

files = sorted(
    str(path.relative_to(MODEL_ROOT)).replace("\\", "/")
    for path in MODEL_ROOT.rglob("*")
    if path.is_file()
)
speech = [path for path in files if path.endswith(".speech")]
if len(speech) != 1:
    raise SystemExit(f"Expected one .speech descriptor, found {speech}")

manifest = {
    "source": f"{asset['sourceRepository']} release {asset['releaseTag']} / {asset['filename']}",
    "releaseAssetId": asset["releaseAssetId"],
    "sha256": digest,
    "descriptor": speech[0],
    "files": files,
}
(MODEL_ROOT / "manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n",
    encoding="utf-8",
)

print(json.dumps(manifest, indent=2))
print((MODEL_ROOT / speech[0]).read_text(encoding="utf-8"))
