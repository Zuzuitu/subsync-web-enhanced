'use strict';

const assert = require('assert');
const {
  MAX_CONTEXT_GAP_SECONDS,
  MAX_CONTEXT_SPAN_SECONDS,
  normalizeContextWord,
  normalizeRomanianCorrelationWord,
  wordBounds,
  anchorToken,
  makeContextAnchor,
  RomanianContextAnchorStream,
} = require('../../web/src/romanian-context-anchors.js');

assert.strictEqual(MAX_CONTEXT_GAP_SECONDS, 1.25);
assert.strictEqual(MAX_CONTEXT_SPAN_SECONDS, 4.0);
assert.strictEqual(normalizeContextWord('ÎNTREBARE'), 'întrebare');
assert.strictEqual(normalizeRomanianCorrelationWord('Durã, ºi þara'), 'Dură, și țara');
assert.strictEqual(normalizeRomanianCorrelationWord('ªTIU ÃSTA ÞI'), 'ȘTIU ĂSTA ȚI');
assert.strictEqual(normalizeRomanianCorrelationWord('Ştiinţă'), 'Știință');
assert.strictEqual(normalizeRomanianCorrelationWord('Asta e lumea mea.'), 'Asta e lumea mea.');
assert.strictEqual(anchorToken('ºi', 'þarã'), anchorToken('și', 'țară'));
assert.strictEqual(
  makeContextAnchor(
    { text: 'ºi', time: 10, duration: 0.2 },
    { text: 'þarã', time: 10.3, duration: 0.4 }
  ).text,
  makeContextAnchor(
    { text: 'și', time: 10, duration: 0.2 },
    { text: 'țară', time: 10.3, duration: 0.4 }
  ).text
);

assert.deepStrictEqual(
  wordBounds({ time: 10.5, duration: 1.0, timeAnchor: 'center' }),
  { start: 10.0, end: 11.0 },
  'center-anchored Whisper words must retain their true acoustic bounds'
);
assert.deepStrictEqual(
  wordBounds({ time: 10.0, duration: 1.0 }),
  { start: 10.0, end: 11.0 },
  'legacy/start-anchored subtitle words must retain start-time semantics'
);

const a = anchorToken('întrebare', 'importantă');
const b = anchorToken('întrebare', 'importantă');
const c = anchorToken('întrebare', 'greșită');
assert.strictEqual(a, b);
assert.notStrictEqual(a, c);
assert(a.length >= 18);

const anchor = makeContextAnchor(
  { text: 'întrebare', time: 10.0, duration: 0.4, score: 0.9 },
  { text: 'importantă', time: 10.6, duration: 0.5, score: 0.8 }
);
assert(anchor);
assert.strictEqual(anchor.text, a);
assert(Math.abs(anchor.time - 10.3) < 1e-9);
assert(Math.abs(anchor.duration - 1.1) < 1e-9);
assert.strictEqual(anchor.score, 0.8);

const centeredAnchor = makeContextAnchor(
  { text: 'întrebare', time: 10.2, duration: 0.4, timeAnchor: 'center', score: 0.9 },
  { text: 'importantă', time: 10.85, duration: 0.5, timeAnchor: 'center', score: 0.8 }
);
assert(centeredAnchor);
assert(Math.abs(centeredAnchor.time - 10.525) < 1e-9);
assert(
  Math.abs(centeredAnchor.duration - 1.1) < 1e-9,
  'centered correlation timestamps must not inflate the acoustic pair span'
);

assert.strictEqual(
  makeContextAnchor(
    { text: 'întrebare', time: 10.0, duration: 0.4 },
    { text: 'importantă', time: 12.0, duration: 0.5 }
  ),
  null,
  'large gaps must not create cross-scene anchors'
);

const stream = new RomanianContextAnchorStream();
assert.strictEqual(stream.push({ text: 'salut', time: 1, duration: 0.2 }), null);
assert(stream.push({ text: 'prietene', time: 1.3, duration: 0.3 }));
assert.strictEqual(
  stream.push({ text: 'departe', time: 5.0, duration: 0.3 }),
  null,
  'sparse-window jumps must reset context naturally by gap'
);

console.log('Romanian lexical context anchors: OK');
