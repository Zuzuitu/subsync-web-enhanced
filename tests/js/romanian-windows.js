'use strict';

const assert = require('assert');
const {
  WINDOW_SECONDS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  makeRomanianTimeWindows,
} = require('../../web/src/romanian-windows.js');

assert.strictEqual(WINDOW_SECONDS, 12);
assert.strictEqual(MAX_WINDOWS, 20);
assert.strictEqual(FULL_SCAN_SECONDS, 240);
assert.strictEqual(makeRomanianTimeWindows(undefined), null);
assert.strictEqual(makeRomanianTimeWindows(240), null);

const duration = 7200;
const windows = makeRomanianTimeWindows(duration);
assert.strictEqual(windows.length, 20);

let previousEnd = -1;
for (const [start, end] of windows) {
  assert(start >= 0);
  assert(end <= duration);
  assert(end > start);
  assert(Math.abs((end - start) - WINDOW_SECONDS) < 1e-9);
  assert(start > previousEnd, 'long-film sparse windows must not overlap');
  previousEnd = end;
}

assert(windows[0][0] < duration * 0.05, 'scan should cover the beginning region');
assert(windows[windows.length - 1][1] > duration * 0.95, 'scan should cover the ending region');
assert.strictEqual(
  windows.reduce((sum, [start, end]) => sum + end - start, 0),
  FULL_SCAN_SECONDS,
  'a long movie should cap Romanian ASR input at four minutes'
);

console.log('Romanian sparse-window planner: OK');
