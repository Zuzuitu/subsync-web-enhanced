'use strict';
const assert = require('assert');
const { makeDialogueWindowGuide } = require('../../web/src/romanian-dialogue-windows.js');
const { makePrimaryWindows, makeRescueWindows } = require('../../web/src/romanian-windows.js');

const context = {
  subtitleEvents: Array.from({length: 8}, (_, i) => ({start: 597 + i * 3, end: 599 + i * 3})),
  dialogueEvidence: {sameLanguage: true, subtitlesComplete: true, correlated: false,
    formula: {a: 1, b: -37}, points: 13, factor: 0.999995, maxDistance: 5, coverage: 0.87},
};
const original = JSON.stringify(context);
const window = [500, 530];
const moved = makeDialogueWindowGuide(context, 2400)(window, [400, 700]);
assert(moved[0] > 530 && moved[0] <= 560);
assert.strictEqual(moved[1] - moved[0], 30);
assert.strictEqual(JSON.stringify(context), original);
assert.deepStrictEqual(window, [500, 530]);
for (const override of [{correlated: true}, {sameLanguage: false}, {subtitlesComplete: false},
  {points: 9}, {factor: 0.99}, {coverage: 0.74}, {maxDistance: 11},
  {formula: {a: NaN, b: 0}}, {formula: {a: 1, b: Infinity}}, {points: NaN}]) {
  assert.strictEqual(makeDialogueWindowGuide({...context,
    dialogueEvidence: {...context.dialogueEvidence, ...override}}, 2400), null);
}
assert.strictEqual(makeDialogueWindowGuide({...context, prioritizeCoverage: true}, 2400), null);
assert.strictEqual(makeDialogueWindowGuide(null, 2400), null);
assert.strictEqual(makeDialogueWindowGuide({...context, subtitleEvents: []}, 2400), null);
assert.deepStrictEqual(makeDialogueWindowGuide(context, 2400)(window, [500, 530]), window);
const duplicateOnly = {...context, subtitleEvents: Array(100).fill(context.subtitleEvents[0])};
assert.deepStrictEqual(makeDialogueWindowGuide(duplicateOnly, 2400)(window, [400, 700]), window,
  'stacked identical timings cannot manufacture extra independent cues');
const dense = {...context, subtitleEvents: Array.from({length: 65}, (_, i) =>
  ({start: 597 + i * 0.01, end: 599 + i * 0.01}))};
assert.deepStrictEqual(makeDialogueWindowGuide(dense, 2400)(window, [400, 700]), window,
  'pathological local density falls back with bounded phone computation');

// End-to-end planner shape: broad evidence + sparse old windows, with denser
// fresh subtitle cues nearby. No media, recognized words or user text stored.
const duration = 4800;
const primary = makePrimaryWindows(duration);
const summaries = primary.map(([start, end], i) => ({start, end, wordCount: 8,
  candidatePointGain: i % 3 === 0 ? 2 : 1}));
const old = makeRescueWindows(duration, primary, summaries);
const events = [];
for (let start = 0; start < duration - 3; start += 4) {
  if (old.some(([a, b]) => start < b + 3 && start + 3 > a - 3)) continue;
  events.push({start: start + 37, end: start + 40});
}
const guidedContext = {...context, subtitleEvents: events};
const guided = makeRescueWindows(duration, primary, summaries, guidedContext);
assert.notDeepStrictEqual(guided, old, 'sparse rescue windows should move toward fresh cue density');
assert.strictEqual(guided.length, old.length);
assert(Math.abs(guided.reduce((sum, [a, b]) => sum + b - a, 0) - 120) < 1e-8);
const combined = primary.concat(guided).sort((a, b) => a[0] - b[0]);
for (let i = 0; i < combined.length; i++) {
  assert(combined[i][0] >= 0 && combined[i][1] <= duration);
  if (i) assert(combined[i][0] >= combined[i - 1][1] - 1e-8);
}
assert.strictEqual(new Set(guided.map(([a,b]) => Math.floor(4 * (a+b)/2/duration))).size, 4);
assert.deepStrictEqual(makeRescueWindows(duration, primary, summaries, {
  ...guidedContext, dialogueEvidence: {...context.dialogueEvidence, correlated: true},
}), old, 'already canonical runs preserve their exact prior rescue plan');
console.log('Bounded subtitle-guided rescue and fallback: OK');
