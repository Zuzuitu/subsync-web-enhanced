#!/usr/bin/env python3
import math
import re
from statistics import mean, median


TIMING_RE = re.compile(
    r"(?m)^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+"
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)


def _seconds(parts):
    h, m, s, ms = parts
    return h * 3600 + m * 60 + s + ms / 1000.0


def parse_srt_times(text):
    cues = []
    for match in TIMING_RE.finditer(text):
        values = list(map(int, match.groups()))
        cues.append((_seconds(values[:4]), _seconds(values[4:])))
    if not cues:
        raise ValueError("SRT contains no parseable cue timestamps")
    return cues


def _percentile(values, fraction):
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = fraction * (len(ordered) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return ordered[lo]
    weight = pos - lo
    return ordered[lo] * (1.0 - weight) + ordered[hi] * weight


def _linear_fit(times, errors):
    n = len(times)
    avg_t = mean(times)
    avg_e = mean(errors)
    denom = sum((t - avg_t) ** 2 for t in times)
    slope = (
        sum((t - avg_t) * (e - avg_e) for t, e in zip(times, errors)) / denom
        if denom
        else 0.0
    )
    intercept = avg_e - slope * avg_t
    fitted = [intercept + slope * t for t in times]
    ss_res = sum((e - f) ** 2 for e, f in zip(errors, fitted))
    ss_tot = sum((e - avg_e) ** 2 for e in errors)
    r2 = 1.0 - ss_res / ss_tot if ss_tot else 1.0
    return intercept, slope, r2


def measure_srt_timing(input_text, output_text, expected_shift):
    source = parse_srt_times(input_text)
    output = parse_srt_times(output_text)
    if len(source) != len(output):
        raise ValueError(
            f"SRT cue count changed during synchronization: {len(source)} -> {len(output)}"
        )

    start_errors = []
    end_errors = []
    source_times = []
    for (src_start, src_end), (out_start, out_end) in zip(source, output):
        expected_start = src_start + expected_shift
        expected_end = src_end + expected_shift
        start_errors.append(out_start - expected_start)
        end_errors.append(out_end - expected_end)
        source_times.append(expected_start)

    intercept, slope, r2 = _linear_fit(source_times, start_errors)
    duration = max(source_times) - min(source_times) if source_times else 0.0

    third_size = max(1, len(start_errors) // 3)
    def optional_median(values):
        return median(values) if values else None

    thirds = {
        "beginningMedianErrorSeconds": optional_median(start_errors[:third_size]),
        "middleMedianErrorSeconds": optional_median(start_errors[third_size:2 * third_size]),
        "finalThirdMedianErrorSeconds": optional_median(start_errors[2 * third_size:]),
    }

    return {
        "schemaVersion": 2,
        "thirdPartition": "cue-count",
        "cueCount": len(source),
        "startMeanErrorSeconds": mean(start_errors),
        "startMedianErrorSeconds": median(start_errors),
        "startMedianAbsErrorSeconds": median([abs(x) for x in start_errors]),
        "startP95AbsErrorSeconds": _percentile([abs(x) for x in start_errors], 0.95),
        "startMaxAbsErrorSeconds": max(abs(x) for x in start_errors),
        "endMeanErrorSeconds": mean(end_errors),
        "endMedianErrorSeconds": median(end_errors),
        "endMedianAbsErrorSeconds": median([abs(x) for x in end_errors]),
        "affineErrorInterceptSeconds": intercept,
        "affineErrorSlopePpm": slope * 1_000_000.0,
        "affineErrorDriftAcrossTitleSeconds": slope * duration,
        "affineErrorR2": r2,
        **thirds,
    }
