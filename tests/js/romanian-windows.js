'use strict';

const assert = require('assert');
const {
  WINDOW_SECONDS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  farthestFirstOrder,
  makeRomanianTimeWindows,
} = require('../../web/src/romanian-windows.js');

assert.strictEqual(WINDOW_SECONDS, 15);
assert.strictEqual(MAX_WINDOWS, 16);
assert.strictEqual(FULL_SCAN_SECONDS, 240);
assert.strictEqual(makeRomanianTimeWindows(undefined), null);
assert.strictEqual(makeRomanianTimeWindows(240), null);

const order = farthestFirstOrder(MAX_WINDOWS);
assert.strictEqual(order.length, MAX_WINDOWS);
assert.strictEqual(new Set(order).size, MAX_WINDOWS);
assert.strictEqual(order[0], 0);
assert.strictEqual(order[1], MAX_WINDOWS - 1);

const duration = 7200;
const windows = makeRomanianTimeWindows(duration);
assert.strictEqual(windows.length, MAX_WINDOWS);

for (const [start, end] of windows) {
  assert(start >= 0);
  assert(end <= duration);
  assert(end > start);
  assert(Math.abs((end - start) - WINDOW_SECONDS) < 1e-9);
}

const chronological = windows.slice().sort((a, b) => a[0] - b[0]);
let previousEnd = -1;
for (const [start, end] of chronological) {
  assert(start >= previousEnd, 'long-film sparse windows must not overlap');
  previousEnd = end;
}

assert(windows[0][0] < duration * 0.05, 'first probe should cover the beginning region');
assert(windows[1][1] > duration * 0.95, 'second probe should cover the ending region');

const firstFiveCenters = windows.slice(0, 5).map(([start, end]) => (start + end) / 2);
assert(
  (Math.max(...firstFiveCenters) - Math.min(...firstFiveCenters)) / duration > 0.9,
  'early probes should span almost the whole title'
);

assert.strictEqual(
  windows.reduce((sum, [start, end]) => sum + end - start, 0),
  FULL_SCAN_SECONDS,
  'a long movie should cap Romanian ASR input at four minutes'
);

console.log('Romanian progressive sparse-window planner: OK');
