'use strict';

const WINDOW_SECONDS = 15;
const PRIMARY_WINDOWS = 16;
const RESCUE_WINDOW_SECONDS = 15;
const RESCUE_CONFIRMATION_WINDOW_SECONDS = 15;
const RESCUE_LOCATIONS = 8;
const RESCUE_DISCOVERY_WINDOWS = 5;
const RESCUE_CONFIRMATION_WINDOWS = 3;
const RESCUE_WINDOWS = RESCUE_DISCOVERY_WINDOWS + RESCUE_CONFIRMATION_WINDOWS;
const MAX_WINDOWS = PRIMARY_WINDOWS + RESCUE_WINDOWS;
const FULL_SCAN_SECONDS = WINDOW_SECONDS * PRIMARY_WINDOWS;
const MAX_SPARSE_AUDIO_SECONDS =
  FULL_SCAN_SECONDS + RESCUE_WINDOWS * RESCUE_WINDOW_SECONDS;
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
    start = gap[0];
  } else if (rightPriority > leftPriority) {
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

function candidateCenter(candidate) {
  return (candidate.window[0] + candidate.window[1]) / 2;
}

function selectCoverageDeficitLocations(duration, candidates, context) {
  if (!context || !context.prioritizeCoverage) return [];

  const evidenceStart = Number(context.evidenceStart);
  const evidenceEnd = Number(context.evidenceEnd);
  if (
    !Number.isFinite(duration)
    || duration <= 0
    || !Number.isFinite(evidenceStart)
    || !Number.isFinite(evidenceEnd)
    || evidenceStart < 0
    || evidenceEnd > duration
    || evidenceEnd <= evidenceStart
  ) {
    return [];
  }

  const leftNeed = Math.max(0, evidenceStart);
  const rightNeed = Math.max(0, duration - evidenceEnd);
  const totalNeed = leftNeed + rightNeed;
  if (totalNeed <= 0) return [];

  const rank = (items, side) => items.slice().sort((a, b) => {
    const aGain = side === 'left'
      ? evidenceStart - candidateCenter(a)
      : candidateCenter(a) - evidenceEnd;
    const bGain = side === 'left'
      ? evidenceStart - candidateCenter(b)
      : candidateCenter(b) - evidenceEnd;
    return b.pointGain - a.pointGain
      || bGain - aGain
      || b.words - a.words
      || a.window[0] - b.window[0];
  });

  const left = rank(
    candidates.filter(candidate => candidateCenter(candidate) < evidenceStart),
    'left'
  );
  const right = rank(
    candidates.filter(candidate => candidateCenter(candidate) > evidenceEnd),
    'right'
  );
  if (!left.length && !right.length) return [];

  let leftSlots = Math.round(RESCUE_LOCATIONS * leftNeed / totalNeed);
  if (left.length && right.length) {
    leftSlots = Math.max(1, Math.min(RESCUE_LOCATIONS - 1, leftSlots));
  }
  leftSlots = Math.min(leftSlots, left.length);
  let rightSlots = Math.min(RESCUE_LOCATIONS - leftSlots, right.length);

  let remaining = RESCUE_LOCATIONS - leftSlots - rightSlots;
  if (remaining > 0) {
    const addLeft = Math.min(remaining, left.length - leftSlots);
    leftSlots += addLeft;
    remaining -= addLeft;
  }
  if (remaining > 0) {
    const addRight = Math.min(remaining, right.length - rightSlots);
    rightSlots += addRight;
    remaining -= addRight;
  }

  const selected = left.slice(0, leftSlots).concat(right.slice(0, rightSlots));
  if (selected.length >= RESCUE_LOCATIONS) {
    return selected.slice(0, RESCUE_LOCATIONS);
  }

  const used = new Set(selected);
  const fallback = candidates
    .filter(candidate => !used.has(candidate))
    .sort((a, b) =>
      b.score - a.score
      || a.window[0] - b.window[0]
    );
  return selected.concat(fallback.slice(0, RESCUE_LOCATIONS - selected.length));
}

function selectRescueLocations(
  duration,
  primaryWindows,
  primarySummaries = [],
  context = null
) {
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

  const coverageSelected = selectCoverageDeficitLocations(
    duration,
    candidates,
    context
  );
  if (coverageSelected.length) {
    return coverageSelected;
  }

  const selected = [];
  const used = new Set();

  // Preserve broad title coverage first.
  for (let quarter = 0; quarter < 4 && selected.length < RESCUE_LOCATIONS; quarter++) {
    let bestIndex = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i) || candidates[i].quarter !== quarter) continue;
      if (bestIndex < 0 || candidates[i].score > candidates[bestIndex].score) {
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
    if (selected.length >= RESCUE_LOCATIONS) break;
    selected.push(item.candidate);
  }

  return selected;
}

