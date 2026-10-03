"""Persist completed public-smoke evidence before enforcing quality gates."""

import json
import math
from pathlib import Path


def validate_voice_diagnostic(value):
    """Allow only the numeric/boolean VAD evidence already emitted by the PWA."""
    booleans = {"accepted", "attempted", "available", "loadFailed", "inferenceFailed",
                "evaluated", "candidateFound"}
    allowed = {"offset", "factor", "score", "sampleCount", "thirdCount", "spread",
               "windows", "emptyWindows"} | booleans
    if not isinstance(value, dict) or set(value) - allowed:
        raise SystemExit("Unexpected voice diagnostic fields")
    for key, item in value.items():
        valid = isinstance(item, bool) if key in booleans else (
            type(item) in (int, float) and math.isfinite(item))
        if not valid:
            raise SystemExit("Voice diagnostic must contain only finite numeric evidence and accepted boolean")


def write_public_smoke_result(path, details, *, require_fine_timing, failures=()):
    payload = dict(details)
    reasons = list(failures)
    if require_fine_timing:
        timing = payload.get("timingQuality") or {}
        checks = (
            ("first-cue shift", payload.get("savedTimingShiftSeconds"), -8.0, 0.60),
            ("full-title p95 absolute start error", timing.get("startP95AbsErrorSeconds"), 0.0, 0.60),
            ("affine timing drift", timing.get("affineErrorDriftAcrossTitleSeconds"), 0.0, 0.35),
        )
        for name, value, expected, limit in checks:
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                reasons.append(f"{name}: missing or non-finite timing evidence")
            elif abs(value - expected) > limit:
                reasons.append(f"{name} {value:.3f}s outside {expected:.3f}s ± {limit:.2f}s")
    for key in ("consoleErrors", "pageErrors", "httpFailures"):
        if payload.get(key):
            reasons.append(f"Public Romanian audio workflow emitted {key}")
    payload["strictFineTimingRequired"] = require_fine_timing
    payload["status"] = "fail" if reasons else "pass"
    payload["failureReasons"] = reasons
    serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    Path(path).write_text(serialized, encoding="utf-8")
    print(serialized, end="")
    if reasons:
        raise SystemExit("Public Romanian audio smoke failed: " + "; ".join(reasons))
    return payload
