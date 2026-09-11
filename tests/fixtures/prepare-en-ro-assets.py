#!/usr/bin/env python3
import hashlib
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "config" / "english-romanian-assets.json").read_text(encoding="utf-8"))
OUT = ROOT / "tests" / "generated" / "en-ro-e2e"
SPEECH_ROOT = OUT / "speech-model"
DICT_ROOT = OUT / "dictionary"

def download(asset, destination):
    request = urllib.request.Request(asset["url"], headers={"User-Agent": "SubSync2-CI"})
    with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as target:
        shutil.copyfileobj(response, target)

    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    if digest != asset["sha256"]:
        raise SystemExit(f"SHA-256 mismatch for {destination.name}: {digest} != {asset['sha256']}")
    return digest

def extract_safe(archive_path, destination):
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            target = (destination / info.filename).resolve()
            if target != root and root not in target.parents:
                raise SystemExit(f"Unsafe ZIP path: {info.filename}")
        archive.extractall(destination)

OUT.mkdir(parents=True, exist_ok=True)

index_path = OUT / CFG["assetIndex"]["filename"]
speech_zip = OUT / CFG["speechEnglish"]["filename"]
dict_zip = OUT / CFG["dictionaryEnglishRomanian"]["filename"]

hashes = {
    "assetIndex": download(CFG["assetIndex"], index_path),
    "speechEnglish": download(CFG["speechEnglish"], speech_zip),
    "dictionaryEnglishRomanian": download(CFG["dictionaryEnglishRomanian"], dict_zip),
}

index = json.loads(index_path.read_text(encoding="utf-8"))
expected = {
    "speech/eng": CFG["speechEnglish"],
    "dict/eng-rum": CFG["dictionaryEnglishRomanian"],
}
for key, pin in expected.items():
    item = index.get(key)
    if not item:
        raise SystemExit(f"Official asset index missing {key}")
    if item.get("version") != pin["version"]:
        raise SystemExit(f"{key} version mismatch: {item.get('version')} != {pin['version']}")
    if item.get("url") != pin["url"]:
        raise SystemExit(f"{key} URL mismatch: {item.get('url')} != {pin['url']}")

extract_safe(speech_zip, SPEECH_ROOT)
extract_safe(dict_zip, DICT_ROOT)

speech = list(SPEECH_ROOT.rglob("eng.speech"))
if len(speech) != 1:
    raise SystemExit(f"Expected one eng.speech descriptor, found {speech}")

dictionary = list(DICT_ROOT.rglob("eng-rum.dict"))
if len(dictionary) != 1:
    raise SystemExit(f"Expected one eng-rum.dict, found {dictionary}")

speech_files = sorted(
    str(path.relative_to(SPEECH_ROOT)).replace("\\", "/")
    for path in SPEECH_ROOT.rglob("*")
    if path.is_file()
)
manifest = {
    "descriptor": str(speech[0].relative_to(SPEECH_ROOT)).replace("\\", "/"),
    "files": speech_files,
    "releaseAssetId": CFG["speechEnglish"]["releaseAssetId"],
    "sha256": hashes["speechEnglish"],
}
(SPEECH_ROOT / "manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n",
    encoding="utf-8",
)

metadata = {
    "pins": CFG,
    "hashes": hashes,
    "speechDescriptor": json.loads(speech[0].read_text(encoding="utf-8")),
    "dictionaryPath": str(dictionary[0].relative_to(OUT)).replace("\\", "/"),
}
(OUT / "asset-metadata.json").write_text(
    json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(metadata, indent=2, ensure_ascii=False))
