'use strict';

const MAX_CONTEXT_GAP_SECONDS = 1.25;
const MAX_CONTEXT_SPAN_SECONDS = 4.0;

// Older Romanian SRT releases often contain ISO-8859-2 glyphs stored as
// literal Unicode characters (e.g. "ºi", "þarã"). Normalize only the lexical
// evidence sent to the Romanian correlator; never rewrite exported subtitles.
const ROMANIAN_LEGACY_GLYPHS = {
  'ã': 'ă', 'Ã': 'Ă', 'º': 'ș', 'ª': 'Ș', 'þ': 'ț', 'Þ': 'Ț',
  'ş': 'ș', 'Ş': 'Ș', 'ţ': 'ț', 'Ţ': 'Ț',
};

function normalizeRomanianCorrelationWord(text) {
  return String(text || '').normalize('NFC')
    .replace(/[ãÃºªþÞşŞţŢ]/g, glyph => ROMANIAN_LEGACY_GLYPHS[glyph]);
}

function normalizeContextWord(text) {
  return normalizeRomanianCorrelationWord(text).toLowerCase();
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

function wordBounds(word) {
  const time = Number(word && word.time);
  const duration = Math.max(0, Number(word && word.duration) || 0);
  if (!Number.isFinite(time)) return null;

  if (word && word.timeAnchor === 'center' && duration > 0) {
    return {
      start: time - duration / 2,
      end: time + duration / 2,
    };
  }

  return {
    start: time,
    end: time + duration,
  };
}

function makeContextAnchor(previous, current) {
  if (!previous || !current) return null;

  const previousTime = Number(previous.time);
  const currentTime = Number(current.time);
  const previousBounds = wordBounds(previous);
  const currentBounds = wordBounds(current);

  if (
    !Number.isFinite(previousTime)
    || !Number.isFinite(currentTime)
    || !previousBounds
    || !currentBounds
  ) {
    return null;
  }
  if (currentTime < previousTime) {
    return null;
  }

  const gap = currentBounds.start - previousBounds.end;
  const span = currentBounds.end - previousBounds.start;

  if (gap > MAX_CONTEXT_GAP_SECONDS || span > MAX_CONTEXT_SPAN_SECONDS) {
    return null;
  }

  const left = normalizeContextWord(previous.text);
  const right = normalizeContextWord(current.text);
  if (!left || !right) return null;

  return {
    text: anchorToken(left, right),
    // Anchor the pair in the same timing coordinate used by correlation.
    time: (previousTime + currentTime) / 2,
    duration: Math.max(0, span),
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
  normalizeRomanianCorrelationWord,
  wordBounds,
  anchorToken,
  makeContextAnchor,
  RomanianContextAnchorStream,
};
