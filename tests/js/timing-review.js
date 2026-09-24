'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');
const path = require('path');
const { timingReview, diagnosticReport } = require('../../web/src/timing-review.js');

const events = [
  {start: 10, end: 12, text: 'secret title'},
  {start: 300, end: 305, text: 'private speech'},
  {start: 600, end: 604, text: '<script>bad()</script>'},
];
const before = JSON.stringify(events);
const formula = {a: 1.001, b: -15};
const review = timingReview(events, formula);
assert.strictEqual(review.available, true);
assert.strictEqual(review.samples.length, 3);
assert.strictEqual(review.samples[0].afterStart, 0);
assert.strictEqual(review.samples[0].afterEnd, 0);
assert.strictEqual(review.samples[1].afterStart, 1.001 * 300 - 15);
assert.strictEqual(JSON.stringify(events), before, 'never reorder or mutate output events');
assert.strictEqual(timingReview([], formula).available, false);
assert.strictEqual(timingReview(events, {a: NaN, b: 0}).available, false);
assert.strictEqual(timingReview(events, {a: 0, b: 0}).available, false);
assert.strictEqual(timingReview(events.slice(0, 1), formula).samples.length, 1);
assert.strictEqual(timingReview(events.slice(0, 2), formula).samples.length, 2);
const reversed = timingReview([events[2], events[0], events[1]], formula);
assert.strictEqual(reversed.backwardStarts, 1);
assert.strictEqual(reversed.samples[0].cue, 2, 'chronological samples retain original cue indices');
assert.strictEqual(timingReview([{start: 3, end: 2}], formula).invalidCues, 1);
assert.strictEqual(timingReview([{start: 0, end: 4}, {start: 2, end: 5}], formula).backwardStarts, 0,
  'overlapping cues do not imply backward start-time jumps');

const status = {subReady: true, formula, canonicalFormula: {a: 1, b: -15}, points: 28, correlated: true,
  precision: {
    available: true,
    rawPoints: 27,
    buckets: 22,
    beginningBuckets: 8,
    middleBuckets: 8,
    endBuckets: 6,
    refinementAvailable: true,
    refinementFactor: 0.99999,
    refinementMaxDistance: 1.4,
    refinementMappedDelta: 0.2,
    refinementApplied: true,
    robustRetainedApplied: true,
    robustInlierBuckets: 21,
    robustInlierPoints: 25,
    fitPointTimes: [[110.25, 100.25], [210.5, 200.5]],
    fitPointTimesTruncated: false,
  },
  diagnostics: {refWords: 161, romanianConvergence: {
    verified: false,
    completedWindows: 10,
    lateConfirmationWindowsTotal: 3,
    lateConfirmationWindowsCompleted: 1,
    history: [{
      index: 10,
      start: 120,
      end: 150,
      words: 8,
      points: 20,
      correlated: true,
      candidatePointGain: 1,
      canonicalPointGain: 1,
      candidateCoverageRatio: 0.8,
      canonicalCoverageRatio: 0.78,
      stableCorrelatedWindows: 1,
      formulaDeltaSeconds: 0.1,
      factor: 0.99999,
      maxDistance: 1.4,
      leakedText: 'private speech',
    }],
  },
    errors: [{message: '/private/movie.mkv transcript'}], privateExtra: 'secret'}};
const env = {runtime: {hash: 'fixture'}, browser: 'test', elapsedSeconds: 1, outcome: 'completed'};
let report = diagnosticReport(status, review, env);
assert.strictEqual(report.saveEligible, false, 'pending adaptive lock stays fail-closed');
assert.strictEqual(report.errorCount, 1);
assert.strictEqual(report.evidence.refWords, 161);
assert.strictEqual(report.convergence.completedWindows, 10);
assert.strictEqual(report.convergence.lateConfirmationWindowsTotal, 3);
assert.strictEqual(report.probeHistory.length, 1);
assert.strictEqual(report.probeHistory[0].points, 20);
assert.strictEqual(report.probeHistory[0].correlated, true);
assert.strictEqual(report.probeHistory[0].leakedText, undefined);
assert.deepStrictEqual(report.canonicalFormula, {a: 1, b: -15});
assert.strictEqual(report.precision.refinementAvailable, true);
assert.strictEqual(report.precision.refinementApplied, true);
assert.strictEqual(report.precision.refinementMappedDelta, 0.2);
assert.strictEqual(report.precision.robustRetainedApplied, true);
assert.strictEqual(report.precision.robustInlierBuckets, 21);
assert.strictEqual(report.precision.robustInlierPoints, 25);
assert.deepStrictEqual(report.precision.fitPointTimes, [[110.25, 100.25], [210.5, 200.5]]);
assert.strictEqual(report.precision.fitPointTimesTruncated, false);
status.precision.fitPointTimes = [[110, 100, 'private speech']];
assert.strictEqual(diagnosticReport(status, review, env).precision.fitPointTimes, undefined);
status.precision.fitPointTimes = Array.from({length: 257}, () => [1, 2]);
assert.strictEqual(diagnosticReport(status, review, env).precision.fitPointTimes, undefined);
assert(!/secret|private|script>/.test(JSON.stringify(report)), 'report excludes user text and paths');
assert.deepStrictEqual(diagnosticReport({}, timingReview([], null), env).formula, {});
status.diagnostics.romanianConvergence.verified = true;
assert.strictEqual(diagnosticReport(status, review, env).saveEligible, true);

// Compare against the real, unchanged SRT exporter rather than a second formula implementation.
const filename = path.resolve(__dirname, '../../web/src/subtitle.js');
const sandbox = {module: {exports: {}}, require: createRequire(filename)};
vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace('export default class Subtitles',
  'module.exports = class Subtitles'), sandbox);
const subtitles = new sandbox.module.exports();
events.forEach(event => subtitles.addSubtitle(event));
const savedBefore = subtitles.getSynchronizedSubtitles(formula, 'srt').join('');
const preview = subtitles.getTimingReview(formula);
assert.strictEqual(subtitles.getSynchronizedSubtitles(formula, 'srt').join(''), savedBefore);
const timestamps = savedBefore.match(/\d\d:\d\d:\d\d,\d\d\d/g);
function seconds(value) {
  const [h, m, s] = value.replace(',', '.').split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
preview.samples.forEach((sample, i) => {
  assert(Math.abs(seconds(timestamps[i * 2]) - sample.afterStart) < 0.0011);
  assert(Math.abs(seconds(timestamps[i * 2 + 1]) - sample.afterEnd) < 0.0011);
});
console.log('Read-only timing review, export parity and diagnostic privacy: OK');