function splitConfirmationWindow(window) {
  if (!window || window.length < 2) return [];
  const [start, end] = window;
  const length = end - start;
  if (length < 2 * RESCUE_CONFIRMATION_WINDOW_SECONDS) {
    return [window];
  }
  const mid = start + RESCUE_CONFIRMATION_WINDOW_SECONDS;
  return [
    [start, mid],
    [mid, start + 2 * RESCUE_CONFIRMATION_WINDOW_SECONDS],
  ];
}

function makeRescueWindows(
  duration,
  primaryWindows,
  primarySummaries = [],
  context = null
) {
  if (
    !Number.isFinite(duration)
    || duration <= FULL_SCAN_SECONDS
    || !primaryWindows
    || !primaryWindows.length
  ) {
    return [];
  }

  const selected = selectRescueLocations(
    duration,
    primaryWindows,
    primarySummaries,
    context
  );
  if (!selected.length) return [];

  // The physical Smallfoot reproduction can first cross the canonical
  // 20-bucket gate on the final rescue boundary. Keep the exact 120 s rescue
  // audio budget, but expose more independent 15 s evidence boundaries and
  // reserve the three strongest selected locations for the verifier tail.
  // If the first tail probe establishes a canonical line, two fresh locations
  // remain available for the unchanged 3/3 stable-confirmation requirement.
  const ranked = selected.slice().sort((a, b) =>
    b.score - a.score
    || b.pointGain - a.pointGain
    || b.words - a.words
    || a.window[0] - b.window[0]
  );
  const confirmation = ranked.slice(0, RESCUE_CONFIRMATION_WINDOWS);
  const confirmationSet = new Set(confirmation);

  const discoveryCandidates = selected
    .filter(candidate => !confirmationSet.has(candidate))
    .sort((a, b) => a.window[0] - b.window[0]);
  const discoveryOrder = farthestFirstOrder(discoveryCandidates.length);
  const discovery = discoveryOrder
    .map(index => discoveryCandidates[index].window)
    .slice(0, RESCUE_DISCOVERY_WINDOWS);

  return discovery.concat(confirmation.map(candidate => candidate.window));
}

function makeRomanianTimeWindows(duration, primarySummaries = [], context = null) {
  const primary = makePrimaryWindows(duration);
  if (!primary) return null;
  return primary.concat(makeRescueWindows(
    duration,
    primary,
    primarySummaries,
    context
  ));
}

module.exports = {
  WINDOW_SECONDS,
  PRIMARY_WINDOWS,
  RESCUE_WINDOW_SECONDS,
  RESCUE_CONFIRMATION_WINDOW_SECONDS,
  RESCUE_LOCATIONS,
  RESCUE_DISCOVERY_WINDOWS,
  RESCUE_CONFIRMATION_WINDOWS,
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
  candidateCenter,
  selectCoverageDeficitLocations,
  selectRescueLocations,
  splitConfirmationWindow,
  makeRescueWindows,
  makeRomanianTimeWindows,
};
