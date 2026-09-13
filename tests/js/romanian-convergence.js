'use strict';

const assert = require('assert');
const {
  MIN_INFORMATIVE_WORDS,
  MIN_POINT_GAIN,
  REQUIRED_STABLE_CORRELATED_WINDOWS,
  MIN_PROBE_COVERAGE_RATIO,
  MAX_FORMULA_DELTA_SECONDS,
  formulaDeltaSeconds,
  evidenceSpanRatio,
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
assert.strictEqual(
  evidenceSpanRatio({ evidenceStart: 360, evidenceEnd: 6120 }, duration),
  0.8
);

const tracker = new RomanianConvergenceTracker(duration, 16);
let state = tracker.observe(
  { start: 0, end: 15 },
  20,
  {
    correlated: true,
    points: 20,
    formula: { a: 1, b: -4 },
    evidenceStart: 200,
    evidenceEnd: 6500,
  }
);
assert.strictEqual(state.verified, false);
assert.strictEqual(state.stableCorrelatedWindows, 1);

state = tracker.observe(
  { start: 7185, end: 7200 },
  8,
  {
    correlated: true,
    points: 21,
    formula: { a: 1, b: -7.5 },
    evidenceStart: 100,
    evidenceEnd: 7000,
  }
);
assert.strictEqual(
  state.stableCorrelatedWindows,
  1,
  'a materially changed canonical formula must restart confirmation at one'
);

state = tracker.observe(
  { start: 3500, end: 3515 },
  12,
  {
    correlated: true,
    points: 22,
    formula: { a: 1, b: -8.0 },
    evidenceStart: 100,
    evidenceEnd: 7000,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 1);

state = tracker.observe(
  { start: 500, end: 515 },
  18,
  {
    correlated: true,
    points: 23,
    formula: { a: 1.00002, b: -8.05 },
    evidenceStart: 100,
    evidenceEnd: 7000,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 2);

state = tracker.observe(
  { start: 6800, end: 6815 },
  22,
  {
    correlated: true,
    points: 24,
    formula: { a: 1.00001, b: -8.10 },
    evidenceStart: 100,
    evidenceEnd: 7000,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 3);
assert(state.probeCoverageRatio >= MIN_PROBE_COVERAGE_RATIO);
assert.strictEqual(state.verified, true);

const noGain = new RomanianConvergenceTracker(1000, 16);
state = noGain.observe(
  { start: 0, end: 15 },
  6,
  {
    correlated: true,
    points: 20,
    formula: { a: 1, b: -8 },
    evidenceStart: 50,
    evidenceEnd: 900,
  }
);
state = noGain.observe(
  { start: 800, end: 815 },
  7,
  {
    correlated: true,
    points: 20,
    formula: { a: 1, b: -8.01 },
    evidenceStart: 50,
    evidenceEnd: 900,
  }
);
assert.strictEqual(
  state.stableCorrelatedWindows,
  1,
  'recognized speech without a new canonical bucket must not confirm convergence'
);

const gaps = new RomanianConvergenceTracker(1000, 16);
state = gaps.observe(
  { start: 0, end: 15 },
  6,
  {
    correlated: true,
    points: 20,
    formula: { a: 1, b: -8 },
    evidenceStart: 50,
    evidenceEnd: 900,
  }
);
state = gaps.observe({ start: 500, end: 515 }, 0, {
  correlated: false,
  points: 19,
  formula: { a: 1, b: -2 },
});
assert.strictEqual(
  state.stableCorrelatedWindows,
  1,
  'an inconclusive probe must not erase canonical confirmation'
);
assert.strictEqual(state.probeCoverageRatio, 0.85);

console.log('Romanian adaptive convergence tracker: OK');
