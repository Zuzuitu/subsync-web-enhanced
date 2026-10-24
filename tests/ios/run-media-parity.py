#!/usr/bin/env python3
"""Independent, same-input WASM/native evaluation; truth never reaches engine."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/web"))
from srt_timing import parse_srt_times, measure_srt_timing, TIMING_RE

parser = argparse.ArgumentParser()
parser.add_argument("--engine", type=Path, required=True)
args = parser.parse_args()
folder = ROOT / "tests/generated/en-ro-e2e"
assets = json.loads((folder / "asset-metadata.json").read_text())
manifest = json.loads((folder / "speech-model/manifest.json").read_text())
descriptor = folder / "speech-model" / manifest["descriptor"]
model = json.loads(descriptor.read_text())
parameters = folder / "native-parameters.tsv"
pairs = []
for key, value in model["sphinx"].items():
    if str(value).startswith("./"): value = str((descriptor.parent / value).resolve())
    pairs.append(key + "\t" + str(value))
parameters.write_text("\n".join(pairs) + "\n")
subtitle = folder / "target.rum.srt"
media = folder / "reference-english.mkv"
dictionary = folder / assets["dictionaryPath"]
def run(path, mode="run"):
    command = [str(args.engine.resolve()), str(subtitle), str(path), str(dictionary), str(parameters), str(model["samplerate"]), mode]
    completed = subprocess.run(command, text=True, capture_output=True, timeout=180)
    if completed.returncode not in (0, 2, 3):
        print(completed.stderr[-12000:])
    try: status = json.loads(completed.stdout)
    except Exception:
        print(completed.stderr[-5000:])
        raise
    return completed.returncode, status

code, native = run(media)
browser = json.loads((folder / "browser-en-ro-e2e.json").read_text())
truth = json.loads((folder / "fixture.json").read_text())
times = parse_srt_times(subtitle.read_text())
report = {"scope": "same fixture; single-worker native vs browser WASM; physical iPhone pending",
          "inputSHA256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (subtitle, media)},
          "native": native, "browser": browser["details"], "nativeExit": code}
def write():
    (ROOT / "tests/generated/native-media-parity.json").write_text(json.dumps(report, indent=2) + "\n")
write()
assert code == 0 and native["done"] and native["correlated"], native
assert native["points"] >= 20 and native["factor"] >= 0.9999 and native["maxDistance"] <= 2
assert native["cueCount"] == len(times)
assert abs(native["formula"]["a"] - 1) <= .03
assert abs(native["formula"]["b"] + truth["offsetSeconds"]) <= 1.5
assert browser["status"] == "pass"
nf, bf = native["formula"], browser["details"]["formula"]
report["maximumNativeBrowserTimestampDeltaSeconds"] = max(
    abs((nf["a"] - bf["a"]) * t + nf["b"] - bf["b"]) for pair in times for t in pair)
write()
# New parity gate, not a relaxed canonical acceptance threshold. Same words / fit
# should agree far more closely than this 100 ms ceiling across the whole title.
assert report["maximumNativeBrowserTimestampDeltaSeconds"] <= .1, report
status_file = folder / "native-status.json"
status_file.write_text(json.dumps(native))
exported = folder / "native-output.rum.srt"
subprocess.run(["swift", "run", "--package-path", str(ROOT / "ios/BackgroundCore"), "srt-export",
                str(subtitle), str(status_file), str(exported)], check=True, timeout=180)
original_text, output_text = subtitle.read_text(), exported.read_text()
assert TIMING_RE.sub("", original_text) == TIMING_RE.sub("", output_text), "SRT payload or cue labels changed"
report["fullTitleTimingQuality"] = measure_srt_timing(original_text, output_text, -truth["offsetSeconds"])
output_times = parse_srt_times(output_text)
report["fullTitleTimingQuality"]["startMAESeconds"] = sum(abs(out[0] - (src[0] - truth["offsetSeconds"]))
    for src, out in zip(times, output_times)) / len(times)
write()
cancel_code, cancelled = run(media, "cancel")
report["cancelBeforeOpen"] = cancelled
assert cancel_code == 3 and cancelled["cancelled"] and not cancelled["done"]
silence = folder / "native-silence.wav"
with wave.open(str(silence), "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
    wav.writeframes(bytes(16000 * 2 * 12))
silence_code, silent = run(silence)
report["silenceNegativeControl"] = silent
write()
assert silence_code == 2 and not silent["correlated"] and silent["done"], silent
print(json.dumps(report, indent=2))
