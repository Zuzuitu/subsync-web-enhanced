'use strict';

const assert = require('assert');
const {
  MIN_INFORMATIVE_WORDS,
  MIN_POINT_GAIN,
  REQUIRED_STABLE_CORRELATED_WINDOWS,
  MIN_PROBE_COVERAGE_RATIO,
  MAX_FORMULA_DELTA_SECONDS,
  formulaDeltaSeconds,
  RomanianConvergenceTracker,
} = require('../../web/src/romanian-convergence.js');

assert.strictEqual(MIN_INFORMATIVE_WORDS, 4);
assert.strictEqual(MIN_POINT_GAIN, 1);
assert.strictEqual(REQUIRED_STABLE_CORRELATED_WINDOWS, 3);
assert.strictEqual(MIN_PROBE_COVERAGE_RATIO, 0.75);
assert.strictEqual(MAX_FORMULA_DELTA_SECONDS, 0.75);

const duration = 7200;
assert.strictEqual(
  formulaDeltaSeconds({ a: 1, b: -8 }, { a: 1, b: -8.5 }, duration),
  0.5
);
assert(
  formulaDeltaSeconds({ a: 1, b: -8 }, { a: 1.001, b: -8 }, duration) > 7,
  'slope drift must be evaluated across the full title'
);

const tracker = new RomanianConvergenceTracker(duration, 16);
let state = tracker.observe(
  { start: 0, end: 15 },
  20,
  { correlated: true, points: 20, formula: { a: 1, b: -4 } }
);
assert.strictEqual(state.verified, false);
assert.strictEqual(state.stableCorrelatedWindows, 1);

state = tracker.observe(
  { start: 7185, end: 7200 },
  0,
  { correlated: true, points: 20, formula: { a: 1, b: -7.5 } }
);
assert.strictEqual(state.verified, false);
assert.strictEqual(
  state.stableCorrelatedWindows,
  0,
  'a materially changed formula must invalidate the early lock'
);

state = tracker.observe(
  { start: 3500, end: 3515 },
  25,
  { correlated: true, points: 21, formula: { a: 1, b: -8.0 } }
);
assert.strictEqual(state.stableCorrelatedWindows, 1);
assert.strictEqual(state.verified, false);

state = tracker.observe(
  { start: 1700, end: 1715 },
  18,
  { correlated: true, points: 22, formula: { a: 1.00002, b: -8.05 } }
);
assert.strictEqual(state.stableCorrelatedWindows, 2);
assert.strictEqual(state.verified, false);

state = tracker.observe(
  { start: 5300, end: 5315 },
  22,
  { correlated: true, points: 23, formula: { a: 1.00001, b: -8.10 } }
);
assert.strictEqual(state.stableCorrelatedWindows, 3);
assert(state.probeCoverageRatio >= MIN_PROBE_COVERAGE_RATIO);
assert.strictEqual(
  state.verified,
  true,
  'adaptive stop requires canonical correlation plus repeated stable evidence'
);

const sparse = new RomanianConvergenceTracker(1000, 16);
for (let i = 0; i < 5; i++) {
  state = sparse.observe(
    { start: i * 20, end: i * 20 + 15 },
    20,
    { correlated: true, points: 20 + i, formula: { a: 1, b: -8 } }
  );
}
assert.strictEqual(
  state.verified,
  false,
  'stable evidence from only one small region must not stop the scan'
);


// A stable global formula must not gain confirmations from speech that adds
// no new canonical synchronization buckets.
const noGain = new RomanianConvergenceTracker(1000, 16);
state = noGain.observe(
  { start: 0, end: 15 },
  6,
  { correlated: true, points: 20, formula: { a: 1, b: -8 } }
);
assert.strictEqual(state.stableCorrelatedWindows, 1);
state = noGain.observe(
  { start: 800, end: 815 },
  7,
  { correlated: true, points: 20, formula: { a: 1, b: -8.01 } }
);
assert.strictEqual(
  state.stableCorrelatedWindows,
  1,
  'a probe with recognized speech but no new correlation bucket must not confirm convergence'
);

console.log('Romanian adaptive convergence tracker: OK');
