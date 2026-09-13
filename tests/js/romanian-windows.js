'use strict';

const assert = require('assert');
const {
  WINDOW_SECONDS,
  PRIMARY_WINDOWS,
  RESCUE_WINDOWS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  MAX_SPARSE_AUDIO_SECONDS,
  farthestFirstOrder,
  makeRomanianTimeWindows,
} = require('../../web/src/romanian-windows.js');

assert.strictEqual(WINDOW_SECONDS, 15);
assert.strictEqual(PRIMARY_WINDOWS, 16);
assert.strictEqual(RESCUE_WINDOWS, 8);
assert.strictEqual(MAX_WINDOWS, 24);
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
const windows = makeRomanianTimeWindows(duration);
assert.strictEqual(windows.length, MAX_WINDOWS);

const primary = windows.slice(0, PRIMARY_WINDOWS);
const rescue = windows.slice(PRIMARY_WINDOWS);
assert.strictEqual(rescue.length, RESCUE_WINDOWS);

for (const [start, end] of windows) {
  assert(start >= 0);
  assert(end <= duration);
  assert(end > start);
  assert(end - start <= WINDOW_SECONDS + 1e-9);
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
  'long-title primary + rescue budget must cap at six minutes'
);

// A shorter title may have less than eight full 15-second rescue gaps, but
// rescue probes must still use previously unscanned regions rather than repeat audio.
const medium = makeRomanianTimeWindows(300);
assert(medium.length >= PRIMARY_WINDOWS);
assert(medium.length <= MAX_WINDOWS);
const mediumChronological = medium.slice().sort((a, b) => a[0] - b[0]);
previousEnd = -1;
for (const [start, end] of mediumChronological) {
  assert(start >= previousEnd - 1e-9, 'medium-title rescue windows must not overlap');
  previousEnd = end;
}

console.log('Romanian primary + rescue sparse-window planner: OK');
