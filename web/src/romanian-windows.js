'use strict';

const WINDOW_SECONDS = 15;
const PRIMARY_WINDOWS = 16;
const RESCUE_WINDOWS = 8;
const MAX_WINDOWS = PRIMARY_WINDOWS + RESCUE_WINDOWS;
const FULL_SCAN_SECONDS = WINDOW_SECONDS * PRIMARY_WINDOWS;
const MAX_SPARSE_AUDIO_SECONDS = WINDOW_SECONDS * MAX_WINDOWS;
const MIN_RESCUE_WINDOW_SECONDS = 3;

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

function makeRescueWindows(duration, primaryWindows) {
  const chronological = primaryWindows.slice().sort((a, b) => a[0] - b[0]);
  const gaps = [];

  let cursor = 0;
  for (const [start, end] of chronological) {
    if (start > cursor) {
      gaps.push([cursor, start]);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < duration) {
    gaps.push([cursor, duration]);
  }

  const candidates = gaps
    .map(([start, end]) => centeredWindow(start, end))
    .filter(Boolean);

  const order = farthestFirstOrder(candidates.length);
  return order.slice(0, RESCUE_WINDOWS).map(index => candidates[index]);
}

function makeRomanianTimeWindows(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration <= FULL_SCAN_SECONDS) {
    return null;
  }

  const primary = makePrimaryWindows(duration);
  const rescue = makeRescueWindows(duration, primary);

  // Stage 1 is deliberately identical in spirit to the previous fast path:
  // 16 progressive probes. Rescue probes are appended only so they are reached
  // when the canonical correlator has not converged during the primary stage.
  return primary.concat(rescue);
}

module.exports = {
  WINDOW_SECONDS,
  PRIMARY_WINDOWS,
  RESCUE_WINDOWS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  MAX_SPARSE_AUDIO_SECONDS,
  MIN_RESCUE_WINDOW_SECONDS,
  farthestFirstOrder,
  makePrimaryWindows,
  makeRescueWindows,
  makeRomanianTimeWindows,
};
