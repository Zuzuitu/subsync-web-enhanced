'use strict';

const assert = require('assert');
const {
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
  farthestFirstOrder,
  makePrimaryWindows,
  makeRescueWindows,
  makeRomanianTimeWindows,
} = require('../../web/src/romanian-windows.js');

assert.strictEqual(WINDOW_SECONDS, 15);
assert.strictEqual(PRIMARY_WINDOWS, 16);
assert.strictEqual(RESCUE_WINDOW_SECONDS, 30);
assert.strictEqual(RESCUE_CONFIRMATION_WINDOW_SECONDS, 15);
assert.strictEqual(RESCUE_LOCATIONS, 4);
assert.strictEqual(RESCUE_DISCOVERY_WINDOWS, 3);
assert.strictEqual(RESCUE_CONFIRMATION_WINDOWS, 2);
assert.strictEqual(RESCUE_WINDOWS, 5);
assert.strictEqual(MAX_WINDOWS, 21);
assert.strictEqual(FULL_SCAN_SECONDS, 240);
assert.strictEqual(MAX_SPARSE_AUDIO_SECONDS, 360);
assert.strictEqual(makeRomanianTimeWindows(undefined), null);
assert.strictEqual(makeRomanianTimeWindows(240), null);

const order = farthestFirstOrder(PRIMARY_WINDOWS);
assert.strictEqual(order.length, PRIMARY_WINDOWS);
assert.strictEqual(new Set(order).size, PRIMARY_WINDOWS);
assert.strictEqual(order[0], 0);
assert.strictEqual(order[1], PRIMARY_WINDOWS - 1);

const duration = 7200;
const primary = makePrimaryWindows(duration);
assert.strictEqual(primary.length, PRIMARY_WINDOWS);

const summaries = primary.map(([start, end], index) => ({
  start,
  end,
  // Probe 6 contributed real candidate buckets despite modest speech volume.
  // Probe 12 has much more speech but no new candidate buckets.
  wordCount: index === 6 ? 8 : index === 12 ? 60 : 4 + index,
  candidatePointGain: index === 6 ? 3 : index === 3 ? 2 : 0,
}));

const rescue = makeRescueWindows(duration, primary, summaries);
assert.strictEqual(rescue.length, RESCUE_WINDOWS);

const windows = primary.concat(rescue);
assert.strictEqual(windows.length, MAX_WINDOWS);

for (const [start, end] of primary) {
  assert(start >= 0);
  assert(end <= duration);
  assert(end > start);
  assert(end - start <= WINDOW_SECONDS + 1e-9);
}

const rescueDurations = rescue.map(([start, end]) => end - start);
assert.strictEqual(
  rescueDurations.filter(x => Math.abs(x - RESCUE_WINDOW_SECONDS) < 1e-9).length,
  RESCUE_DISCOVERY_WINDOWS,
  'three full 30-second discovery probes must remain'
);
assert.strictEqual(
  rescueDurations.filter(x => Math.abs(x - RESCUE_CONFIRMATION_WINDOW_SECONDS) < 1e-9).length,
  RESCUE_CONFIRMATION_WINDOWS,
  'one 30-second location must become two 15-second confirmation probes'
);

const chronological = windows.slice().sort((a, b) => a[0] - b[0]);
let previousEnd = -1;
for (const [start, end] of chronological) {
  assert(start >= previousEnd - 1e-9, 'primary/rescue windows must not overlap');
  previousEnd = end;
}

assert(primary[0][0] < duration * 0.05, 'first primary probe should cover the beginning region');
assert(primary[1][1] > duration * 0.95, 'second primary probe should cover the ending region');

const firstFiveCenters = primary.slice(0, 5).map(([start, end]) => (start + end) / 2);
assert(
  (Math.max(...firstFiveCenters) - Math.min(...firstFiveCenters)) / duration > 0.9,
  'early primary probes should span almost the whole title'
);

assert.strictEqual(
  primary.reduce((sum, [start, end]) => sum + end - start, 0),
  FULL_SCAN_SECONDS,
  'primary Romanian ASR stage must remain four minutes'
);
assert.strictEqual(
  windows.reduce((sum, [start, end]) => sum + end - start, 0),
  MAX_SPARSE_AUDIO_SECONDS,
  'confirmation reserve must not increase the six-minute sampled-audio cap'
);

