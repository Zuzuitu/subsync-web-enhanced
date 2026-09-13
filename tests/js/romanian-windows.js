'use strict';

const assert = require('assert');
const {
  WINDOW_SECONDS,
  PRIMARY_WINDOWS,
  RESCUE_WINDOW_SECONDS,
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
assert.strictEqual(RESCUE_WINDOWS, 4);
assert.strictEqual(MAX_WINDOWS, 20);
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
  wordCount: index === 6 ? 42 : index === 12 ? 30 : 4 + index,
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
for (const [start, end] of rescue) {
  assert(start >= 0);
  assert(end <= duration);
  assert(end > start);
  assert(
    Math.abs((end - start) - RESCUE_WINDOW_SECONDS) < 1e-9,
    'long-title rescue should use native 30-second Whisper context'
  );
}

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
  'content-aware rescue must keep the total sampled-audio cap at six minutes'
);

// Rescue must use observed speech density rather than a fixed uniform order.
// The deliberately speech-rich primary probe should influence at least one
// adjacent rescue window.
const rich = primary[6];
assert(
  rescue.some(([start, end]) =>
    Math.abs(start - rich[1]) < 0.05 || Math.abs(end - rich[0]) < 0.05
  ),
  'rescue planner should continue near a speech-rich primary probe'
);

// The rescue set must remain distributed across the title even when one scene
// dominates the word count.
const rescueQuarters = new Set(
  rescue.map(([start, end]) =>
    Math.min(3, Math.floor(4 * ((start + end) / 2) / duration))
  )
);
assert.strictEqual(
  rescueQuarters.size,
  RESCUE_WINDOWS,
  'rescue should preserve one speech-informed candidate per timeline quarter'
);

// A near-threshold long title can have only small unused gaps. In that case rescue may be shorter than the
// preferred 30-second context, but it must still avoid meaningless micro-probes.
const mediumDuration = 300;
const mediumPrimary = makePrimaryWindows(mediumDuration);
const mediumRescue = makeRescueWindows(
  mediumDuration,
  mediumPrimary,
  mediumPrimary.map(([start, end]) => ({ start, end, wordCount: 10 }))
);
assert(mediumRescue.length <= RESCUE_WINDOWS);
for (const [start, end] of mediumRescue) {
  assert(end - start >= 15 - 1e-9);
}

console.log('Romanian content-aware rescue planner: OK');
