'use strict';

// Romanian Whisper runs single-threaded in the browser. Keep enough independent
// samples across the whole title for the original sc0ty correlator while
// bounding expensive ASR work. Twenty 12-second windows provide broader
// temporal coverage than the previous 16-window plan while cutting the maximum
// audio sent to Whisper from eight minutes to four minutes.
const WINDOW_SECONDS = 12;
const MAX_WINDOWS = 20;
const FULL_SCAN_SECONDS = WINDOW_SECONDS * MAX_WINDOWS;

function makeRomanianTimeWindows(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration <= FULL_SCAN_SECONDS) {
    return null;
  }

  const windows = [];
  const bucket = duration / MAX_WINDOWS;
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const center = (i + 0.5) * bucket;
    let start = Math.max(0, center - WINDOW_SECONDS / 2);
    let end = Math.min(duration, start + WINDOW_SECONDS);
    start = Math.max(0, end - WINDOW_SECONDS);
    windows.push([start, end]);
  }
  return windows;
}

module.exports = {
  WINDOW_SECONDS,
  MAX_WINDOWS,
  FULL_SCAN_SECONDS,
  makeRomanianTimeWindows,
};
