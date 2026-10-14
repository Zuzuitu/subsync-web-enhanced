'use strict';

// A bounded post-lock proposal, verified against whole unseen audio probes.
// This never accepts a title, requests audio, or reads an Original subtitle.
const { correlationScore, occupancyIntervals, ACTIVITY_BIN_SECONDS,
  MIN_ACCEPTED_VAD_SCORE } = require('./romanian-vad.js');
const { MAX_FORMULA_DELTA_SECONDS } = require('./romanian-convergence.js');
const STEP = ACTIVITY_BIN_SECONDS / 2;
const MIN_VALIDATION_GAIN = .02;
const MIN_GLOBAL_GAIN = .04;
const THIRD_LOSS_TOLERANCE = .005;
const MIN_PROBE_SAMPLES = 16;

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validFormula(value) {
  return value && Number.isFinite(value.a) && value.a > 0 && Number.isFinite(value.b);
}

function mappedDelta(first, second, end) {
  return Math.max(Math.abs(first.b - second.b),
    Math.abs((first.a - second.a) * end + first.b - second.b));
}

function residual(points, formula) {
  return median(points.map(point => Math.abs(point[1] - formula.a * point[0] - formula.b)));
}

function voicePrecisionRefinement(voice, events, duration, canonical, existing, pairs, maxDelta) {
  if (!voice || !validFormula(canonical) || !validFormula(existing)
      || !Number.isFinite(duration) || duration <= 0
      || !Number.isFinite(maxDelta) || maxDelta <= 0 || maxDelta > MAX_FORMULA_DELTA_SECONDS
      || !Array.isArray(events) || !Array.isArray(voice.activity) || voice.activity.length > 1800
      || !Array.isArray(voice.windows) || voice.windows.length < 9 || voice.windows.length > 64
      || !Array.isArray(pairs) || pairs.length < 20 || pairs.length > 256
      || !pairs.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite))) return null;

  const samples = voice.activity;
  if (!samples.every(sample => sample && Number.isFinite(sample.time)
      && Number.isFinite(sample.energy) && sample.energy >= 0 && sample.energy <= 1)) return null;
  if (!voice.windows.every(window => Array.isArray(window) && window.length === 2
      && window.every(Number.isFinite) && window[0] >= 0 && window[1] > window[0])) return null;
  const windows = voice.windows.slice().sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < windows.length; i++) {
    // Overlapping probes would leak the same PCM into training and validation.
    if (windows[i][0] < windows[i - 1][1] - 1e-6) return null;
  }
  const parts = windows.map(window => samples.filter(sample =>
    sample.time >= window[0] && sample.time < window[1]));
  if (parts.some(part => part.length < MIN_PROBE_SAMPLES)
      || parts.reduce((sum, part) => sum + part.length, 0) !== samples.length) return null;
  const byThird = [[], [], []];
  windows.forEach((window, index) => byThird[Math.min(2,
    Math.floor(3 * (window[0] + window[1]) / 2 / duration))].push(index));
  if (byThird.some(indices => indices.length < 3)) return null;

  const intervals = occupancyIntervals(events);
  if (!intervals.length) return null;
  const end = Math.max(duration, intervals[intervals.length - 1].end);
  const score = (part, formula) => correlationScore(part, intervals, formula.b, formula.a);
  const candidates = [];
  const steps = Math.floor(maxDelta / STEP);
  // Search endpoint changes, so every candidate obeys the existing whole-title
  // 0.75-second canonical stability guard. Genuine drift is retained when it
  // predicts speech better; a factor of 1 is never imposed.
  for (let first = -steps; first <= steps; first++) {
    for (let last = -steps; last <= steps; last++) {
      const formula = { a: canonical.a + STEP * (last - first) / end,
        b: canonical.b + STEP * first };
      if (validFormula(formula)) candidates.push(formula);
    }
  }
  const fits = [];
  const validationGains = [];
  const thirdGains = [];
  for (let fold = 0; fold < 3; fold++) {
    // In every title third, each probe is unseen in one fold and used only for
    // training in the other two. Adjacent correlated bins stay together.
    const held = new Set(byThird.flatMap(indices => indices.filter((_, index) => index % 3 === fold)));
    const training = parts.filter((_, index) => !held.has(index)).flat();
    const validation = parts.filter((_, index) => held.has(index)).flat();
    let best;
    for (const formula of candidates) {
      const value = score(training, formula);
      if (!Number.isFinite(value)) continue;
      if (!best || value > best.score + 1e-12
          || (Math.abs(value - best.score) <= 1e-12
            && mappedDelta(formula, existing, end) < mappedDelta(best.formula, existing, end))) {
        best = { formula, score: value };
      }
    }
    if (!best) return null;
    const validationScore = score(validation, best.formula);
    const gain = validationScore - score(validation, existing);
    if (!Number.isFinite(gain) || validationScore < MIN_ACCEPTED_VAD_SCORE
        || gain < MIN_VALIDATION_GAIN) return null;
    validationGains.push(gain);
    for (let third = 0; third < 3; third++) {
      const part = byThird[third].filter(index => held.has(index)).flatMap(index => parts[index]);
      const value = score(part, best.formula);
      const regionalGain = value - score(part, existing);
      if (!Number.isFinite(regionalGain) || value < MIN_ACCEPTED_VAD_SCORE
          || regionalGain < -THIRD_LOSS_TOLERANCE) return null;
      thirdGains.push(regionalGain);
    }
    fits.push(best.formula);
  }
  const spread = Math.max(...fits.flatMap((first, index) =>
    fits.slice(index + 1).map(second => mappedDelta(first, second, end))));
  if (spread > ACTIVITY_BIN_SECONDS) return null;
  const formula = { a: median(fits.map(fit => fit.a)), b: median(fits.map(fit => fit.b)) };
  const value = score(samples, formula);
  const gain = value - score(samples, existing);
  const delta = mappedDelta(canonical, formula, end);
  if (!Number.isFinite(gain) || gain < MIN_GLOBAL_GAIN || delta > maxDelta + 1e-9
      || residual(pairs, formula) - residual(pairs, existing) > ACTIVITY_BIN_SECONDS) return null;
  return { formula, mappedDeltaSeconds: delta, voiceScore: value, voiceScoreGain: gain,
    voiceMinimumValidationGain: Math.min(...validationGains),
    voiceMinimumThirdGain: Math.min(...thirdGains), voiceValidationFolds: 3,
    voiceValidationSpread: spread, voiceProbeCount: windows.length, voiceSampleCount: samples.length };
}

module.exports = { voicePrecisionRefinement };
