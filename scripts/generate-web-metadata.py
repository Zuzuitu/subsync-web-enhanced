#!/usr/bin/env python3
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "english-romanian-assets.json"

parser = argparse.ArgumentParser()
parser.add_argument("--hash", required=True)
parser.add_argument("--version", default="2.0.0-dev")
args = parser.parse_args()

cfg = json.loads(CONFIG.read_text(encoding="utf-8"))


def download_pinned_json(spec):
    request = urllib.request.Request(
        spec["url"],
        headers={"User-Agent": "SubSync2-Web-Build"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()

    digest = hashlib.sha256(data).hexdigest()
    if digest != spec["sha256"]:
        raise SystemExit(
            f'Pinned asset index SHA-256 mismatch: {digest} != {spec["sha256"]}'
        )
    return json.loads(data.decode("utf-8"))


upstream_index = download_pinned_json(cfg["assetIndex"])
assets = {}

for name, description in upstream_index.items():
    if not (name.startswith("dict/") or name.startswith("speech/")):
        continue
    if description.get("type") != "zip":
        raise SystemExit(f"Unexpected asset type for {name}: {description.get('type')}")
    if not description.get("url") or not description.get("version"):
        raise SystemExit(f"Incomplete upstream asset metadata for {name}")
    assets[name] = {
        "type": description["type"],
        "url": description["url"],
        "version": description["version"],
    }
    if description.get("sig"):
        assets[name]["sig"] = description["sig"]

speech_assets = sorted(name for name in assets if name.startswith("speech/"))
dict_assets = sorted(name for name in assets if name.startswith("dict/"))
expected_speech = {
    "speech/chi",
    "speech/dut",
    "speech/eng",
    "speech/fre",
    "speech/ger",
    "speech/gre",
    "speech/ita",
    "speech/rus",
    "speech/spa",
}

if set(speech_assets) != expected_speech:
    raise SystemExit(
        "Pinned upstream speech catalog changed unexpectedly: "
        + ", ".join(speech_assets)
    )
if len(dict_assets) != 217:
    raise SystemExit(
        f"Pinned upstream dictionary catalog changed unexpectedly: {len(dict_assets)} != 217"
    )

# Keep the primary ENG -> RO path same-origin and SHA-verified in the staged PWA.
primary_overrides = {
    "dict/eng-rum": {
        "filename": cfg["dictionaryEnglishRomanian"]["filename"],
        "version": cfg["dictionaryEnglishRomanian"]["version"],
    },
    "speech/eng": {
        "filename": cfg["speechEnglish"]["filename"],
        "version": cfg["speechEnglish"]["version"],
    },
}

for name, override in primary_overrides.items():
    if name not in assets:
        raise SystemExit(f"Pinned upstream catalog is missing required primary asset: {name}")
    if assets[name]["version"] != override["version"]:
        raise SystemExit(
            f'Pinned upstream version mismatch for {name}: '
            f'{assets[name]["version"]} != {override["version"]}'
        )
    assets[name]["url"] = f'assets/data/{override["filename"]}'

version = {
    "version": args.version,
    "hash": args.hash,
}

assets_path = ROOT / "web" / "src" / "data" / "assets.json"
version_path = ROOT / "web" / "version.json"
assets_path.parent.mkdir(parents=True, exist_ok=True)

assets_path.write_text(
    json.dumps(assets, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
version_path.write_text(
    json.dumps(version, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)

print(f"Generated {assets_path.relative_to(ROOT)}")
print(f"Generated {version_path.relative_to(ROOT)}")
print(
    json.dumps(
        {
            "speechAssets": speech_assets,
            "speechCount": len(speech_assets),
            "dictionaryCount": len(dict_assets),
            "primaryLocalAssets": sorted(primary_overrides),
            "version": version,
        },
        indent=2,
    )
)
