'use strict';

// Experimental, NOT connected to the runtime, save policy or SRT exporter.
// Input MUST be independently checked one-to-one cue correspondences, NOT
// raw lexicon matches or points retained around a globally accepted line.
const MIN_PER_SIDE = 8;
const MIN_GROUP_DURATION_RATIO = 0.1;
const MIN_STEP_SECONDS = 1;
const MAX_LOCAL_MAD_SECONDS = 0.25;
const MAX_HELDOUT_DELTA_SECONDS = 0.4;
const STEP_TO_LINEAR_SSE_MAX = 0.25;

function median(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  const n = ordered.length;
  if (!n) return null;
  return n % 2 ? ordered[n >> 1] : 0.5 * (ordered[(n >> 1)-1] + ordered[n >> 1]);
}
function mad(values) {
  const center = median(values);
  return center === null ? null : median(values.map(v => Math.abs(v - center)));
}
function regress(points) {
  const n = points.length;
  const mx = points.reduce((s, x) => s + x.time, 0) / n;
  const my = points.reduce((s, x) => s + x.residual, 0) / n;
  let covariance = 0, variance = 0;
  for (const p of points) {
    covariance += (p.time - mx) * (p.residual - my);
    variance += (p.time - mx) ** 2;
  }
  const slope = variance > 0 ? covariance / variance : 0;
  return {intercept: my - slope * mx, slope};
}
function sse(points, predict) {
  return points.reduce((sum, p) => sum + (p.residual - predict(p)) ** 2, 0);
}

function studyIndependentStep(input) {
  const unavailable = reason => ({
    schemaVersion: 1, researchOnly: true, supported: false, verdict: 'insufficient-evidence', reason
  });
  if (!input || input.provenance !== 'independently-verified-cue-pairs') {
    return unavailable('independent-provenance-required');
  }
  const {anchors, formula, durationSeconds} = input;
  if (!formula || !Number.isFinite(formula.a) || formula.a <= 0
      || !Number.isFinite(formula.b) || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0) return unavailable('invalid-context');
  if (!Array.isArray(anchors) || anchors.length < 2 * MIN_PER_SIDE
      || anchors.length > 256) return unavailable('insufficient-or-unbounded-anchors');
  const ids = new Set();
  const points = [];
  for (const a of anchors) {
    if (!a || a.independentlyVerified !== true
        || !(typeof a.cueId === 'string' || Number.isInteger(a.cueId))
        || !Number.isFinite(a.subtitleTime) || !Number.isFinite(a.referenceTime)
        || a.subtitleTime < 0 || a.referenceTime < 0
        || a.referenceTime > durationSeconds) return unavailable('invalid-anchor');
    const id = String(a.cueId);
    if (ids.has(id)) return unavailable('duplicate-cue-provenance');
    ids.add(id);
    points.push({
      time: a.subtitleTime,
      referenceTime: a.referenceTime,
      residual: a.referenceTime - (formula.a * a.subtitleTime + formula.b)
    });
  }
  points.sort((a, b) => a.time - b.time);
  if (points.some((p, i) => !Number.isFinite(p.residual)
      || (i && p.time <= points[i - 1].time))) return unavailable('unordered-or-nonfinite-evidence');

  let best = null;
  // Held-out anchors are never used to choose the group offsets.
  for (let split = MIN_PER_SIDE; split <= points.length - MIN_PER_SIDE; split++) {
    const left = points.slice(0, split), right = points.slice(split);
    if (left[left.length-1].time - left[0].time < MIN_GROUP_DURATION_RATIO * durationSeconds
        || right[right.length-1].time - right[0].time < MIN_GROUP_DURATION_RATIO * durationSeconds) continue;
    const aTrain = left.filter((_, i) => i % 2 === 0);
    const aHold = left.filter((_, i) => i % 2 === 1);
    const bTrain = right.filter((_, i) => i % 2 === 0);
    const bHold = right.filter((_, i) => i % 2 === 1);
    if ([aTrain, aHold, bTrain, bHold].some(group => group.length < 4)) continue;
    const offA = median(aTrain.map(p => p.residual));
    const offB = median(bTrain.map(p => p.residual));
    if (Math.abs(offB - offA) < MIN_STEP_SECONDS
        || mad(aTrain.map(p => p.residual)) > MAX_LOCAL_MAD_SECONDS
        || mad(bTrain.map(p => p.residual)) > MAX_LOCAL_MAD_SECONDS) continue;
    if (Math.abs(median(aHold.map(p => p.residual)) - offA) > MAX_HELDOUT_DELTA_SECONDS
        || Math.abs(median(bHold.map(p => p.residual)) - offB) > MAX_HELDOUT_DELTA_SECONDS) continue;
    const training = [...aTrain, ...bTrain];
    const test = [...aHold, ...bHold];
    const trend = regress(training);
    const linearSSE = sse(test, p => trend.intercept + trend.slope * p.time);
    const stepSSE = sse(aHold, () => offA) + sse(bHold, () => offB);
    if (linearSSE <= 0 || stepSSE > STEP_TO_LINEAR_SSE_MAX * linearSSE) continue;
    const candidate = {
      schemaVersion: 1, researchOnly: true, supported: true,
      verdict: 'possible-offset-step-not-a-confirmed-cut',
      beforeAnchors: left.length, afterAnchors: right.length,
      boundarySubtitleTimeFrom: left[left.length-1].time,
      boundarySubtitleTimeTo: right[0].time,
      residualStepSeconds: offB - offA,
      heldoutStepSSE: stepSSE, heldoutAffineSSE: linearSSE,
      interpretation: 'Independent verified cue-pair hypothesis only. No automatic correction, edition verdict, or Save eligibility change.'
    };
    if (!best || candidate.heldoutStepSSE < best.heldoutStepSSE) best = candidate;
  }
  return best || unavailable('no-independently-supported-step');
}
module.exports = {studyIndependentStep};
