'use strict';

const WINDOW_SECONDS = 15;
const MAX_WINDOWS = 16;
const FULL_SCAN_SECONDS = WINDOW_SECONDS * MAX_WINDOWS;

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

function makeRomanianTimeWindows(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration <= FULL_SCAN_SECONDS) {
    return null;
  }

  const bucket = duration / MAX_WINDOWS;
  const chronological = [];
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const center = (i + 0.5) * bucket;
    let start = Math.max(0, center - WINDOW_SECONDS / 2);
    let end = Math.min(duration, start + WINDOW_SECONDS);
    start = Math.max(0, end - WINDOW_SECONDS);
    chronological.push([start, end]);
  }

  // Progressive coverage matters for adaptive convergence: probe the beginning
  // and end regions first, then repeatedly fill the largest temporal gaps.
  return farthestFirstOrder(MAX_WINDOWS).map(index => chronological[index]);
}

module.exports = {
  WINDOW_SECONDS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  farthestFirstOrder,
  makeRomanianTimeWindows,
};
