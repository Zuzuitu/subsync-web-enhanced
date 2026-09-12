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
    ROOT / "config" / "english-romanian-assets.json",
    ROOT / "config" / "romanian-asr.json",
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "LICENSE",
    ROOT / "UPSTREAM_COMMIT",
    ROOT / "web" / "package.json",
    ROOT / "web" / "Dockerfile",
    ROOT / "web" / "Makefile.whisper",
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

with (ROOT / "config" / "english-romanian-assets.json").open(encoding="utf-8") as f:
    en_ro_assets = json.load(f)

with (ROOT / "config" / "romanian-asr.json").open(encoding="utf-8") as f:
    romanian_asr = json.load(f)

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
primary_workflow = inv["product"].get("primaryWorkflow", {})
if inv["product"].get("primaryLanguagePriority") != "Romanian subtitles":
    raise SystemExit("Romanian subtitles must remain the primary language priority")
if primary_workflow.get("referenceAudioLanguage") != "English":
    raise SystemExit("Primary reference audio language must be English")
if primary_workflow.get("referenceAudioCode") != "eng":
    raise SystemExit("Primary reference audio code must be eng")
if primary_workflow.get("subtitleLanguage") != "Romanian":
    raise SystemExit("Primary subtitle language must be Romanian")
if set(primary_workflow.get("subtitleLanguageCodes", [])) != {"ro", "rum", "ron"}:
    raise SystemExit("Primary Romanian subtitle aliases must include ro, rum and ron")
if primary_workflow.get("endToEndRequiredBeforeRelease") is not True:
    raise SystemExit("English audio + Romanian subtitle E2E coverage is required before release")
if romanian.get("subtitleSupportRequired") is not True:
    raise SystemExit("Romanian subtitle support is required")
if romanian.get("audioSpeechRecognitionRequired") is not True:
    raise SystemExit("Romanian audio speech recognition is required")
if romanian.get("audioSpeechRecognitionNearTermPriority") is not False:
    raise SystemExit("Romanian audio speech recognition must not be a near-term priority")
if romanian.get("audioSpeechRecognitionDeferredUntilNearCompletion") is not True:
    raise SystemExit("Romanian audio speech recognition must remain deferred until near completion")
if set(romanian.get("acceptedLanguageCodes", [])) != {"ro", "rum", "ron"}:
    raise SystemExit("Romanian language aliases must include ro, rum and ron")
if romanian.get("preserveDiacritics") is not True:
    raise SystemExit("Romanian diacritics must be preserved")

mkv_testing = inv.get("testing", {})
seek_guard = mkv_testing.get("timeWindowSeek", {})
if seek_guard.get("mustNotSkipForwardPastRequestedStart") is not True:
    raise SystemExit("MKV time-window seek must not skip forward past requested start")
if seek_guard.get("regressionRequired") is not True:
    raise SystemExit("MKV time-window seek regression coverage is required")
required_mkv_coverage = {
    "H.264 + stereo AAC",
    "HEVC/H.265 + E-AC3 5.1",
    "reversed multiple-audio-track selection",
    "long-duration split-window seek",
}
if not required_mkv_coverage.issubset(set(mkv_testing.get("mkvReliabilityCoverage", []))):
    raise SystemExit("Required realistic MKV reliability coverage is incomplete")

large_stress = mkv_testing.get("largeFileBrowserStress", {})
if large_stress.get("required") is not True:
    raise SystemExit("Large-file browser stress coverage is required")
if large_stress.get("minimumFixtureMiB", 0) < 128:
    raise SystemExit("Large-file browser stress floor must remain at least 128 MiB")
if set(large_stress.get("browsers", [])) != {"Chromium", "iPhone-like WebKit"}:
    raise SystemExit("Large-file browser stress must cover Chromium and iPhone-like WebKit")
if large_stress.get("physicalIPhoneClaimRequiresPhysicalDeviceEvidence") is not True:
    raise SystemExit("WebKit emulation must not be presented as physical-iPhone evidence")
if large_stress.get("rssMetricIsProcessTreeBaselineNotTabMemory") is not True:
    raise SystemExit("Large-file RSS metric evidence boundary must remain explicit")

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
    "whispercpp": f'{pins["whispercpp"]["repository"]}#{pins["whispercpp"]["sha"]}',
}
if web_package.get("napa") != expected_napa:
    raise SystemExit(
        "web/package.json native dependency refs do not match config/legacy-build-pins.json"
    )

