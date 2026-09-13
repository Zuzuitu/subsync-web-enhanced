'use strict';

const MAX_CONTEXT_GAP_SECONDS = 1.25;
const MAX_CONTEXT_SPAN_SECONDS = 4.0;

function normalizeContextWord(text) {
  return String(text || '').normalize('NFC').toLowerCase();
}

function fnv1a32(text, seed) {
  let hash = seed >>> 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (code >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (code >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function anchorToken(left, right) {
  const payload = `${normalizeContextWord(left)}\u0000${normalizeContextWord(right)}`;
  const h1 = fnv1a32(payload, 0x811c9dc5).toString(16).padStart(8, '0');
  const h2 = fnv1a32(payload, 0x9e3779b9).toString(16).padStart(8, '0');
  return `r2${h1}${h2}`;
}

function makeContextAnchor(previous, current) {
  if (!previous || !current) return null;

  const previousTime = Number(previous.time);
  const currentTime = Number(current.time);
  const previousDuration = Math.max(0, Number(previous.duration) || 0);
  const currentDuration = Math.max(0, Number(current.duration) || 0);

  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return null;
  }
  if (currentTime < previousTime) {
    return null;
  }

  const previousEnd = previousTime + previousDuration;
  const currentEnd = currentTime + currentDuration;
  const gap = currentTime - previousEnd;
  const span = currentEnd - previousTime;

  if (gap > MAX_CONTEXT_GAP_SECONDS || span > MAX_CONTEXT_SPAN_SECONDS) {
    return null;
  }

  const left = normalizeContextWord(previous.text);
  const right = normalizeContextWord(current.text);
  if (!left || !right) return null;

  return {
    text: anchorToken(left, right),
    time: (previousTime + currentTime) / 2,
    duration: Math.max(0, currentEnd - previousTime),
    score: Math.min(
      previous.score == null ? 1 : Number(previous.score) || 0,
      current.score == null ? 1 : Number(current.score) || 0
    ),
  };
}

class RomanianContextAnchorStream {
  constructor() {
    this.previous = null;
  }

  push(word) {
    const anchor = makeContextAnchor(this.previous, word);
    this.previous = word ? { ...word } : null;
    return anchor;
  }

  reset() {
    this.previous = null;
  }
}

module.exports = {
  MAX_CONTEXT_GAP_SECONDS,
  MAX_CONTEXT_SPAN_SECONDS,
  normalizeContextWord,
  anchorToken,
  makeContextAnchor,
  RomanianContextAnchorStream,
};
