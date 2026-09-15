import copy
import unittest
from repeatability_result import summarize_runs


class RepeatabilityTest(unittest.TestCase):
    def setUp(self):
        self.identity = {"pcm": {"sha256": "pcm"}, "subtitleSha256": "srt", "mkvSha256": "mkv"}
        result = {
            "status": "pass", "inputIdentity": self.identity, "strictFineTimingRequired": True,
            "runtimeAssets": {"https://example/scripts/whisper.js?v": "js", "https://example/scripts/whisper.wasm?v": "wasm"},
            "browserVersion": "test", "outputSubtitleSha256": "output", "referenceWords": 150,
            "correlationTrace": {"events": [1]},
        }
        self.records = [copy.deepcopy({"exitCode": 0, "result": result}) for _ in range(3)]

    def test_stable(self):
        report = summarize_runs(self.records, self.identity)
        self.assertEqual(report["status"], "pass")
        self.assertTrue(report["outputBytesIdentical"])

    def test_variability_is_not_hidden_by_passing_quality(self):
        self.records[1]["result"]["outputSubtitleSha256"] = "different"
        report = summarize_runs(self.records, self.identity)
        self.assertEqual(report["status"], "pass")
        self.assertFalse(report["outputBytesIdentical"])

    def test_failed_run_is_not_masked_by_other_passes(self):
        self.records[0]["exitCode"] = 1
        self.records[0]["result"]["status"] = "fail"
        self.assertEqual(summarize_runs(self.records, self.identity)["status"], "fail")

    def test_changed_inputs_runtime_missing_results_and_missing_runs_fail(self):
        for field in ("inputIdentity", "runtimeAssets", "browserVersion", "strictFineTimingRequired"):
            with self.subTest(field=field):
                records = copy.deepcopy(self.records)
                records[1]["result"].pop(field)
                self.assertEqual(summarize_runs(records, self.identity)["status"], "fail")
        self.assertEqual(summarize_runs(self.records[:2], self.identity)["status"], "fail")
        self.assertEqual(summarize_runs([{"exitCode": 124, "result": {}}] * 3, self.identity)["status"], "fail")
