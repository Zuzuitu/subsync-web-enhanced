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
    candidateEvidenceStart: 100,
    candidateEvidenceEnd: 7000,
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
    formula: { a: 1, b: -8.4 },
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
    formula: { a: 1.00002, b: -8.45 },
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
    formula: { a: 1.00001, b: -8.50 },
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


const rescueTracker = new RomanianConvergenceTracker(7200, 21, { primaryWindows: 16 });
for (let i = 0; i < 16; i++) {
  state = rescueTracker.observe(
    { start: i * 30, end: i * 30 + 15 },
    8,
    {
      correlated: false,
      points: Math.min(15, i),
      formula: { a: 1, b: -2.5 },
      candidateEvidenceStart: 100,
      candidateEvidenceEnd: 5000 + i * 50,
    }
  );
}
assert.strictEqual(state.verified, false);
assert.strictEqual(state.rescueWindowsCompleted, 0);
assert.strictEqual(state.lastPoints, 15);

assert(state.candidateProbeCoverageRatio > 0.7);
assert.strictEqual(state.candidatePointGain, 1);

state = rescueTracker.setTotalWindows(21);
assert.strictEqual(state.totalWindows, 21);
assert.strictEqual(state.rescueWindowsTotal, 5);

state = rescueTracker.observe(
  { start: 1000, end: 1015 },
  10,
  {
    correlated: true,
    points: 20,
    formula: { a: 1, b: -8.2 },
    evidenceStart: 200,
    evidenceEnd: 6800,
    candidateEvidenceStart: 200,
    candidateEvidenceEnd: 6800,
  }
);
assert.strictEqual(state.rescueWindowsCompleted, 1);
assert.strictEqual(state.stableCorrelatedWindows, 1);
assert.strictEqual(state.verified, false);

state = rescueTracker.observe(
  { start: 3000, end: 3015 },
  11,
  {
    correlated: true,
    points: 21,
    formula: { a: 1.00001, b: -8.25 },
    evidenceStart: 150,
    evidenceEnd: 6900,
    candidateEvidenceStart: 150,
    candidateEvidenceEnd: 6900,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 2);

state = rescueTracker.observe(
  { start: 5000, end: 5015 },
  9,
  {
    correlated: true,
    points: 22,
    formula: { a: 1.00001, b: -8.30 },
    evidenceStart: 100,
    evidenceEnd: 7000,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 3);
assert.strictEqual(state.verified, true);
assert.strictEqual(state.phase, 'rescue');


// Physical Smallfoot late-lock regression: primary plus five discovery probes
// may still be noncanonical. The fixed 120-second rescue budget must leave a
// three-probe confirmation tail, so a canonical lock at 20 buckets can still
// earn two fresh-bucket confirmations without weakening any acceptance gate.
const lateLock = new RomanianConvergenceTracker(5800, 24, { primaryWindows: 16 });
for (let i = 0; i < 21; i++) {
  state = lateLock.observe(
    { start: i * 20, end: i * 20 + 15 },
    7,
    {
      correlated: false,
      points: Math.min(19, i),
      formula: { a: 1.00028, b: -11.38 },
      candidateEvidenceStart: 700,
      candidateEvidenceEnd: 5100,
    }
  );
}
assert.strictEqual(state.stableCorrelatedWindows, 0);
assert.strictEqual(state.verified, false);

for (let i = 0; i < 3; i++) {
  state = lateLock.observe(
    { start: 5000 + i * 20, end: 5015 + i * 20 },
    7,
    {
      correlated: true,
      points: 20 + i,
      formula: { a: 1.00028, b: -11.38 + i * 0.02 },
      evidenceStart: 650,
      evidenceEnd: 5100,
      candidateEvidenceStart: 650,
      candidateEvidenceEnd: 5100,
    }
  );
}
assert.strictEqual(state.completedWindows, 24);
assert.strictEqual(state.stableCorrelatedWindows, 3);
assert.strictEqual(state.verified, true);

console.log('Romanian adaptive convergence tracker: OK');
