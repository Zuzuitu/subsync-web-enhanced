'use strict';

const WINDOW_SECONDS = 15;
const PRIMARY_WINDOWS = 16;
const RESCUE_WINDOW_SECONDS = 30;
const RESCUE_WINDOWS = 4;
const MAX_WINDOWS = PRIMARY_WINDOWS + RESCUE_WINDOWS;
const FULL_SCAN_SECONDS = WINDOW_SECONDS * PRIMARY_WINDOWS;
const MAX_SPARSE_AUDIO_SECONDS =
  FULL_SCAN_SECONDS + RESCUE_WINDOW_SECONDS * RESCUE_WINDOWS;
const MIN_RESCUE_WINDOW_SECONDS = 15;

function farthestFirstOrder(count) {
  if (count <= 0) return [];

  const selected = [0];
  const remaining = new Set(Array.from({ length: count }, (_, i) => i).slice(1));

  if (count > 1) {
    selected.push(count - 1);
    remaining.delete(count - 1);
  }

  while (remaining.size) {
    let bestIndex = null;
    let bestDistance = -1;

    for (const candidate of remaining) {
      const distance = Math.min(...selected.map(index => Math.abs(candidate - index)));
      if (
        distance > bestDistance
        || (distance === bestDistance && (bestIndex == null || candidate < bestIndex))
      ) {
        bestIndex = candidate;
        bestDistance = distance;
      }
    }

    selected.push(bestIndex);
    remaining.delete(bestIndex);
  }

  return selected;
}

function centeredWindow(start, end, maxLength = WINDOW_SECONDS) {
  const gap = end - start;
  if (!Number.isFinite(gap) || gap < MIN_RESCUE_WINDOW_SECONDS) {
    return null;
  }

  const length = Math.min(maxLength, gap);
  const center = (start + end) / 2;
  const windowStart = Math.max(start, center - length / 2);
  return [windowStart, windowStart + length];
}

function makePrimaryWindows(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration <= FULL_SCAN_SECONDS) {
    return null;
  }

  const bucket = duration / PRIMARY_WINDOWS;
  const chronological = [];
  for (let i = 0; i < PRIMARY_WINDOWS; i++) {
    const center = (i + 0.5) * bucket;
    let start = Math.max(0, center - WINDOW_SECONDS / 2);
    let end = Math.min(duration, start + WINDOW_SECONDS);
    start = Math.max(0, end - WINDOW_SECONDS);
    chronological.push([start, end]);
  }

  return farthestFirstOrder(PRIMARY_WINDOWS).map(index => chronological[index]);
}

function summaryEvidence(window, summaries) {
  const match = (summaries || []).find(summary =>
    Math.abs((Number(summary.start) || 0) - window[0]) < 0.05
    && Math.abs((Number(summary.end) || 0) - window[1]) < 0.05
  );
  return {
    words: match ? Number(match.wordCount) || 0 : 0,
    pointGain: match ? Number(match.candidatePointGain) || 0 : 0,
  };
}

function evidencePriority(evidence) {
  // Unique synchronization-bucket gain is the scarce signal on the physical
  // reproduction. Speech volume only breaks ties between equally useful probes.
  return evidence.pointGain * 1000 + evidence.words;
}

function makeGapCandidate(duration, gap, left, right, summaries) {
  const gapLength = gap[1] - gap[0];
  if (gapLength < MIN_RESCUE_WINDOW_SECONDS) {
    return null;
  }

  const length = Math.min(RESCUE_WINDOW_SECONDS, gapLength);
  const leftEvidence = left ? summaryEvidence(left, summaries) : { words: 0, pointGain: 0 };
  const rightEvidence = right ? summaryEvidence(right, summaries) : { words: 0, pointGain: 0 };
  const leftPriority = evidencePriority(leftEvidence);
  const rightPriority = evidencePriority(rightEvidence);

  let start;
  if (leftPriority > rightPriority) {
    // Continue immediately after the primary probe that contributed stronger
    // matching evidence (point gain first, speech volume second).
    start = gap[0];
  } else if (rightPriority > leftPriority) {
    // Capture the lead-in immediately before the stronger matching probe.
    start = gap[1] - length;
  } else {
    start = gap[0] + (gapLength - length) / 2;
  }

  const end = start + length;
  const center = (start + end) / 2;
  return {
    window: [start, end],
    score: leftPriority + rightPriority,
    pointGain: leftEvidence.pointGain + rightEvidence.pointGain,
    words: leftEvidence.words + rightEvidence.words,
    quarter: Math.min(3, Math.max(0, Math.floor(4 * center / duration))),
  };
}

function makeRescueWindows(duration, primaryWindows, primarySummaries = []) {
  if (
    !Number.isFinite(duration)
    || duration <= FULL_SCAN_SECONDS
    || !primaryWindows
    || !primaryWindows.length
  ) {
    return [];
  }

  const chronological = primaryWindows.slice().sort((a, b) => a[0] - b[0]);
  const candidates = [];

  let cursor = 0;
  let left = null;
  for (const right of chronological) {
    if (right[0] > cursor) {
      const candidate = makeGapCandidate(
        duration,
        [cursor, right[0]],
        left,
        right,
        primarySummaries
      );
      if (candidate) candidates.push(candidate);
    }
    cursor = Math.max(cursor, right[1]);
    left = right;
  }

  if (cursor < duration) {
    const candidate = makeGapCandidate(
      duration,
      [cursor, duration],
      left,
      null,
      primarySummaries
    );
    if (candidate) candidates.push(candidate);
  }

  // Prefer actual matching evidence (candidate point gain first, recognized
  // speech second), but keep one candidate per timeline quarter before filling
  // spare slots. This prevents one locally easy scene from consuming the entire
  // rescue budget.
  const selected = [];
  const used = new Set();
  for (let quarter = 0; quarter < 4 && selected.length < RESCUE_WINDOWS; quarter++) {
    let bestIndex = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i) || candidates[i].quarter !== quarter) continue;
      if (
        bestIndex < 0
        || candidates[i].score > candidates[bestIndex].score
      ) {
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      selected.push(candidates[bestIndex]);
    }
  }

  const remaining = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(item => !used.has(item.index))
    .sort((a, b) =>
      b.candidate.score - a.candidate.score
      || a.candidate.window[0] - b.candidate.window[0]
    );

  for (const item of remaining) {
    if (selected.length >= RESCUE_WINDOWS) break;
    selected.push(item.candidate);
  }

  const chronologicalSelected = selected
    .slice()
    .sort((a, b) => a.window[0] - b.window[0]);

  // Probe broad temporal coverage first; each selected location was already
  // chosen using observed primary speech density.
  return farthestFirstOrder(chronologicalSelected.length)
    .map(index => chronologicalSelected[index].window);
}

function makeRomanianTimeWindows(duration, primarySummaries = []) {
  const primary = makePrimaryWindows(duration);
  if (!primary) return null;
  return primary.concat(makeRescueWindows(duration, primary, primarySummaries));
}

module.exports = {
  WINDOW_SECONDS,
  PRIMARY_WINDOWS,
  RESCUE_WINDOW_SECONDS,
  RESCUE_WINDOWS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  MAX_SPARSE_AUDIO_SECONDS,
  MIN_RESCUE_WINDOW_SECONDS,
  farthestFirstOrder,
  centeredWindow,
  summaryEvidence,
  evidencePriority,
  makePrimaryWindows,
  makeRescueWindows,
  makeRomanianTimeWindows,
};