for name in ("sphinxbase", "pocketsphinx", "whispercpp"):
    sha = pins[name]["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SystemExit(f"{name} pin must be a full 40-character Git SHA")

whisper_engine = romanian_asr.get("engine", {})
whisper_model = romanian_asr.get("model", {})
if whisper_engine.get("repository") != "ggml-org/whisper.cpp":
    raise SystemExit("Unexpected Romanian ASR engine repository")
if whisper_engine.get("sha") != pins["whispercpp"]["sha"]:
    raise SystemExit("Romanian ASR engine SHA must match the pinned build dependency")
if whisper_engine.get("threads") != 1:
    raise SystemExit("Romanian browser ASR must remain single-threaded unless architecture is explicitly revisited")
if whisper_model.get("canonicalSubSyncLanguage") != "rum" or whisper_model.get("language") != "ro":
    raise SystemExit("Romanian Whisper language mapping must remain ro -> rum")
if whisper_model.get("filename") != "ggml-tiny-q5_1.bin":
    raise SystemExit("Unexpected Romanian Whisper model filename")
if whisper_model.get("sha256") != "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7":
    raise SystemExit("Unexpected Romanian Whisper model SHA-256")
if not re.fullmatch(r"[0-9a-f]{64}", whisper_model.get("sha256", "")):
    raise SystemExit("Romanian Whisper model must have a full SHA-256")
if whisper_engine.get("license") != "MIT" or whisper_model.get("license") != "MIT":
    raise SystemExit("Pinned Romanian Whisper engine/model license metadata changed")

whisper_toolchain = romanian_asr.get("toolchain", {})
expected_whisper_image = (
    "emscripten/emsdk:3.1.50@"
    "sha256:b6ea0e55fdc95be36427df6df7892d5e5e27f0440cfcf442a55f784aba09a4fa"
)
if whisper_toolchain.get("image") != expected_whisper_image:
    raise SystemExit("Unexpected Romanian Whisper Emscripten image")
if whisper_toolchain.get("version") != "3.1.50":
    raise SystemExit("Unexpected Romanian Whisper Emscripten version")
if whisper_toolchain.get("wasmSimd") is not True:
    raise SystemExit("Romanian Whisper browser module must keep WASM SIMD enabled")
if whisper_toolchain.get("sharedMemory") is not False:
    raise SystemExit("Romanian Whisper browser module must not require shared memory")
if whisper_toolchain.get("scope") != "Romanian Whisper module only":
    raise SystemExit("Modern Emscripten toolchain must stay isolated to Romanian Whisper")

whisper_makefile = (ROOT / "web" / "Makefile.whisper").read_text(encoding="utf-8")
if "-msimd128" not in whisper_makefile:
    raise SystemExit("Romanian Whisper build must compile and link with -msimd128")
if "USE_PTHREADS" in whisper_makefile:
    raise SystemExit("Romanian Whisper build must not enable WebAssembly pthreads")

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

expected_en_ro = {
    "assetIndex": (49186110, "assets.json", "f25ccee51728c6632fdb66a33744e33945cb054a562c4ff600afc03ced605da4"),
    "speechEnglish": (14727496, "speech-eng.zip", "b96fa77cc3567c0351d1a1dae2cd87cb38ae815834903cc1e680e48b6cbd45a5"),
    "dictionaryEnglishRomanian": (39441884, "dict-eng-rum.zip", "04350f06586fc06082142e7a8e9b32f961782bc08341755594a0c4be3b57cfc4"),
}
for name, (asset_id, filename, sha256) in expected_en_ro.items():
    asset = en_ro_assets.get(name, {})
    if asset.get("releaseAssetId") != asset_id:
        raise SystemExit(f"Unexpected {name} release asset ID")
    if asset.get("filename") != filename:
        raise SystemExit(f"Unexpected {name} filename")
    if asset.get("sha256") != sha256 or not re.fullmatch(r"[0-9a-f]{64}", asset.get("sha256", "")):
        raise SystemExit(f"Unexpected {name} SHA-256")

if en_ro_assets["speechEnglish"].get("version") != "1.0.0":
    raise SystemExit("Unexpected English speech asset version")
if en_ro_assets["dictionaryEnglishRomanian"].get("version") != "1.1.1":
    raise SystemExit("Unexpected English-Romanian dictionary asset version")

fixture_voice = en_ro_assets.get("englishFixtureVoice", {})
if fixture_voice.get("provider") != "Piper":
    raise SystemExit("English fixture voice provider must be Piper")
if fixture_voice.get("revision") != "v1.0.0":
    raise SystemExit("English fixture voice must stay pinned to v1.0.0")
if fixture_voice.get("voice") != "en_US-joe-medium":
    raise SystemExit("Unexpected English fixture voice")
if fixture_voice.get("datasetLicense") != "CC0":
    raise SystemExit("English fixture voice dataset must remain CC0")
if fixture_voice.get("modelSha256") != "58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06":
    raise SystemExit("Unexpected English fixture voice model SHA-256")
if fixture_voice.get("configSha256") != "3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33":
    raise SystemExit("Unexpected English fixture voice config SHA-256")
for key in ("modelSha256", "configSha256"):
    if not re.fullmatch(r"[0-9a-f]{64}", fixture_voice.get(key, "")):
        raise SystemExit(f"English fixture voice {key} must be a full SHA-256")

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
