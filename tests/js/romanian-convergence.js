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
  needsLateConfirmation,
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


assert.strictEqual(
  needsLateConfirmation({
    verified: false,
    totalWindows: 21,
    completedWindows: 19,
    stableCorrelatedWindows: 1,
    probeCoverageRatio: 0.8,
  }, true),
  false,
  'two scheduled checks are enough for a 1/3 canonical lock'
);
assert.strictEqual(
  needsLateConfirmation({
    verified: false,
    totalWindows: 21,
    completedWindows: 20,
    stableCorrelatedWindows: 1,
    probeCoverageRatio: 0.8,
  }, true),
  true,
  'one remaining check cannot complete an unchanged 3/3 verifier from 1/3'
);
assert.strictEqual(
  needsLateConfirmation({
    verified: false,
    totalWindows: 21,
    completedWindows: 21,
    stableCorrelatedWindows: 1,
    probeCoverageRatio: 0.8,
  }, false),
  true,
  'retained canonical history must still request headroom after a neutral final probe'
);
assert.strictEqual(
  needsLateConfirmation({
    verified: false,
    totalWindows: 21,
    completedWindows: 21,
    stableCorrelatedWindows: 3,
    probeCoverageRatio: 0.7,
  }, true),
  true,
  'a canonical formula with 3/3 checks but deficient coverage needs one more coverage opportunity'
);
assert.strictEqual(
  needsLateConfirmation({
    verified: false,
    totalWindows: 21,
    completedWindows: 21,
    stableCorrelatedWindows: 0,
    probeCoverageRatio: 0,
  }, false),
  false,
  'never extend a run that has not produced canonical evidence'
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


// Physical Smallfoot late-lock regression: the proven 360-second planner may
// first reach a valid canonical line on its final 21st boundary. The tracker
// must preserve the original five rescue probes, then allow a separate
// confirmation-only extension without reclassifying those checks as rescue.
const lateLock = new RomanianConvergenceTracker(5800, 21, {
  primaryWindows: 16,
  baseRescueWindows: 5,
});
for (let i = 0; i < 20; i++) {
  state = lateLock.observe(
    { start: i * 20, end: i * 20 + 15 },
    7,
    {
      correlated: false,
      points: Math.min(19, i),
      formula: { a: 1.00028, b: -11.38 },
      candidateEvidenceStart: 700,
      candidateEvidenceEnd: 5100,
      factor: 0.99999,
      maxDistance: 2.5,
    }
  );
}
state = lateLock.observe(
  { start: 5100, end: 5115 },
  7,
  {
    correlated: true,
    points: 20,
    formula: { a: 1.00028, b: -11.38 },
    evidenceStart: 650,
    evidenceEnd: 5100,
    candidateEvidenceStart: 650,
    candidateEvidenceEnd: 5100,
    factor: 0.999999,
    maxDistance: 1.72,
  }
);
assert.strictEqual(state.completedWindows, 21);
assert.strictEqual(state.stableCorrelatedWindows, 1);
assert.strictEqual(state.verified, false);
assert.strictEqual(state.rescueWindowsTotal, 5);
assert.strictEqual(state.rescueWindowsCompleted, 5);
assert.strictEqual(state.lateConfirmationWindowsTotal, 0);

state = lateLock.setTotalWindows(24);
assert.strictEqual(state.rescueWindowsTotal, 5);
assert.strictEqual(state.lateConfirmationWindowsTotal, 3);
assert.strictEqual(state.lateConfirmationWindowsCompleted, 0);

state = lateLock.observe(
  { start: 5200, end: 5230 },
  8,
  {
    correlated: true,
    points: 21,
    formula: { a: 1.00027, b: -11.36 },
    evidenceStart: 640,
    evidenceEnd: 5120,
    candidateEvidenceStart: 640,
    candidateEvidenceEnd: 5120,
    factor: 0.999999,
    maxDistance: 1.70,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 2);
assert.strictEqual(state.phase, 'confirmation');
assert.strictEqual(state.lateConfirmationWindowsCompleted, 1);

state = lateLock.observe(
  { start: 5300, end: 5330 },
  9,
  {
    correlated: true,
    points: 22,
    formula: { a: 1.00027, b: -11.35 },
    evidenceStart: 630,
    evidenceEnd: 5140,
    candidateEvidenceStart: 630,
    candidateEvidenceEnd: 5140,
    factor: 0.999999,
    maxDistance: 1.68,
  }
);
assert.strictEqual(state.stableCorrelatedWindows, 3);
assert.strictEqual(state.verified, true);
assert.strictEqual(state.lateConfirmationWindowsCompleted, 2);
assert.strictEqual(state.history.length, 23);
assert.strictEqual(state.history[20].correlated, true);
assert.strictEqual(state.history[20].points, 20);
assert.strictEqual(state.history[21].canonicalPointGain, 1);
assert.strictEqual(state.history[22].stableCorrelatedWindows, 3);

console.log('Romanian adaptive convergence tracker: OK');
