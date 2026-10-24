#!/usr/bin/env python3
"""Package only the existing verified English model and EN/RO dictionary."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tests/generated/en-ro-e2e"
DEST = ROOT / "ios/LanguageAssets"
pins = json.loads((ROOT / "config/english-romanian-assets.json").read_text())
metadata = json.loads((SOURCE / "asset-metadata.json").read_text())
for name in ("speechEnglish", "dictionaryEnglishRomanian"):
    assert metadata["hashes"][name] == pins[name]["sha256"]
    archive = SOURCE / pins[name]["filename"]
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == pins[name]["sha256"]
if DEST.exists(): shutil.rmtree(DEST)
DEST.mkdir(parents=True)
shutil.copytree(SOURCE / "speech-model/speech", DEST / "speech")
(DEST / "dict").mkdir()
shutil.copy2(SOURCE / "dictionary/dict/eng-rum.dict", DEST / "dict/eng-rum.dict")
for prefix in (ROOT / "ios/vendor").glob("iphoneos-*"):
    if (prefix / "licenses").is_dir(): shutil.copytree(prefix / "licenses", DEST / "licenses", dirs_exist_ok=True)
files = [{"path": str(path.relative_to(DEST)), "bytes": path.stat().st_size,
          "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
         for path in sorted(DEST.rglob("*")) if path.is_file()]
(DEST / "assets.json").write_text(json.dumps({"schemaVersion": 1, "language": "eng",
    "speechDescriptor": "speech/eng.speech", "dictionary": "dict/eng-rum.dict",
    "archives": {key: pins[key]["sha256"] for key in ("speechEnglish", "dictionaryEnglishRomanian")},
    "files": files}, indent=2) + "\n")
print("Staged verified local English speech model / EN-RO dictionary:", len(files), "files")
