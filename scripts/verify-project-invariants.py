#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

required = [
    ROOT / "docs" / "PROJECT_STATE.md",
    ROOT / "config" / "project-invariants.json",
    ROOT / "config" / "legacy-build-pins.json",
    ROOT / "config" / "test-fixture-pins.json",
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "LICENSE",
    ROOT / "UPSTREAM_COMMIT",
    ROOT / "web" / "package.json",
    ROOT / "web" / "Dockerfile",
]

missing = [str(p.relative_to(ROOT)) for p in required if not p.is_file()]
if missing:
    raise SystemExit("Missing required project files: " + ", ".join(missing))

with (ROOT / "config" / "project-invariants.json").open(encoding="utf-8") as f:
    inv = json.load(f)

with (ROOT / "config" / "legacy-build-pins.json").open(encoding="utf-8") as f:
    pins = json.load(f)

with (ROOT / "config" / "test-fixture-pins.json").open(encoding="utf-8") as f:
    fixture_pins = json.load(f)

if inv.get("project") != "SubSync2":
    raise SystemExit("project-invariants.json: project must be SubSync2")

expected = inv["upstream"]["pinnedBaseline"].strip()
actual = (ROOT / "UPSTREAM_COMMIT").read_text(encoding="utf-8").strip()
if actual != expected:
    raise SystemExit(f"UPSTREAM_COMMIT mismatch: {actual} != {expected}")

if inv["workflow"].get("directMaterialCommitsToMain") is not False:
    raise SystemExit("Direct material commits to main must remain disabled")

if inv["deployment"].get("autoDeployProduction") is not False:
    raise SystemExit("Production auto-deploy must remain disabled")

if inv["licensing"].get("requireSc0tyAttribution") is not True:
    raise SystemExit("sc0ty attribution invariant is required")

romanian = inv["product"].get("romanian", {})
if inv["product"].get("primaryLanguagePriority") != "Romanian":
    raise SystemExit("Romanian must remain the primary language priority")
if romanian.get("subtitleSupportRequired") is not True:
    raise SystemExit("Romanian subtitle support is required")
if romanian.get("audioSpeechRecognitionRequired") is not True:
    raise SystemExit("Romanian audio speech recognition is required")
if set(romanian.get("acceptedLanguageCodes", [])) != {"ro", "rum", "ron"}:
    raise SystemExit("Romanian language aliases must include ro, rum and ron")
if romanian.get("preserveDiacritics") is not True:
    raise SystemExit("Romanian diacritics must be preserved")

readme = (ROOT / "README.md").read_text(encoding="utf-8").lower()
for token in ("sc0ty", "gnu general public license"):
    if token not in readme:
        raise SystemExit(f"README attribution/license token missing: {token}")

license_text = (ROOT / "LICENSE").read_text(encoding="utf-8", errors="ignore")
if "GNU GENERAL PUBLIC LICENSE" not in license_text or "Version 3" not in license_text:
    raise SystemExit("Expected GNU GPL v3 LICENSE content")

web_package = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))
if web_package.get("license") != "GPL-3.0-or-later":
    raise SystemExit("web/package.json must preserve GPL-3.0-or-later")

expected_napa = {
    "ffmpeg": f'{pins["ffmpeg"]["repository"]}#{pins["ffmpeg"]["ref"]}',
    "sphinxbase": f'{pins["sphinxbase"]["repository"]}#{pins["sphinxbase"]["sha"]}',
    "pocketsphinx": f'{pins["pocketsphinx"]["repository"]}#{pins["pocketsphinx"]["sha"]}',
}
if web_package.get("napa") != expected_napa:
    raise SystemExit(
        "web/package.json native dependency refs do not match config/legacy-build-pins.json"
    )

for name in ("sphinxbase", "pocketsphinx"):
    sha = pins[name]["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SystemExit(f"{name} pin must be a full 40-character Git SHA")

speech_fixture = fixture_pins.get("sc0tySpeechItalian", {})
fixture_sha = speech_fixture.get("sha256", "")
if not re.fullmatch(r"[0-9a-f]{64}", fixture_sha):
    raise SystemExit("Pinned sc0ty speech fixture must have a full SHA-256")
if speech_fixture.get("releaseAssetId") != 14727504:
    raise SystemExit("Unexpected sc0ty Italian speech release asset ID")
if speech_fixture.get("filename") != "speech-ita.zip":
    raise SystemExit("Unexpected sc0ty Italian speech fixture filename")
if not speech_fixture.get("url", "").endswith("/speech-ita.zip"):
    raise SystemExit("Unexpected sc0ty Italian speech fixture URL")

dockerfile = (ROOT / "web" / "Dockerfile").read_text(encoding="utf-8")
first_instruction = next(
    (line.strip() for line in dockerfile.splitlines() if line.strip()),
    "",
)
expected_from = f'FROM {pins["emscripten"]["image"]}'
if first_instruction != expected_from:
    raise SystemExit(
        f"web/Dockerfile toolchain mismatch: {first_instruction!r} != {expected_from!r}"
    )

print("SubSync2 project invariants and legacy build pins: OK")
