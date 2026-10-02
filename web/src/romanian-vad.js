'use strict';

// Lightweight, local voice-activity evidence collected from the PCM already
// decoded for Romanian Whisper. It is deliberately a timing aid, not a second
// speech recognizer: subtitles provide the expected speech occupancy and the
// PCM energy provides the audio-side signal.
const ACTIVITY_BIN_SECONDS = 0.25;
const INITIAL_SEARCH_STEP_SECONDS = 1;
const REFINE_SEARCH_STEP_SECONDS = 0.125;
const DEFAULT_SEARCH_RADIUS_SECONDS = 180;
const DEFAULT_SEARCH_LIMIT_SECONDS = 1800;
const MIN_ACTIVITY_SAMPLES = 24;
const MIN_THIRD_SAMPLES = 4;
const MAX_ACCEPTED_VAD_RESIDUAL_SECONDS = 1.5;
const MIN_ACCEPTED_VAD_SCORE = 0.45;
const MAX_ACCEPTED_VAD_SPREAD_SECONDS = 1.25;

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function normaliseSamples(samples) {
  if (!Array.isArray(samples)) return [];
  return samples
    .map(sample => ({
      time: Number(sample && sample.time),
      energy: Math.max(0, Number(sample && sample.energy) || 0),
    }))
    .filter(sample => finite(sample.time) && finite(sample.energy))
    .sort((a, b) => a.time - b.time);
}

function subtitleOccupancy(events, time) {
  const list = events || [];
  let low = 0;
  let high = list.length;
  // Subtitle events arrive chronologically. Find the last cue beginning at
  // or before the requested time, then inspect only that cue and any directly
  // overlapping cue. This avoids scanning hundreds of cues for every offset.
  while (low < high) {
    const middle = (low + high) >> 1;
    const start = Number(list[middle] && list[middle].start);
    if (finite(start) && start <= time) low = middle + 1;
    else high = middle;
  }
  for (let index = Math.max(0, low - 1); index >= 0; index--) {
    const event = list[index];
    const start = Number(event && event.start);
    const end = Number(event && event.end);
    if (!finite(start) || !finite(end)) continue;
    if (start <= time && time <= end) return 1;
    if (end < time - 0.001) break;
  }
  return 0;
}

function correlationScore(samples, events, offset, factor = 1) {
  if (!samples.length) return -Infinity;
  const values = samples.map(sample => ({
    x: sample.energy,
    y: subtitleOccupancy(events, (sample.time - offset) / factor),
  }));
  const meanX = values.reduce((sum, value) => sum + value.x, 0) / values.length;
  const meanY = values.reduce((sum, value) => sum + value.y, 0) / values.length;
  let numerator = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const value of values) {
    const dx = value.x - meanX;
    const dy = value.y - meanY;
    numerator += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX <= 0 || varianceY <= 0) return -Infinity;
  return numerator / Math.sqrt(varianceX * varianceY);
}

function searchOffset(samples, events, center, radius, step, factor = 1) {
  let best = null;
  const start = center - radius;
  const end = center + radius;
  for (let offset = start; offset <= end + step / 2; offset += step) {
    const score = correlationScore(samples, events, offset, factor);
    if (!best || score > best.score) {
      best = { offset, score };
    }
  }
  return best;
}