// Rescue must still prioritize actual correlation gain over raw speech density.
const rich = primary[6];
assert(
  rescue.some(([start, end]) =>
    Math.abs(start - rich[1]) < 0.05 || Math.abs(end - rich[0]) < 0.05
  ),
  'rescue planner should continue near a point-gain-rich primary probe'
);

// Five probe boundaries represent four physical timeline locations because the
// confirmation location is split into two adjacent halves.
const locationKeys = [];
for (const [start, end] of rescue) {
  const center = (start + end) / 2;
  const quarter = Math.min(3, Math.floor(4 * center / duration));
  if (!locationKeys.includes(quarter)) locationKeys.push(quarter);
}
assert.strictEqual(
  locationKeys.length,
  RESCUE_LOCATIONS,
  'rescue must preserve four-quarter title coverage'
);

// Real-title regression shape: a stable canonical formula can still cover only
// about 63% of a long title. In that state the fixed rescue budget must target
// the missing canonical span instead of spending all four physical locations
// on generic quarter coverage. Numeric-only synthetic data keeps user media and
// subtitle text out of the repository.
const coverageDuration = 5800;
const coveragePrimary = makePrimaryWindows(coverageDuration);
const evidenceStart = 780;
const evidenceEnd = evidenceStart + coverageDuration * 0.629;
const coverageSummaries = coveragePrimary.map(([start, end], index) => ({
  start,
  end,
  wordCount: 6 + (index % 5),
  candidatePointGain: index === 2 || index === 13 ? 2 : index % 4 === 0 ? 1 : 0,
}));
const coverageRescue = makeRescueWindows(
  coverageDuration,
  coveragePrimary,
  coverageSummaries,
  {
    prioritizeCoverage: true,
    evidenceStart,
    evidenceEnd,
  }
);
assert.strictEqual(coverageRescue.length, RESCUE_WINDOWS);
assert.strictEqual(
  coverageRescue.reduce((sum, [start, end]) => sum + end - start, 0),
  RESCUE_DISCOVERY_WINDOWS * RESCUE_WINDOW_SECONDS
    + RESCUE_CONFIRMATION_WINDOWS * RESCUE_CONFIRMATION_WINDOW_SECONDS,
  'coverage recovery must stay inside the existing 120-second rescue budget'
);

const coveragePhysicalLocations = [];
for (const [start, end] of coverageRescue) {
  const center = (start + end) / 2;
  const existing = coveragePhysicalLocations.find(item =>
    Math.abs(item.end - start) < 1e-9 || Math.abs(end - item.start) < 1e-9
  );
  if (existing) {
    existing.start = Math.min(existing.start, start);
    existing.end = Math.max(existing.end, end);
  } else {
    coveragePhysicalLocations.push({ start, end });
  }
}
assert.strictEqual(
  coveragePhysicalLocations.length,
  RESCUE_LOCATIONS,
  'coverage recovery must keep four independent physical search locations'
);
const locationCenters = coveragePhysicalLocations.map(
  item => (item.start + item.end) / 2
);
assert(
  locationCenters.every(center => center < evidenceStart || center > evidenceEnd),
  'coverage recovery must spend its physical locations outside the known canonical span'
);
assert(
  locationCenters.some(center => center < evidenceStart)
    && locationCenters.some(center => center > evidenceEnd),
  'when both sides are missing, coverage recovery must search both title ends'
);
const leftLocations = locationCenters.filter(center => center < evidenceStart).length;
const rightLocations = locationCenters.filter(center => center > evidenceEnd).length;
assert.strictEqual(leftLocations, 1);
assert.strictEqual(rightLocations, 3);

const mediumDuration = 300;
const mediumPrimary = makePrimaryWindows(mediumDuration);
const mediumRescue = makeRescueWindows(
  mediumDuration,
  mediumPrimary,
  mediumPrimary.map(([start, end]) => ({
    start,
    end,
    wordCount: 10,
    candidatePointGain: 1,
  }))
);
assert(mediumRescue.length <= RESCUE_WINDOWS);
for (const [start, end] of mediumRescue) {
  assert(end - start >= 15 - 1e-9);
}

console.log('Romanian rescue discovery/confirmation planner: OK');
