'use strict';

// Sampling hint only: a provisional fit must never authorize Save or change
// the exported formula. Keep movement local to the existing rescue locations.
const MAX_MOVE_SECONDS = 60;
const OFFSET_MARGIN_SECONDS = 2;

function makeDialogueWindowGuide(context, duration) {
  const evidence = context && context.dialogueEvidence;
  const events = context && context.subtitleEvents;
  const formula = evidence && evidence.formula;
  if (!evidence || evidence.correlated || context.prioritizeCoverage
      || !evidence.sameLanguage || !evidence.subtitlesComplete
      || !Array.isArray(events) || !events.length || events.length > 20000
      || !Number.isFinite(duration) || duration <= 0
      || !formula || !Number.isFinite(formula.a) || !Number.isFinite(formula.b)
      || formula.a < 0.9 || formula.a > 1.1
      || !Number.isFinite(evidence.points) || evidence.points < 10
      || !Number.isFinite(evidence.factor) || evidence.factor < 0.9999
      || !Number.isFinite(evidence.maxDistance) || evidence.maxDistance > 10
      || !Number.isFinite(evidence.coverage) || evidence.coverage < 0.75) return null;

  const seen = new Set();
  const intervals = [];
  for (const event of events) {
    if (!Number.isFinite(event.start) || !Number.isFinite(event.end)
        || event.end <= event.start) continue;
    const start = formula.a * event.start + formula.b;
    const end = formula.a * event.end + formula.b;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= 0 || start >= duration) continue;
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    intervals.push([start, end]);
  }
  if (!intervals.length) return null;

  return (window, gap) => {
    const length = window[1] - window[0];
    const center = (window[0] + window[1]) / 2;
    const quarter = Math.min(3, Math.floor(4 * center / duration));
    const third = Math.min(2, Math.floor(3 * center / duration));
    // Preserve the original gap, quarter and third; never overlap sampled
    // audio or turn the coverage planner into a subtitle-density planner.
    const low = Math.max(gap[0], window[0] - MAX_MOVE_SECONDS,
      quarter * duration / 4 - length / 2, third * duration / 3 - length / 2);
    const high = Math.min(gap[1] - length, window[0] + MAX_MOVE_SECONDS,
      (quarter + 1) * duration / 4 - length / 2 - 1e-6,
      (third + 1) * duration / 3 - length / 2 - 1e-6);
    if (high < low) return window;
    const nearby = intervals.filter(([start, end]) =>
      end > low - OFFSET_MARGIN_SECONDS && start < high + length + OFFSET_MARGIN_SECONDS);
    // Pathological stacked/very dense subtitles must not make this optional
    // local search expensive on phones. Fall back without changing the plan.
    if (nearby.length > 64) return window;
    // One complete subtitle cue contributes at most one vote. Evaluate the
    // worst score under +/-2 s offset uncertainty instead of trusting the fit.
    const score = start => {
      // Overlap is piecewise linear in the offset. Its minimum on the
      // uncertainty interval is attained at an endpoint or a cue/window-edge
      // crossing; checking only -2/0/+2 could miss an interior minimum.
      const offsets = new Set([-OFFSET_MARGIN_SECONDS, 0, OFFSET_MARGIN_SECONDS]);
      for (const [left, right] of nearby) {
        for (const delta of [start - left, start - right,
          start + length - left, start + length - right]) {
          if (Math.abs(delta) <= OFFSET_MARGIN_SECONDS) offsets.add(delta);
        }
      }
      return Math.min(...[...offsets].map(delta => nearby.reduce((sum, [left, right]) =>
        sum + Math.max(0, Math.min(start + length, right + delta)
          - Math.max(start, left + delta)) / (right - left), 0)));
    };
    const candidates = new Set([window[0], low, high]);
    for (const [start, end] of nearby) {
      for (const delta of [-OFFSET_MARGIN_SECONDS, 0, OFFSET_MARGIN_SECONDS]) {
        for (const edge of [start + delta, end + delta - length]) {
          candidates.add(Math.max(low, Math.min(high, edge)));
        }
      }
    }
    const baseline = score(window[0]);
    let bestStart = window[0];
    let bestScore = baseline;
    for (const start of candidates) {
      const value = score(start);
      if (value > bestScore + 1e-9 || (Math.abs(value - bestScore) <= 1e-9
          && Math.abs(start - window[0]) < Math.abs(bestStart - window[0]))) {
        bestStart = start;
        bestScore = value;
      }
    }
    return bestScore >= baseline + 2 && bestScore >= baseline * 1.25
      ? [bestStart, bestStart + length] : window;
  };
}

module.exports = { makeDialogueWindowGuide, MAX_MOVE_SECONDS };
