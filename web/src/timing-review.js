'use strict';

const { isSaveReady } = require('./save-policy.js');

// Read-only projection: use the same endpoint mapping/clamp as subtitle export.
function timingReview(events, formula) {
  let backwardStarts = 0;
  let previous = null;
  const cues = [];
  events.forEach((event, index) => {
    if (!Number.isFinite(event.start) || !Number.isFinite(event.end)
        || event.end < event.start) return;
    if (previous !== null && event.start < previous) backwardStarts++;
    previous = event.start;
    cues.push({ cue: index + 1, start: event.start, end: event.end });
  });
  cues.sort((a, b) => a.start - b.start || a.cue - b.cue);
  const result = {
    cueCount: events.length,
    invalidCues: events.length - cues.length,
    backwardStarts,
    available: false,
    samples: [],
  };
  if (!cues.length || !formula || !Number.isFinite(formula.a)
      || formula.a <= 0 || !Number.isFinite(formula.b)) return result;
  const midpoint = (cues[0].start + cues[cues.length - 1].start) / 2;
  const middle = cues.reduce((best, cue) =>
    Math.abs(cue.start - midpoint) < Math.abs(best.start - midpoint) ? cue : best);
  const positions = [['Beginning', cues[0]], ['Middle', middle], ['End', cues[cues.length - 1]]];
  const seen = new Set();
  for (const [position, cue] of positions) {
    if (seen.has(cue.cue)) continue;
    seen.add(cue.cue);
    const afterStart = Math.max(formula.a * cue.start + formula.b, 0);
    const afterEnd = Math.max(formula.a * cue.end + formula.b, 0);
    if (!Number.isFinite(afterStart) || !Number.isFinite(afterEnd)) return result;
    result.samples.push({ position, cue: cue.cue, beforeStart: cue.start,
      beforeEnd: cue.end, afterStart, afterEnd,
      shiftSeconds: afterStart - cue.start });
  }
  result.available = true;
  return result;
}

// Allowlisted quantitative evidence only: never serialize arbitrary diagnostics,
// errors/stacks, filenames, subtitle text, media bytes or recognized speech.
function numbers(source, keys) {
  const result = {};
  for (const key of keys) {
    const value = source && source[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      result[key] = value;
    }
  }
  return result;
}

function numericEntries(items, keys) {
  if (!Array.isArray(items)) return [];
  return items.map(item => numbers(item, keys));
}

function precisionEvidence(source) {
  const result = numbers(source, [
    'available', 'rawPoints', 'buckets', 'beginningBuckets', 'middleBuckets', 'endBuckets',
    'refinementAvailable', 'refinementFactor', 'refinementMaxDistance',
    'refinementMappedDelta', 'refinementApplied',
    'robustRetainedApplied', 'robustInlierBuckets', 'robustInlierPoints',
    'jackknifeSamples', 'maxMappedDelta', 'medianMappedDelta', 'maxSlopeDeltaPpm', 'maxOffsetDelta',
    'fitPointTimesTruncated',
    'candidateRawPoints', 'candidatePointTimesTruncated',
  ]);
  const times = source && source.fitPointTimes;
  if (Array.isArray(times) && times.length <= 256 && times.every(pair =>
    Array.isArray(pair) && pair.length === 2
    && pair.every(value => typeof value === 'number' && Number.isFinite(value)))) {
    result.fitPointTimes = times.map(pair => [pair[0], pair[1]]);
  }
  const candidate = source && source.candidatePointTimes;
  if (Array.isArray(candidate) && candidate.length <= 256 && candidate.every(pair =>
    Array.isArray(pair) && pair.length === 2
    && pair.every(value => typeof value === 'number' && Number.isFinite(value)))) {
    result.candidatePointTimes = candidate.map(pair => [pair[0], pair[1]]);
  }
  return result;
}

function diagnosticReport(status, review, environment) {
  const diagnostics = status.diagnostics || {};
  return {
    schemaVersion: 1,
    application: 'SubSync2',
    runtime: environment.runtime,
    browser: environment.browser,
    elapsedSeconds: environment.elapsedSeconds,
    outcome: environment.outcome,
    privacy: 'No filenames, subtitle text, recognized words or media included.',
    interpretation: 'Timing changes are not measured accuracy. No cut detection or piecewise correction is applied.',
    saveEligible: isSaveReady(status),
    correlation: numbers(status, ['correlated', 'subReady', 'points', 'factor', 'maxDistance', 'maxChange']),
    formula: numbers(status.formula, ['a', 'b']),
    canonicalFormula: numbers(status.canonicalFormula, ['a', 'b']),
    evidence: numbers(diagnostics, ['subtitles', 'subWords', 'refWords',
      'romanianSubContextAnchors', 'romanianRefContextAnchors']),
    convergence: numbers(diagnostics.romanianConvergence, [
      'verified', 'completedWindows', 'totalWindows', 'primaryWindows',
      'rescueWindowsTotal', 'rescueWindowsCompleted',
      'lateConfirmationWindowsTotal', 'lateConfirmationWindowsCompleted',
      'stableCorrelatedWindows', 'lastWindowWords', 'lastPoints',
      'candidatePointGain', 'candidateProbeCoverageRatio',
      'probeCoverageRatio', 'lastFormulaDeltaSeconds']),
    probeHistory: numericEntries(
      diagnostics.romanianConvergence && diagnostics.romanianConvergence.history,
      [
        'index', 'start', 'end', 'words', 'points', 'correlated',
        'candidatePointGain', 'canonicalPointGain',
        'candidateCoverageRatio', 'canonicalCoverageRatio',
        'stableCorrelatedWindows', 'formulaDeltaSeconds',
        'factor', 'maxDistance',
      ]
    ),
    precision: precisionEvidence(status.precision || diagnostics.precision),
    errorCount: Array.isArray(diagnostics.errors) ? diagnostics.errors.length : 0,
    timingReview: review,
  };
}

module.exports = { timingReview, diagnosticReport };
