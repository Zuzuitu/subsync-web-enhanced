'use strict';

// Read-only summaries of accepted correlator matches, never a substitute for
// independent timing ground truth or evidence of an edition/cut difference.
const MAX_EXPORTED_POINTS = 256;
const BASIS = 'retained-matches-vs-accepted-affine-line';
const INTERPRETATION = 'Matched-word residuals measure agreement with the accepted linear formula, not true SRT timing accuracy. Multiple matches can come from one cue; no cut or correction is inferred.';

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

function summarizeEnRoEvidence(status, durationSeconds) {
  const base = {schemaVersion: 1, basis: BASIS, interpretation: INTERPRETATION};
  const unavailable = reason => ({...base, available: false, reason});
  if (!status || status.correlated !== true) return unavailable('no-canonical-correlation');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return unavailable('reference-duration-unavailable');
  }
  const formula = status.canonicalFormula || status.formula;
  if (!formula || !Number.isFinite(formula.a) || formula.a <= 0
      || !Number.isFinite(formula.b)) return unavailable('invalid-accepted-formula');

  // Candidate coordinates are deliberately not used: they are not accepted
  // correspondences, even if numerically close to a possible alternative line.
  const precision = status.precision || (status.diagnostics && status.diagnostics.precision);
  if (!precision || precision.fitPointTimesTruncated === true) {
    return unavailable(precision ? 'retained-points-truncated' : 'retained-points-unavailable');
  }
  const pairs = precision.fitPointTimes;
  if (!Array.isArray(pairs) || pairs.length < 2 || pairs.length > MAX_EXPORTED_POINTS) {
    return unavailable('insufficient-or-unbounded-points');
  }
  if (!Number.isInteger(precision.rawPoints) || precision.rawPoints !== pairs.length) {
    return unavailable('retained-count-mismatch');
  }
  if (!pairs.every(pair => Array.isArray(pair) && pair.length === 2
      && pair.every(value => typeof value === 'number' && Number.isFinite(value)))) {
    return unavailable('invalid-point-coordinates');
  }

  const thirds = [[], [], []];
  const timeline = [];
  const subtitleTimes = new Set();
  let outsideDurationCount = 0;
  const absoluteErrors = [];
  for (const [subtitleTime, referenceTime] of pairs) {
    if (subtitleTime < 0 || referenceTime < 0) return unavailable('negative-point-coordinate');
    const residual = referenceTime - (formula.a * subtitleTime + formula.b);
    if (!Number.isFinite(residual)) return unavailable('nonfinite-residual');
    absoluteErrors.push(Math.abs(residual));
    subtitleTimes.add(subtitleTime);
    if (referenceTime > durationSeconds) {
      outsideDurationCount++;
      continue;
    }
    const index = Math.min(2, Math.floor(3 * referenceTime / durationSeconds));
    thirds[index].push({subtitleTime, residual});
    timeline.push(referenceTime);
  }
  if (timeline.length < 2) return unavailable('insufficient-in-range-points');
  timeline.sort((a, b) => a - b);
  const edges = [0, ...timeline, durationSeconds];
  let largestGap = 0;
  for (let i = 1; i < edges.length; i++) {
    largestGap = Math.max(largestGap, edges[i] - edges[i - 1]);
  }
  const partitions = thirds.map((points, index) => ({
    third: ['beginning', 'middle', 'end'][index],
    rawMatchCount: points.length,
    distinctSubtitleTimestamps: new Set(points.map(point => point.subtitleTime)).size,
    medianSignedResidualSeconds: median(points.map(point => point.residual)),
    medianAbsoluteResidualSeconds: median(points.map(point => Math.abs(point.residual))),
  }));
  return {
    ...base,
    available: true,
    referenceDurationSeconds: durationSeconds,
    rawMatchCount: pairs.length,
    distinctSubtitleTimestamps: subtitleTimes.size,
    outsideReferenceDurationCount: outsideDurationCount,
    referenceEvidenceSpanSeconds: timeline[timeline.length - 1] - timeline[0],
    referenceEvidenceSpanRatio: (timeline[timeline.length - 1] - timeline[0]) / durationSeconds,
    largestReferenceEvidenceGapSeconds: largestGap,
    medianAbsoluteModelResidualSeconds: median(absoluteErrors),
    thirds: partitions,
  };
}

module.exports = {summarizeEnRoEvidence};
