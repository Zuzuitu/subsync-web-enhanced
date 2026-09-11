#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "english-romanian-assets.json"

parser = argparse.ArgumentParser()
parser.add_argument("--hash", required=True)
parser.add_argument("--version", default="2.0.0-dev")
args = parser.parse_args()

cfg = json.loads(CONFIG.read_text(encoding="utf-8"))

assets = {
    "dict/eng-rum": {
        "type": "zip",
        "url": f'assets/data/{cfg["dictionaryEnglishRomanian"]["filename"]}',
        "version": cfg["dictionaryEnglishRomanian"]["version"],
    },
    "speech/eng": {
        "type": "zip",
        "url": f'assets/data/{cfg["speechEnglish"]["filename"]}',
        "version": cfg["speechEnglish"]["version"],
    },
}

version = {
    "version": args.version,
    "hash": args.hash,
}

assets_path = ROOT / "web" / "src" / "data" / "assets.json"
version_path = ROOT / "web" / "version.json"
assets_path.parent.mkdir(parents=True, exist_ok=True)

assets_path.write_text(json.dumps(assets, indent=2, sort_keys=True) + "\n", encoding="utf-8")
version_path.write_text(json.dumps(version, indent=2, sort_keys=True) + "\n", encoding="utf-8")

print(f"Generated {assets_path.relative_to(ROOT)}")
print(f"Generated {version_path.relative_to(ROOT)}")
print(json.dumps({"assets": sorted(assets), "version": version}, indent=2))
