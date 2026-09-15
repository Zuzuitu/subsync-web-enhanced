#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
PUBLIC = WEB / "public"
DIST = WEB / "dist"
CONFIG = ROOT / "config" / "english-romanian-assets.json"
ROMANIAN_ASR_CONFIG = ROOT / "config" / "romanian-asr.json"

parser = argparse.ArgumentParser()
parser.add_argument("--hash", required=True)
parser.add_argument("--asset-cache", default="tests/generated/en-ro-e2e")
args = parser.parse_args()

cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
romanian_asr = json.loads(ROMANIAN_ASR_CONFIG.read_text(encoding="utf-8"))
cache_dir = ROOT / args.asset_cache

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir(parents=True)

for src in PUBLIC.iterdir():
    if src.name == "sw.js.in":
        continue
    dst = DIST / src.name
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)

scripts_out = DIST / "scripts"
scripts_out.mkdir(parents=True, exist_ok=True)
for name in ("subsync.js", "extractor.wasm", "correlator.wasm", "whisper.js", "whisper.wasm"):
    src = WEB / "scripts" / name
    if not src.is_file() or src.stat().st_size == 0:
        raise SystemExit(f"Missing web build artifact: {src.relative_to(ROOT)}")
    shutil.copy2(src, scripts_out / name)

asset_out = DIST / "assets" / "data"
asset_out.mkdir(parents=True, exist_ok=True)

def verify(path, expected):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"SHA-256 mismatch for {path.name}: {digest} != {expected}")
    return digest

def materialize(asset):
    filename = asset["filename"]
    cached = cache_dir / filename
    destination = asset_out / filename

    if cached.is_file():
        shutil.copy2(cached, destination)
    else:
        urls = [asset["url"]] + list(asset.get("fallbackUrls", []))
        errors = []
        for url in urls:
            partial = destination.with_name(destination.name + ".part")
            if partial.exists():
                partial.unlink()
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "SubSync2-Web-Build"})
                with urllib.request.urlopen(request, timeout=240) as response, partial.open("wb") as output:
                    shutil.copyfileobj(response, output)
                digest = hashlib.sha256(partial.read_bytes()).hexdigest()
                if digest != asset["sha256"]:
                    errors.append(f"{url}: SHA-256 mismatch {digest}")
                    partial.unlink()
                    continue
                partial.replace(destination)
                break
            except (OSError, TimeoutError) as exc:
                if partial.exists():
                    partial.unlink()
                errors.append(f"{url}: {type(exc).__name__}: {exc}")
        else:
            raise SystemExit(
                f"Unable to materialize {filename} from pinned sources: " + " | ".join(errors)
            )

    digest = verify(destination, asset["sha256"])
    return {
        "filename": filename,
        "sha256": digest,
        "bytes": destination.stat().st_size,
    }

materialized = [
    materialize(cfg["speechEnglish"]),
    materialize(cfg["dictionaryEnglishRomanian"]),
    materialize(romanian_asr["model"]),
]

index_path = DIST / "index.html"
index = index_path.read_text(encoding="utf-8").replace("__BUILD_HASH__", args.hash)
if "__BUILD_HASH__" in index:
    raise SystemExit("Unresolved build hash placeholder in staged index.html")
index_path.write_text(index, encoding="utf-8")

sw = (PUBLIC / "sw.js.in").read_text(encoding="utf-8").replace("__BUILD_HASH__", args.hash)
if "__BUILD_HASH__" in sw:
    raise SystemExit("Unresolved build hash placeholder in staged sw.js")
(DIST / "sw.js").write_text(sw, encoding="utf-8")
(DIST / ".nojekyll").write_text("", encoding="utf-8")

manifest = {
    "buildHash": args.hash,
    "assets": materialized,
    "files": sorted(
        str(path.relative_to(DIST)).replace("\\", "/")
        for path in DIST.rglob("*")
        if path.is_file()
    ),
}
(DIST / "build-manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n",
    encoding="utf-8",
)

print(json.dumps(manifest, indent=2))
