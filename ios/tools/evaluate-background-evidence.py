#!/usr/bin/env python3
"""Read-only evaluator of exported CPU evidence; never a simulator->phone claim."""
import argparse
import json
import math
from pathlib import Path


def evaluate(document, minimum_seconds=300, confirmations=False):
    job = document["job"]
    if document.get("schemaVersion") != 1 or job.get("schemaVersion") != 1:
        raise ValueError("Unsupported evidence schema")
    if job.get("workload") != "sha256-chain-256k-x16-v1":
        raise ValueError("Unknown workload; do not combine different algorithms")
    total = job["totalUnits"]
    completed = job["completedUnits"]
    if not isinstance(total, int) or not isinstance(completed, int) or not 0 <= completed <= total or total <= 0:
        raise ValueError("Invalid real-work counters")
    if job.get("state") == "completed":
        checksum = job.get("checksum", "")
        if completed != total or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
            raise ValueError("False or malformed completion")
    seconds = cpu = units = 0
    intervals = 0
    previous = None
    for event in job["events"]:
        uptime = event["uptime"]
        process_cpu = event["metrics"]["processCPUSeconds"]
        count = event["completedUnits"]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (uptime, process_cpu, count)):
            raise ValueError("Nonfinite progress evidence")
        if not 0 <= count <= completed:
            raise ValueError("Progress count exceeds persisted work")
        if previous:
            delta_time = uptime - previous["uptime"]
            delta_cpu = process_cpu - previous["metrics"]["processCPUSeconds"]
            delta_units = count - previous["completedUnits"]
            if delta_time < 0 or delta_cpu < -0.001 or delta_units < 0:
                raise ValueError("Counters moved backwards; evidence belongs to different attempts")
            if (event["metrics"]["phase"] == previous["metrics"]["phase"] == "background"
                    and 0 < delta_time <= 30 and delta_cpu > 0 and delta_units > 0):
                seconds += delta_time
                cpu += delta_cpu
                units += delta_units
                intervals += 1
        previous = event
    physical = document.get("environment", {}).get("kind") == "physical-device"
    sufficient = physical and seconds >= minimum_seconds and cpu >= 5 and intervals >= 10
    return {
        "scope": "native CPU workload only; no subtitle synchronization/parity assertion",
        "environment": document.get("environment", {}).get("kind", "unknown"),
        "state": job["state"],
        "backgroundIntervalsWithCPUAndWork": intervals,
        "observedBackgroundSecondsWithWork": seconds,
        "backgroundProcessCPUSeconds": cpu,
        "backgroundWorkUnits": units,
        "runtimeEvidenceSufficient": sufficient,
        "testerConfirmationsProvided": confirmations,
        "physicalCPUProofAccepted": sufficient and confirmations and job["state"] == "completed",
        "screenLockAndDebugger": "tester confirmed" if confirmations else "requires physical tester confirmation",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--minimum-seconds", type=int, default=300)
    parser.add_argument("--confirm-physical-device", action="store_true")
    parser.add_argument("--confirm-debugger-detached", action="store_true")
    parser.add_argument("--confirm-screen-lock", action="store_true")
    args = parser.parse_args()
    if args.minimum_seconds < 300:
        parser.error("Physical gate is at least 5 minutes; do not relax it")
    confirmed = args.confirm_physical_device and args.confirm_debugger_detached and args.confirm_screen_lock
    result = evaluate(json.loads(args.evidence.read_text()), args.minimum_seconds, confirmed)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result["physicalCPUProofAccepted"] else 2)
