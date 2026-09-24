'use strict';

// This is a post-lock precision candidate. The native sc0ty correlation and
// its acceptance thresholds are deliberately untouched.
const MAX_INLIER_RESIDUAL_SECONDS = 1.25;
const MIN_INLIER_BUCKET_SHARE = 0.75;
const MIN_MEDIAN_GAIN_SECONDS = 0.1;
const MIN_INLIER_BUCKETS = 20;

function median(values) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fit(points) {
  const n = points.length;
  if (n < 2) return null;
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - centerX) * (point.y - centerY);
    variance += (point.x - centerX) ** 2;
  }
  if (variance <= 0) return null;
  const a = covariance / variance;
  const b = centerY - a * centerX;
  return Number.isFinite(a) && a > 0 && Number.isFinite(b) ? { a, b } : null;
}

function mappedDelta(first, second, end) {
  return Math.max(
    Math.abs(first.b - second.b),
    Math.abs((first.a - second.a) * end + first.b - second.b)
  );
}

function medianResidual(points, formula) {
  return median(points.map(point => Math.abs(point.y - formula.a * point.x - formula.b)));
}

function robustRetainedRefinement(precision, canonical, existing, events, duration,
  maxMappedDelta, minThirdShare) {
  const pairs = precision && precision.fitPointTimes;
  if (!Array.isArray(pairs) || pairs.length < MIN_INLIER_BUCKETS || pairs.length > 256
      || !Array.isArray(events) || !Number.isFinite(duration) || duration <= 0
      || !Number.isFinite(canonical.a) || !Number.isFinite(canonical.b)) return null;

  const points = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) return null;
    points.push({ x: pair[0], y: pair[1] });
  }
  const ends = events.map(event => event.end).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ends.length) return null;
  const span = Math.max(...points.map(point => point.x))
    - Math.min(...points.map(point => point.x));
  if (!(span > 0)) return null;

  // Widely separated pairs estimate drift without letting a repeated word in
  // one line determine the slope. Medians tolerate conflicting matches.
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (Math.abs(dx) >= span * 0.1) {
        slopes.push((points[j].y - points[i].y) / dx);
      }
    }
  }
  const pilotA = median(slopes);
  if (!Number.isFinite(pilotA) || pilotA <= 0) return null;
  const pilotB = median(points.map(point => point.y - pilotA * point.x));

  const groups = new Map();
  for (const point of points) {
    if (Math.abs(point.y - pilotA * point.x - pilotB) > MAX_INLIER_RESIDUAL_SECONDS) {
      continue;
    }
    const index = ends.findIndex(end => end >= point.x);
    if (index < 0) return null;
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(point);
  }
  const minBuckets = Math.max(MIN_INLIER_BUCKETS,
    Math.ceil(Number(precision.buckets) * MIN_INLIER_BUCKET_SHARE));
  if (groups.size < minBuckets) return null;

  const counts = [0, 0, 0];
  const balanced = [];
  for (const group of groups.values()) {
    const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
    const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
    balanced.push({ x, y });
    counts[Math.min(2, Math.max(0, Math.floor(3 * y / duration)))]++;
  }
  if (Math.min(...counts) / balanced.length < minThirdShare) return null;
  const fitted = fit(balanced);
  if (!fitted) return null;

  // Preserve the existing 0.75 s formula-stability guard over the entire
  // title. Clamping toward the candidate is safer than enlarging that guard.
  const end = Math.max(duration, ends[ends.length - 1]);
  const delta = mappedDelta(canonical, fitted, end);
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const share = Math.min(1, maxMappedDelta / delta);
  const formula = {
    a: canonical.a + share * (fitted.a - canonical.a),
    b: canonical.b + share * (fitted.b - canonical.b),
  };
  const baseline = existing || canonical;
  if (medianResidual(points, baseline) - medianResidual(points, formula)
      < MIN_MEDIAN_GAIN_SECONDS) return null;

  return { formula, mappedDeltaSeconds: mappedDelta(canonical, formula, end),
    inlierBuckets: groups.size, inlierPoints: [...groups.values()].reduce((n, group) => n + group.length, 0) };
}

module.exports = { robustRetainedRefinement };
