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
  // A pair of independently verified correspondences must not time-travel in
  // the reference edition. Reordered cue histories cannot prove a clean cut.
  if (points.some((p, i) => i && p.referenceTime <= points[i - 1].referenceTime)) {
    return unavailable('nonmonotonic-reference-evidence');
  }

  // Globally reserve every second anchor before selecting any boundary. The
  // held-out anchors are not inspected to choose the candidate hypothesis.
  const training = points.filter((_, index) => index % 2 === 0);
  const heldout = points.filter((_, index) => index % 2 === 1);
  const trend = regress(training);
  const trainingAffineSSE = sse(training, p => trend.intercept + trend.slope * p.time);
  if (trainingAffineSSE <= 0) return unavailable('no-independently-supported-step');
  let best = null;
  for (let split = 4; split <= training.length - 4; split++) {
    const aTrain = training.slice(0, split);
    const bTrain = training.slice(split);
    if (aTrain[aTrain.length - 1].time - aTrain[0].time
        < MIN_GROUP_DURATION_RATIO * durationSeconds
        || bTrain[bTrain.length - 1].time - bTrain[0].time
        < MIN_GROUP_DURATION_RATIO * durationSeconds) continue;
    const offA = median(aTrain.map(p => p.residual));
    const offB = median(bTrain.map(p => p.residual));
    if (Math.abs(offB - offA) < MIN_STEP_SECONDS
        || mad(aTrain.map(p => p.residual)) > MAX_LOCAL_MAD_SECONDS
        || mad(bTrain.map(p => p.residual)) > MAX_LOCAL_MAD_SECONDS) continue;
    const trainStepSSE = sse(aTrain, () => offA) + sse(bTrain, () => offB);
    if (trainStepSSE > STEP_TO_LINEAR_SSE_MAX * trainingAffineSSE) continue;
    const score = trainStepSSE / trainingAffineSSE;
    if (!best || score < best.score) {
      best = {
        score, offA, offB,
        boundaryFrom: aTrain[aTrain.length - 1].time,
        boundaryTo: bTrain[0].time
      };
    }
  }
  if (!best) return unavailable('no-independently-supported-step');

  // The training set identifies a BRACKET, not an exact cut cue. A fixed
  // midpoint divides the fully untouched holdout exactly once. Do not search
  // splits, fit offsets, or prefer candidates using this held-out evidence.
  const boundary = (best.boundaryFrom + best.boundaryTo) / 2;
  const aHold = heldout.filter(p => p.time <= boundary);
  const bHold = heldout.filter(p => p.time > boundary);
  if (aHold.length < 4 || bHold.length < 4) return unavailable('insufficient-independent-holdout');
  if (Math.abs(median(aHold.map(p => p.residual)) - best.offA) > MAX_HELDOUT_DELTA_SECONDS
      || Math.abs(median(bHold.map(p => p.residual)) - best.offB) > MAX_HELDOUT_DELTA_SECONDS) {
    return unavailable('holdout-offset-disagrees');
  }
  const heldoutLinearSSE = sse(heldout, p => trend.intercept + trend.slope * p.time);
  const heldoutStepSSE = sse(aHold, () => best.offA) + sse(bHold, () => best.offB);
  if (!(heldoutLinearSSE > 0)
      || heldoutStepSSE > STEP_TO_LINEAR_SSE_MAX * heldoutLinearSSE) {
    return unavailable('holdout-linear-model-not-rejected');
  }
  return {
    schemaVersion: 1,
    researchOnly: true,
    supported: true,
    verdict: 'possible-offset-step-not-a-confirmed-cut',
    beforeAnchors: points.filter(p => p.time <= boundary).length,
    afterAnchors: points.filter(p => p.time > boundary).length,
    boundarySubtitleTimeFrom: best.boundaryFrom,
    boundarySubtitleTimeTo: best.boundaryTo,
    residualStepSeconds: best.offB - best.offA,
    heldoutStepSSE,
    heldoutAffineSSE: heldoutLinearSSE,
    interpretation: 'Laboratory hypothesis only; caller-asserted independent cue pairs are not authenticated. No automatic correction, cut verdict or Save eligibility change.'
  };
}
module.exports = {studyIndependentStep};
