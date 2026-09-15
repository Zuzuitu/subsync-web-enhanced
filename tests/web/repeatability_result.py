"""Describe repeatability separately from per-run strict timing acceptance."""


def summarize_runs(records, identity):
    failures = []
    results = [item["result"] for item in records]
    if len(records) != 3:
        failures.append("Expected exactly three fixed replays")
    for index, item in enumerate(records, 1):
        result = item["result"]
        if item["exitCode"] or result.get("status") != "pass":
            failures.append(f"Replay {index} failed; inspect its JSON and browser.log")
        if result.get("inputIdentity") != identity:
            failures.append(f"Replay {index} did not verify the retained input")
        if not result.get("strictFineTimingRequired"):
            failures.append(f"Replay {index} did not enforce strict timing")
        assets = result.get("runtimeAssets", {})
        if not all(any(f"/scripts/{name}?" in url for url in assets)
                   for name in ("whisper.js", "whisper.wasm")):
            failures.append(f"Replay {index} lacks runtime byte hashes")
        if not result.get("browserVersion"):
            failures.append(f"Replay {index} lacks browser version")
    if results and any(r.get("runtimeAssets") != results[0].get("runtimeAssets") or
                       r.get("browserVersion") != results[0].get("browserVersion")
                       for r in results[1:]):
        failures.append("Runtime/browser changed between replays; comparison is confounded")

    def equal(key):
        values = [r.get(key) for r in results]
        return bool(values) and all(v is not None and v == values[0] for v in values)

    return {
        "status": "fail" if failures else "pass",
        "failureReasons": failures,
        "inputIdentity": identity,
        "outputBytesIdentical": equal("outputSubtitleSha256"),
        "referenceWordCountsIdentical": equal("referenceWords"),
        "correlationTracesIdentical": equal("correlationTrace"),
        "interpretation": "PASS means all fixed runs satisfy quality and input/runtime identity, not that outputs are identical",
        "measurements": [{key: r.get(key) for key in (
            "referenceWords", "romanianContextAnchors", "romanianAdaptiveProbesCompleted",
            "pointsText", "formulaText", "precisionEvidenceText", "precisionRobustnessText",
            "savedTimingShiftSeconds", "timingQuality", "outputSubtitleSha256",
        )} for r in results],
    }
