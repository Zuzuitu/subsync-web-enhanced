'use strict';

// Read-only diagnostic for retained canonical fit points. Each coordinate is
// [subtitle time, reference audio time], NOT independently verified ground truth.
// The inlier set cannot reveal all false matches or establish an edition cut.
function reviewCorrelationEvidence(status, referenceDuration) {
  const base = {
    schemaVersion: 1,
    available: false,
    source: 'canonical-retained-inliers',
    interpretation: 'Fit evidence and temporal coverage, not measured subtitle accuracy or proof of a cut.',
  };
  const precision = status && status.precision;
  if (!status || status.correlated !== true || status.correlationSource === 'romanian-vad') {
    return {...base, reason: 'no-canonical-lock'};
  }
  if (!Number.isFinite(referenceDuration) || referenceDuration <= 0) {
    return {...base, reason: 'reference-duration-unavailable'};
  }
  if (!precision || precision.fitPointTimesTruncated === true) {
    return {...base, reason: precision ? 'point-coordinates-truncated' : 'point-coordinates-unavailable'};
  }
  const points = precision.fitPointTimes;
  // Existing WASM diagnostic transport is capped at 256 pairs. Never treat
  // a truncated, malformed, or partial collection as whole-title evidence.
  if (!Array.isArray(points) || !points.length || points.length > 256
      || !points.every(pair => Array.isArray(pair) && pair.length === 2
        && pair.every(Number.isFinite))) {
    return {...base, reason: 'point-coordinates-unavailable'};
  }
  if (Number.isFinite(precision.rawPoints) && precision.rawPoints !== points.length) {
    return {...base, reason: 'incomplete-point-coordinates'};
  }
  const formula = status.canonicalFormula || status.formula;
  if (!formula || !Number.isFinite(formula.a) || formula.a <= 0
      || !Number.isFinite(formula.b)) {
    return {...base, reason: 'canonical-formula-unavailable'};
  }
  if (!points.every(pair => pair[1] >= 0 && pair[1] <= referenceDuration)) {
    return {...base, reason: 'points-outside-reference'};
  }
  const times = points.map(pair => pair[1]).sort((a, b) => a - b);
  const thirds = [0, 0, 0];
  for (const time of times) {
    thirds[Math.min(2, Math.floor(3 * time / referenceDuration))]++;
  }
  const gaps = [times[0]];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.push(referenceDuration - times[times.length - 1]);
  const residuals = points.map(pair => Math.abs(pair[1] - (formula.a * pair[0] + formula.b)))
    .sort((a, b) => a - b);
  if (!residuals.every(Number.isFinite)) {
    return {...base, reason: 'nonfinite-fit-residual'};
  }
  const mid = Math.floor(residuals.length / 2);
  const median = residuals.length % 2 ? residuals[mid]
    : (residuals[mid - 1] + residuals[mid]) / 2;
  return {
    ...base,
    available: true,
    retainedPointCount: points.length,
    cueBucketCount: Number.isSafeInteger(precision.buckets) && precision.buckets >= 0
      ? precision.buckets : null,
    referenceDurationSeconds: referenceDuration,
    beginningPointCount: thirds[0],
    middlePointCount: thirds[1],
    finalPointCount: thirds[2],
    pointSpanSeconds: times[times.length - 1] - times[0],
    largestUnobservedGapSeconds: Math.max(...gaps),
    medianAbsFitResidualSeconds: median,
    maxAbsFitResidualSeconds: residuals[residuals.length - 1],
    falseMatchAssessment: 'not-measured',
    cutAssessment: 'not-measured',
  };
}

module.exports = { reviewCorrelationEvidence };
