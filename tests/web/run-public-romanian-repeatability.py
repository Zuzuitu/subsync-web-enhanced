#!/usr/bin/env python3
"""Fixed-count study: independent syntheses, then fresh browsers on one input."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/fixtures"))
from fixture_identity import fixture_identity
from repeatability_result import summarize_runs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture-dir", type=Path, help="Reuse a previously retained synthetic fixture")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "tests/generated/romanian-repeatability")
    args = parser.parse_args()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    summary = {"status": "fail", "runs": [], "failureReasons": []}
    result = out / "repeatability.json"
    env = dict(os.environ)

    def run(command, run_env, log, timeout):
        with log.open("w", encoding="utf-8") as stream:
            try:
                return subprocess.run(command, cwd=ROOT, env=run_env, stdout=stream,
                                      stderr=subprocess.STDOUT, timeout=timeout).returncode
            except subprocess.TimeoutExpired:
                stream.write(f"\nStudy subprocess exceeded {timeout}s\n")
                return 124

    try:
        if args.fixture_dir:
            fixture_dir = args.fixture_dir.resolve()
            summary["synthesisComparison"] = "not run: retained fixture supplied"
        else:
            identities = []
            for label in ("a", "b"):
                directory = out / ("fixture-" + label)
                rc = run([sys.executable, "tests/fixtures/generate-romanian-audio-e2e.py"],
                         {**env, "SUBSYNC_ROMANIAN_FIXTURE_DIR": str(directory),
                          "SUBSYNC_ROMANIAN_DETERMINISTIC": "1"},
                         out / f"synthesis-{label}.log", 600)
                if rc:
                    raise RuntimeError(f"Synthesis {label} exited {rc}")
                identities.append(fixture_identity(directory))
            summary["synthesisComparison"] = {
                "identities": identities,
                "pcmIdentical": identities[0]["pcm"] == identities[1]["pcm"],
                "subtitleIdentical": identities[0]["subtitleSha256"] == identities[1]["subtitleSha256"],
                "note": "Independent MKV container metadata is not required to match",
            }
            fixture_dir = out / "fixture-a"

        identity = fixture_identity(fixture_dir)
        records = []
        for number in range(1, 4):
            directory = out / f"run-{number}"
            directory.mkdir()
            if fixture_identity(fixture_dir) != identity:
                raise RuntimeError("Retained input changed before replay")
            rc = run([sys.executable, "tests/web/run-public-pages-romanian-audio-smoke.py"],
                     {**env, "SUBSYNC_ROMANIAN_FIXTURE_DIR": str(fixture_dir),
                      "SUBSYNC_ROMANIAN_RESULT_DIR": str(directory),
                      "SUBSYNC_ROMANIAN_CAPTURE_RPC": "1",
                      "SUBSYNC2_REQUIRE_FINE_TIMING": "1",
                      "SUBSYNC2_REQUIRE_CONTEXT_ANCHORS": "1",
                      "SUBSYNC2_REQUIRE_PRECISION_DIAGNOSTICS": "1"},
                     directory / "browser.log", 720)
            record_path = directory / "public-pages-romanian-audio.json"
            record = json.loads(record_path.read_text()) if record_path.exists() else {}
            records.append({"exitCode": rc, "result": record})
            summary["runs"] = [{"number": i + 1, "exitCode": item["exitCode"],
                                 "status": item["result"].get("status", "missing")}
                                for i, item in enumerate(records)]
            result.write_text(json.dumps(summary, indent=2) + "\n")
            print(f"Fixed replay {number}/3: exit {rc}", flush=True)
        if fixture_identity(fixture_dir) != identity:
            raise RuntimeError("Retained input changed during replay")
        summary.update(summarize_runs(records, identity))
    except Exception as exc:
        summary["status"] = "fail"
        summary["failureReasons"].append(f"{type(exc).__name__}: {exc}")
    finally:
        result.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0 if summary["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
