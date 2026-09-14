import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from public_smoke_result import write_public_smoke_result


class PublicSmokeResultTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "result.json"
        self.evidence = {
            "referenceWords": 156,
            "romanianContextAnchors": 136,
            "romanianAdaptiveProbesCompleted": 10,
            "romanianAdaptiveProbesTotal": 21,
            "pointsText": "26",
            "formulaText": "1.0004x-8.561",
            "precisionEvidenceText": "28 cue buckets · thirds 11/8/9 · raw matches 85",
            "precisionRobustnessText": "leave-one-cue max 181 ms · slope max 456 ppm",
            "precisionBuckets": 28,
            "precisionThirdBuckets": [11, 8, 9],
            "savedTimingShiftSeconds": -8.554,
            "timingQuality": {
                "startP95AbsErrorSeconds": 0.5461,
                "affineErrorDriftAcrossTitleSeconds": 0.1687,
            },
            "consoleErrors": [], "pageErrors": [], "httpFailures": [],
        }

    def write(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return write_public_smoke_result(self.path, self.evidence, **kwargs)

    def assert_evidence_preserved(self, status):
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved["status"], status)
        for key, value in self.evidence.items():
            self.assertEqual(saved[key], value, key)
        return saved

    def test_pass_writes_complete_json_without_exception(self):
        self.write(require_fine_timing=True)
        self.assertEqual(self.assert_evidence_preserved("pass")["failureReasons"], [])

    def test_drift_failure_is_persisted_before_exit(self):
        for drift in (0.450, -0.450):
            with self.subTest(drift=drift):
                self.evidence["timingQuality"]["affineErrorDriftAcrossTitleSeconds"] = drift
                try:
                    self.write(require_fine_timing=True)
                except SystemExit as exc:
                    saved = self.assert_evidence_preserved("fail")
                    self.assertEqual(len(saved["failureReasons"]), 1)
                    self.assertIn("affine timing drift", str(exc))
                else:
                    self.fail("A strict failure must exit nonzero")

    def test_multiple_failures_retain_all_evidence(self):
        self.evidence["savedTimingShiftSeconds"] = -9.0
        self.evidence["timingQuality"].update(
            startP95AbsErrorSeconds=0.7, affineErrorDriftAcrossTitleSeconds=0.45,
        )
        self.evidence["pageErrors"] = ["runtime error"]
        with self.assertRaises(SystemExit):
            self.write(require_fine_timing=True, failures=["lost diacritics"])
        self.assertEqual(len(self.assert_evidence_preserved("fail")["failureReasons"]), 5)

    def test_non_strict_mode_still_fails_browser_errors(self):
        self.evidence["timingQuality"]["affineErrorDriftAcrossTitleSeconds"] = 0.45
        self.write(require_fine_timing=False)
        self.assert_evidence_preserved("pass")
        self.evidence["httpFailures"] = [{"status": 404, "url": "missing.wasm"}]
        with self.assertRaises(SystemExit):
            self.write(require_fine_timing=False)
        self.assert_evidence_preserved("fail")

    def test_missing_timing_fails_closed_and_keeps_precision(self):
        del self.evidence["timingQuality"]["affineErrorDriftAcrossTitleSeconds"]
        with self.assertRaises(SystemExit):
            self.write(require_fine_timing=True)
        self.assert_evidence_preserved("fail")


if __name__ == "__main__":
    unittest.main()
