import unittest
from srt_timing import measure_srt_timing


class TimingTest(unittest.TestCase):
    def test_cue_end_median_and_final_third_start_are_distinct(self):
        source = "\n\n".join(f"{i}\n00:00:{t:02},000 --> 00:00:{t+1:02},000\nx"
                             for i, t in enumerate((10, 20, 30), 1))
        output = ("1\n00:00:10,100 --> 00:00:11,500\nx\n\n"
                  "2\n00:00:20,200 --> 00:00:21,600\nx\n\n"
                  "3\n00:00:30,300 --> 00:00:31,700\nx")
        quality = measure_srt_timing(source, output, 0)
        self.assertAlmostEqual(quality["endMedianErrorSeconds"], 0.6)
        self.assertAlmostEqual(quality["finalThirdMedianErrorSeconds"], 0.3)
        self.assertAlmostEqual(quality["startP95AbsErrorSeconds"], 0.29)
        self.assertAlmostEqual(quality["affineErrorDriftAcrossTitleSeconds"], 0.2)
        self.assertEqual(quality["schemaVersion"], 2)

    def test_short_subtitle_reports_empty_partitions_explicitly(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\nx"
        quality = measure_srt_timing(text, text, 0)
        self.assertIsNone(quality["middleMedianErrorSeconds"])
        self.assertIsNone(quality["finalThirdMedianErrorSeconds"])
        self.assertEqual(quality["endMedianErrorSeconds"], 0)

    def test_changed_cue_count_still_rejected(self):
        one = "1\n00:00:01,000 --> 00:00:02,000\nx"
        with self.assertRaises(ValueError):
            measure_srt_timing(one, one + "\n\n" + one, 0)
