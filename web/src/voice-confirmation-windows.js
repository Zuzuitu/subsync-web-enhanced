'use strict';

// Independent sparse coverage in the existing 120-second rescue allocation.
// Short inputs retain the lexical rescue planner, avoiding overlapping probes.
function makeVoiceConfirmationWindows(duration, scheduled) {
  if (!Number.isFinite(duration) || duration < 600) return [];
  const windows = Array.from({ length: 32 }, (_, index) => {
    const center = (index + .5) * duration / 32;
    return [center - 1.875, center + 1.875];
  });
  if (windows.some(([start, end]) => start < 0 || end > duration
    || scheduled.some(([a, b]) => start < b && end > a))) return [];
  return windows;
}

module.exports = { makeVoiceConfirmationWindows };
