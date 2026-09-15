#!/usr/bin/env python3
"""Run the pinned fork's actual method in isolation, without its desktop stack.

Download subsync/subtitle.py at Sefzz15/subsync commit
a8b4e9ec6858d86030d726856a6a2232079c3097, then pass its local path.
This is an opt-in research reproduction, not production code or a CI download.
"""
import ast
import bisect
import copy
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
from types import SimpleNamespace

source = Path(sys.argv[1]).read_bytes().rstrip(b'\n') + b'\n\n'
# Normalize only terminal newlines to the pinned Git blob's two LF bytes.
assert hashlib.sha256(source).hexdigest() == 'f3b52212843e35099f9cc03e388baf33e06531176e602f6868a1860198ca8187'
tree = ast.parse(source)
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Subtitles')
method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'synchronizePiecewise')
namespace = dict(copy=copy, bisect=bisect, math=math, statistics=statistics)
exec(compile(ast.Module(body=[method], type_ignores=[]), '<pinned-fork-method>', 'exec'), namespace)


class Subtitles(list):
    synchronizePiecewise = namespace['synchronizePiecewise']

    def sort(self):
        super().sort(key=lambda e: e.start)

    def synchronize(self, formula):
        return Subtitles(SimpleNamespace(start=e.start * formula.a + formula.b * 1000,
            end=e.end * formula.a + formula.b * 1000) for e in self)


class Formula:
    def __init__(self, a, b):
        self.a, self.b = a, b

    def getY(self, time):
        return self.a * time + self.b


# Perfect affine data at a standard 24->25-style speed ratio. No noise/cuts.
formula = Formula(25 / 24, 8)
events = Subtitles(SimpleNamespace(start=t * 1000, end=(t + 4) * 1000)
                  for t in [200, 500, 800])
points = [(t, formula.getY(t)) for center in [180, 480, 780]
          for t in range(center, center + 7)]
linear = events.synchronize(formula)
piecewise = events.synchronizePiecewise(points, formula)
start_deltas = [(p.start - l.start) / 1000 for p, l in zip(piecewise, linear)]
duration_deltas = [((p.end - p.start) - (l.end - l.start)) / 1000
                   for p, l in zip(piecewise, linear)]
assert max(map(abs, start_deltas)) > 0.5, 'Re-check fork: clean-affine behavior changed'
assert max(map(abs, duration_deltas)) > 0.1

# A perfect +8 s cut step with no surviving post-cut points in a global inlier band.
# This tests the downstream method's limitation, not recognition or cut detection.
events = Subtitles(SimpleNamespace(start=t * 1000, end=(t + 4) * 1000)
                  for t in [100, 200, 300, 500, 600, 700])
retained_points = [(t, t) for t in range(90, 310, 10)]
result = events.synchronizePiecewise(retained_points, Formula(1, 0))
missing_step_errors = [(e.start / 1000 - (t + (8 if t >= 500 else 0)))
                       for e, t in zip(result, [100, 200, 300, 500, 600, 700])]
assert missing_step_errors[-1] == -8
# Positive control: sufficient ideal support on BOTH sides recovers this step.
dense_points = [(t, t) for t in range(90, 311, 5)] + [(t, t + 8) for t in range(490, 711, 5)]
supported = events.synchronizePiecewise(dense_points, Formula(1, 0))
supported_errors = [(e.start / 1000 - (t + (8 if t >= 500 else 0)))
                    for e, t in zip(supported, [100, 200, 300, 500, 600, 700])]
assert supported_errors == [0.0] * 6
print(json.dumps({
    'forkCommit': 'a8b4e9ec6858d86030d726856a6a2232079c3097',
    'cleanAffineStartDeltaSeconds': start_deltas,
    'cleanAffineDurationDeltaSeconds': duration_deltas,
    'cutStepWithoutPostCutEvidenceErrorSeconds': missing_step_errors,
    'cutStepWithDenseIdealEvidenceErrorSeconds': supported_errors,
    'scope': 'Actual Python method; ideal points; no ASR, native fit or browser integration.'
}, indent=2))
