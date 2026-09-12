#!/usr/bin/env python3
import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "english-romanian-assets.json"

parser = argparse.ArgumentParser()
parser.add_argument("--destination", required=True)
parser.add_argument("--cache-dir", default="tests/generated/upstream-asset-cache")
parser.add_argument("--asset", action="append", dest="assets")
parser.add_argument("--workers", type=int, default=8)
args = parser.parse_args()

cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
destination = Path(args.destination)
if not destination.is_absolute():
    destination = ROOT / destination
cache_dir = Path(args.cache_dir)
if not cache_dir.is_absolute():
    cache_dir = ROOT / cache_dir

destination.mkdir(parents=True, exist_ok=True)
cache_dir.mkdir(parents=True, exist_ok=True)

key_spec = cfg["assetSigningKey"]
key_path = ROOT / key_spec["localPath"]
if not key_path.is_file():
    raise SystemExit(f"Missing pinned sc0ty asset signing key: {key_path}")
key_digest = hashlib.sha256(key_path.read_bytes()).hexdigest()
if key_digest != key_spec["sha256"]:
    raise SystemExit(
        f"Pinned sc0ty asset signing key SHA-256 mismatch: "
        f"{key_digest} != {key_spec['sha256']}"
    )


def download_bytes(url):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SubSync2-Asset-Mirror"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


index_bytes = download_bytes(cfg["assetIndex"]["url"])
index_digest = hashlib.sha256(index_bytes).hexdigest()
if index_digest != cfg["assetIndex"]["sha256"]:
    raise SystemExit(
        f"Pinned asset index SHA-256 mismatch: "
        f"{index_digest} != {cfg['assetIndex']['sha256']}"
    )
upstream_index = json.loads(index_bytes.decode("utf-8"))
catalog = {
    name: description
    for name, description in upstream_index.items()
    if name.startswith("dict/") or name.startswith("speech/")
}

speech = sorted(name for name in catalog if name.startswith("speech/"))
dictionaries = sorted(name for name in catalog if name.startswith("dict/"))
if len(speech) != 9 or len(dictionaries) != 217:
    raise SystemExit(
        f"Unexpected pinned upstream catalog size: "
        f"{len(speech)} speech, {len(dictionaries)} dictionaries"
    )

selected = sorted(set(args.assets or catalog.keys()))
unknown = [name for name in selected if name not in catalog]
if unknown:
    raise SystemExit("Unknown upstream assets requested: " + ", ".join(unknown))


def download_to_cache(url, path):
    if path.is_file() and path.stat().st_size > 0:
        return
    tmp = path.with_name(path.name + ".part")
    tmp.unlink(missing_ok=True)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SubSync2-Asset-Mirror"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response, tmp.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        if tmp.stat().st_size == 0:
            raise RuntimeError(f"Downloaded empty file from {url}")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def verify_signature(asset_path, signature_path):
    proc = subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-verify",
            str(key_path),
            "-signature",
            str(signature_path),
            str(asset_path),
        ],
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0 or "Verified OK" not in (proc.stdout + proc.stderr):
        raise RuntimeError(
            f"Signature verification failed for {asset_path.name}: "
            f"{proc.stdout}{proc.stderr}"
        )


def materialize(name):
    description = catalog[name]
    if description.get("type") != "zip":
        raise RuntimeError(f"Unexpected asset type for {name}")
    url = description.get("url")
    sig_url = description.get("sig")
    if not url or not sig_url:
        raise RuntimeError(f"Missing URL/signature metadata for {name}")

    filename = Path(urllib.parse.urlparse(url).path).name
    expected_filename = name.replace("/", "-") + ".zip"
    if filename != expected_filename:
        raise RuntimeError(
            f"Unexpected filename for {name}: {filename} != {expected_filename}"
        )

    asset_cache = cache_dir / filename
    sig_cache = cache_dir / (filename + ".asc")
    download_to_cache(url, asset_cache)
    download_to_cache(sig_url, sig_cache)
    verify_signature(asset_cache, sig_cache)

    output = destination / filename
    shutil.copy2(asset_cache, output)
    return {
        "name": name,
        "filename": filename,
        "bytes": output.stat().st_size,
        "version": description["version"],
        "source": url,
        "signatureVerified": True,
    }


results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
    futures = {executor.submit(materialize, name): name for name in selected}
    for future in concurrent.futures.as_completed(futures):
        name = futures[future]
        try:
            result = future.result()
        except Exception as exc:
            raise SystemExit(f"Failed to mirror {name}: {exc}") from exc
        results.append(result)
        print(
            f"verified {result['name']} -> {result['filename']} "
            f"({result['bytes']} bytes)"
        )

results.sort(key=lambda item: item["name"])
manifest = {
    "assetIndexSha256": index_digest,
    "signingKeySha256": key_digest,
    "selectedCount": len(results),
    "totalBytes": sum(item["bytes"] for item in results),
    "assets": results,
}
manifest_path = destination / "upstream-manifest.json"
manifest_path.write_text(
    json.dumps(manifest, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)

print(
    json.dumps(
        {
            "selectedCount": manifest["selectedCount"],
            "totalBytes": manifest["totalBytes"],
            "manifest": str(manifest_path.relative_to(ROOT))
            if manifest_path.is_relative_to(ROOT)
            else str(manifest_path),
        },
        indent=2,
    )
)
