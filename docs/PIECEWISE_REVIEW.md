# Piecewise synchronization review

Reviewed fork: [Sefzz15/subsync](https://github.com/Sefzz15/subsync), commit
`a8b4e9ec6858d86030d726856a6a2232079c3097` (GPLv3, original sc0ty credit retained).
No fork runtime code or toolchain changes have been imported.

## What the fork actually does

`subsync/subtitle.py::synchronizePiecewise` adds local median-offset corrections
to a global affine baseline, using a 45-second half-window and at least six raw
points, significance shrinkage, interpolation/held corrections in gaps, and
three-cue median smoothing. It preserves each original cue duration rather than
scaling both endpoints. These are fork-local defaults, NOT new SubSync2 thresholds.

`subsync/synchro/segmented.py` separately detects backward start-time jumps in
file order and synchronizes the segments independently. Failed segments can keep
their original timing while successful segments are merged. SubSync2 must not
adopt that partial-success behavior as verified Romanian adaptive synchronization.
Out-of-order or overlapping subtitle content is not proof of a cut in a movie.

## Isolated reproduction

Save the pinned fork's `subsync/subtitle.py` locally and run:

```sh
python tests/research/reproduce-piecewise-fork.py /path/to/subtitle.py
```

The script checks the exact source SHA256, extracts the actual method with AST,
and supplies minimal in-memory subtitle/formula objects. No desktop dependencies,
ASR, native correlation or browser are involved. This is a method-level stress
case, not a physical-title or full-pipeline failure claim.

Observed results:

- Perfect 25/24 affine points, three sparse sample cues: piecewise start deltas
  versus the exact affine result are +5.541667, -0.708333, -6.958333 seconds.
  Duration delta is -0.166667 seconds for each four-second cue.
- A +8-second step with no post-cut points supplied remains eight seconds wrong
  after the cut. This establishes a downstream information limitation; it does
  not prove the native matcher will discard those points in every real case.

Code explains the first result: local medians use `ref - sub`, not detrended
residuals `ref - (a*sub+b)`; smoothing includes the baseline offset and averages
the two endpoint neighbours even across long gaps. These operations need not
preserve a perfect affine solution. Duration preservation also differs from our
canonical endpoint mapping.

In SubSync2, `getUsedPoints()` reselects the current global line's distance band;
it is not a complete, independently verified set of correspondences across cuts.
The WASM interface currently exports aggregate stats, not point coordinates.
Merely feeding that inlier band into the fork is not sufficient cut detection.

## Integration decision

Do not ship the fork method unmodified. Keep the default sc0ty linear path and
all canonical thresholds/Save guards. A future optional advanced mode needs:

1. Bounded point provenance and unique-cue support across candidate segments,
   including evidence outside the winning global line without trusting all raw
   word matches as correct.
2. Regressions for clean affine invariance, inserted/deleted scenes, ambiguous
   repeated dialogue, sparse gaps, multiple cuts, reordered cues and boundaries.
3. Explicit behavior for cues inside missing scenes, unsupported segments and
   duration mapping; no hidden partial-success fallback or interpolated certainty.
4. Independent segment validation within the existing 360-second audio budget,
   with linear fallback/inconclusive behavior when evidence is insufficient.
5. Multiple real-title comparisons before enabling a product export mode.

The first user-facing addition is read-only timing review plus a privacy-bounded
diagnostic download, which supports those validations without changing timing.
