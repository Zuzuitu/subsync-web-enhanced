import copy
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / "ios/tools/evaluate-background-evidence.py"
spec = importlib.util.spec_from_file_location("background_evidence", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def evidence(kind="physical-device"):
    return {
        "schemaVersion": 1,
        "environment": {"kind": kind},
        "job": {
            "schemaVersion": 1, "workload": "sha256-chain-256k-x16-v1",
            "totalUnits": 160, "completedUnits": 160, "checksum": "a" * 64,
            "state": "completed",
            "events": [{"kind": "progress", "uptime": 100 + i * 20, "completedUnits": i * 10,
                        "metrics": {"processCPUSeconds": i * 5, "phase": "background"}}
                       for i in range(17)],
        },
    }


class BackgroundEvidenceTests(unittest.TestCase):
    def test_valid_data_still_requires_tester_confirmations(self):
        result = module.evaluate(evidence())
        self.assertTrue(result["runtimeEvidenceSufficient"])
        self.assertFalse(result["physicalCPUProofAccepted"])
        self.assertTrue(module.evaluate(evidence(), confirmations=True)["physicalCPUProofAccepted"])

    def test_simulator_cannot_pass_as_physical(self):
        self.assertFalse(module.evaluate(evidence("simulator"), confirmations=True)["physicalCPUProofAccepted"])

    def test_stalled_work_or_cpu_or_foreground_cannot_pass(self):
        for field in ("work", "cpu", "phase"):
            data = evidence()
            for event in data["job"]["events"]:
                if field == "work": event["completedUnits"] = 0
                if field == "cpu": event["metrics"]["processCPUSeconds"] = 0
                if field == "phase": event["metrics"]["phase"] = "active"
            self.assertFalse(module.evaluate(data, confirmations=True)["physicalCPUProofAccepted"])

    def test_large_suspension_gaps_do_not_count(self):
        data = evidence()
        for i, event in enumerate(data["job"]["events"]): event["uptime"] = i * 60
        self.assertEqual(module.evaluate(data)["observedBackgroundSecondsWithWork"], 0)

    def test_invalid_or_backwards_or_false_completion_is_rejected(self):
        for field in ("count", "time", "nan", "completed"):
            data = evidence()
            if field == "count": data["job"]["events"][-1]["completedUnits"] = -1
            if field == "time": data["job"]["events"][-1]["uptime"] = 0
            if field == "nan": data["job"]["events"][-1]["metrics"]["processCPUSeconds"] = float("nan")
            if field == "completed": data["job"]["completedUnits"] = 159
            with self.assertRaises(ValueError): module.evaluate(data)

    def test_interrupted_job_is_not_a_completed_physical_gate(self):
        data = evidence()
        data["job"]["state"] = "interrupted"
        self.assertTrue(module.evaluate(data)["runtimeEvidenceSufficient"])
        self.assertFalse(module.evaluate(data, confirmations=True)["physicalCPUProofAccepted"])


if __name__ == "__main__":
    unittest.main()
