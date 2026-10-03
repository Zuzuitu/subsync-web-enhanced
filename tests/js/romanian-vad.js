'use strict';
const assert = require('assert');
const {
  correlationScore,
  estimateRomanianVadCorrection,
  isReliableRomanianVad,
  occupancyIntervals,
  subtitleOccupancy,
} = require('../../web/src/romanian-vad.js');

const events = [
  { start: 12, end: 20 },
  { start: 42, end: 50 },
  { start: 76, end: 84 },
];
const activity = [];
for (let time = 0; time < 96; time += 0.25) {
  const sourceTime = time + 10;
  const energy = events.some(event => sourceTime >= event.start && sourceTime <= event.end)
    ? 0.9 : 0.03;
  activity.push({ time, energy });
}

assert(correlationScore(activity, events, -10) > correlationScore(activity, events, 0));
const estimate = estimateRomanianVadCorrection(activity, events, 96);
assert(estimate);
assert(Math.abs(estimate.offset + 10) < 0.2, `unexpected offset ${estimate.offset}`);
assert(estimate.thirdCount === 3);
assert(isReliableRomanianVad(estimate));
assert(!isReliableRomanianVad({ ...estimate, score: 0.1 }));
assert(!isReliableRomanianVad({ ...estimate, spread: 2 }));
const nested = occupancyIntervals([{ start: 5, end: 6 }, { start: 1, end: 10 }, { start: 4, end: 7 }]);
assert.equal(subtitleOccupancy(nested, 9), 1, 'nested cues must not hide their outer cue');
assert.equal(subtitleOccupancy(nested, 11), 0);
assert.equal(estimateRomanianVadCorrection(activity.map(x => ({ ...x, energy: 0 })), events, 96), null);
const differentOffsets = activity.map(x => ({ ...x, time: x.time + (x.time > 64 ? 5 : 0) }));
assert(!isReliableRomanianVad(estimateRomanianVadCorrection(differentOffsets, events, 101)), 'inconsistent thirds must not export');
console.log('Romanian VAD timing evidence: OK');
