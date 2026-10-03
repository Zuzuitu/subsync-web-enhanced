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
for (const shift of [-90, -2.5, 0, 47, 700]) {
  const shiftedEvents = events.map(event => ({ start: event.start + shift, end: event.end + shift }));
  const shiftedEstimate = estimateRomanianVadCorrection(activity, shiftedEvents, 96);
  assert(isReliableRomanianVad(shiftedEstimate), `shift ${shift} must be recoverable`);
  assert(Math.abs(shiftedEstimate.offset + 10 + shift) < .2,
    'offset search must not depend on the private corpus having a +10-second shift');
}
const nested = occupancyIntervals([{ start: 5, end: 6 }, { start: 1, end: 10 }, { start: 4, end: 7 }]);
assert.equal(subtitleOccupancy(nested, 9), 1, 'nested cues must not hide their outer cue');
assert.equal(subtitleOccupancy(nested, 11), 0);
assert.equal(estimateRomanianVadCorrection(activity.map(x => ({ ...x, energy: 0 })), events, 96), null);
const differentOffsets = activity.map(x => ({ ...x, time: x.time + (x.time > 64 ? 5 : 0) }));
assert(!isReliableRomanianVad(estimateRomanianVadCorrection(differentOffsets, events, 101)), 'inconsistent thirds must not export');
console.log('Romanian VAD timing evidence: OK');
