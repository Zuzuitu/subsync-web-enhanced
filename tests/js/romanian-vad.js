'use strict';
const assert = require('assert');
const {
  correlationScore,
  estimateRomanianVadCorrection,
  isReliableRomanianVad,
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
console.log('Romanian VAD timing evidence: OK');
