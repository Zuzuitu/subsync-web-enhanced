from pathlib import Path
import tempfile
import unittest
import wave
from fixture_identity import fixture_identity, synthesis_parameters


class IdentityTest(unittest.TestCase):
    def test_synthesis_parameters_are_explicit_and_opt_in(self):
        self.assertEqual(synthesis_parameters(False), {})
        self.assertEqual(synthesis_parameters(True),
                         {"length_scale": 1.0, "noise_scale": 0.0, "noise_w_scale": 0.0})

    def test_identity_detects_pcm_srt_and_container_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def write_audio(samples):
                with wave.open(str(root / "reference-romanian.wav"), "wb") as wav:
                    wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                    wav.writeframes(samples)
            write_audio(b"\x00\x00" * 50)
            (root / "target.rum.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nțară")
            (root / "reference-romanian.mkv").write_bytes(b"synthetic test container")
            initial = fixture_identity(root)
            self.assertEqual(initial, fixture_identity(root))
            write_audio(b"\x01\x00" * 50)
            self.assertNotEqual(initial["pcm"], fixture_identity(root)["pcm"])
            (root / "target.rum.srt").write_text("changed")
            self.assertNotEqual(initial["subtitleSha256"], fixture_identity(root)["subtitleSha256"])
            (root / "reference-romanian.mkv").write_bytes(b"changed")
            self.assertNotEqual(initial["mkvSha256"], fixture_identity(root)["mkvSha256"])
