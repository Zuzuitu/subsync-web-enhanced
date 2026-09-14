#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULT = ROOT / "tests" / "generated" / "romanian-audio-e2e" / "public-pages-romanian-audio.json"

MAX_FINE_TIMING_ERROR_SECONDS = 0.60
MAX_AFFINE_DRIFT_SECONDS = 0.35
EXPECTED_SHIFT_SECONDS = -8.0

if not RESULT.exists():
    raise SystemExit(f"Missing Romanian public timing diagnostics: {RESULT}")

payload = json.loads(RESULT.read_text(encoding="utf-8"))
shift = float(payload["savedTimingShiftSeconds"])
timing = payload["timingQuality"]
p95 = float(timing["startP95AbsErrorSeconds"])
drift = float(timing["affineErrorDriftAcrossTitleSeconds"])

failures = []
if abs(shift - EXPECTED_SHIFT_SECONDS) > MAX_FINE_TIMING_ERROR_SECONDS:
    failures.append(
        f"first-cue shift {shift:.3f}s outside {EXPECTED_SHIFT_SECONDS:.3f}s ± "
        f"{MAX_FINE_TIMING_ERROR_SECONDS:.2f}s"
    )
if p95 > MAX_FINE_TIMING_ERROR_SECONDS:
    failures.append(
        f"full-title p95 absolute start error {p95:.3f}s exceeds "
        f"{MAX_FINE_TIMING_ERROR_SECONDS:.2f}s"
    )
if abs(drift) > MAX_AFFINE_DRIFT_SECONDS:
    failures.append(
        f"affine timing drift {drift:.3f}s exceeds ±{MAX_AFFINE_DRIFT_SECONDS:.2f}s"
    )

summary = {
    "savedTimingShiftSeconds": shift,
    "startP95AbsErrorSeconds": p95,
    "affineErrorDriftAcrossTitleSeconds": drift,
    "precisionEvidenceText": payload.get("precisionEvidenceText"),
    "precisionRobustnessText": payload.get("precisionRobustnessText"),
    "formulaText": payload.get("formulaText"),
    "pointsText": payload.get("pointsText"),
    "romanianAdaptiveProbesCompleted": payload.get("romanianAdaptiveProbesCompleted"),
    "romanianAdaptiveProbesTotal": payload.get("romanianAdaptiveProbesTotal"),
}
print(json.dumps(summary, indent=2, ensure_ascii=False))

if failures:
    raise SystemExit("Public Romanian strict fine timing failed: " + "; ".join(failures))