function pickOffset(samples, events, hint = null) {
  const center = finite(hint && hint.b) ? Number(hint.b) : 0;
  const hasHint = finite(hint && hint.b);
  const radius = hasHint
    ? Math.min(DEFAULT_SEARCH_RADIUS_SECONDS, Math.max(20, Math.abs(center) * 0.25 + 20))
    : DEFAULT_SEARCH_LIMIT_SECONDS;
  const coarseStep = radius >= 300 ? 4 : INITIAL_SEARCH_STEP_SECONDS;
  let coarse = searchOffset(samples, events, center, radius, coarseStep);
  if (hasHint && !(hint && hint.noGlobal)) {
    // A provisional lexical line can be a local false positive. A cheap,
    // coarse global pass keeps VAD from inheriting that mistake while the
    // local pass preserves precision when the hint is already trustworthy.
    const global = searchOffset(
      samples,
      events,
      0,
      DEFAULT_SEARCH_LIMIT_SECONDS,
      8
    );
    if (global && (!coarse || global.score > coarse.score)) coarse = global;
  }
  if (!coarse || !finite(coarse.offset)) return null;
  const refined = searchOffset(
    samples,
    events,
    coarse.offset,
    Math.max(1, coarseStep * 2),
    REFINE_SEARCH_STEP_SECONDS
  );
  if (!refined || !finite(refined.offset)) return coarse;
  return { ...refined, coarseOffset: coarse.offset, coarseScore: coarse.score };
}

function thirdSamples(samples, duration, third) {
  const start = duration * third / 3;
  const end = duration * (third + 1) / 3;
  return samples.filter(sample => sample.time >= start && sample.time < end);
}

function estimateRomanianVadCorrection(activity, events, duration, hint = null) {
  const samples = normaliseSamples(activity);
  if (!finite(duration) || duration <= 0 || samples.length < MIN_ACTIVITY_SAMPLES) {
    return null;
  }
  const global = pickOffset(samples, events, hint);
  if (!global || !finite(global.score)) return null;

  const thirds = [];
  for (let third = 0; third < 3; third++) {
    const part = thirdSamples(samples, duration, third);
    if (part.length < MIN_THIRD_SAMPLES) continue;
    const estimate = pickOffset(part, events, { b: global.offset, noGlobal: true });
    if (estimate && finite(estimate.offset) && finite(estimate.score)) {
      thirds.push({ third, samples: part.length, ...estimate });
    }
  }
  if (thirds.length < 2) return null;

  const maxResidual = Math.max(...thirds.map(item =>
    Math.abs(item.offset - global.offset)
  ));
  const coverageThirds = thirds.map(item => item.third);
  const spread = Math.max(...thirds.map(item => item.offset))
    - Math.min(...thirds.map(item => item.offset));
  if (maxResidual > MAX_ACCEPTED_VAD_RESIDUAL_SECONDS) return null;

  // Fit offset(x) = (a - 1) * x + b. The slope is kept conservative: a VAD
  // onset is less exact than a lexical timestamp, so only the offset is used
  // unless all three title thirds agree tightly.
  // VAD boundaries are intentionally less precise than lexical timestamps.
  // Use the median third offset as a stable translation and leave slope/drift
  // to the lexical correlator; fitting a slope to three noisy speech regions
  // would amplify a harmless boundary bias over a feature-length title.
  const sortedOffsets = thirds.map(item => item.offset).sort((a, b) => a - b);
  const intercept = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
  const factor = 1;

  return {
    factor,
    offset: intercept,
    score: global.score,
    coarseScore: global.coarseScore,
    sampleCount: samples.length,
    thirdCount: thirds.length,
    coveredThirds: coverageThirds,
    thirds,
    spread,
  };
}

function isReliableRomanianVad(correction) {
  return Boolean(
    correction
    && finite(correction.score)
    && correction.score >= MIN_ACCEPTED_VAD_SCORE
    && Number(correction.thirdCount) === 3
    && finite(correction.spread)
    && correction.spread <= MAX_ACCEPTED_VAD_SPREAD_SECONDS
  );
}

module.exports = {
  ACTIVITY_BIN_SECONDS,
  MIN_ACCEPTED_VAD_SCORE,
  MAX_ACCEPTED_VAD_SPREAD_SECONDS,
  MIN_ACTIVITY_SAMPLES,
  correlationScore,
  estimateRomanianVadCorrection,
  isReliableRomanianVad,
  pickOffset,
  normaliseSamples,
  subtitleOccupancy,
};
