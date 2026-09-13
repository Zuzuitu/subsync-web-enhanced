'use strict';

const MIN_INFORMATIVE_WORDS = 4;
const MIN_POINT_GAIN = 1;
const REQUIRED_STABLE_CORRELATED_WINDOWS = 3;
const MIN_PROBE_COVERAGE_RATIO = 0.75;
const MAX_FORMULA_DELTA_SECONDS = 0.75;

function validFormula(formula) {
  return formula
    && Number.isFinite(formula.a)
    && Number.isFinite(formula.b);
}

function mappedTime(formula, time) {
  return formula.a * time + formula.b;
}

function formulaDeltaSeconds(previous, current, duration) {
  if (!validFormula(previous) || !validFormula(current)) {
    return Infinity;
  }

  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.max(
    Math.abs(mappedTime(previous, 0) - mappedTime(current, 0)),
    Math.abs(mappedTime(previous, end) - mappedTime(current, end))
  );
}

function evidenceSpanRatio(stats, duration) {
  const start = Number(stats && stats.evidenceStart);
  const end = Number(stats && stats.evidenceEnd);
  if (
    !Number.isFinite(duration)
    || duration <= 0
    || !Number.isFinite(start)
    || !Number.isFinite(end)
    || end < start
  ) {
    return 0;
  }
  return Math.max(0, Math.min(1, (end - start) / duration));
}

class RomanianConvergenceTracker {
  constructor(duration, totalWindows, options = {}) {
    this.duration = duration;
    this.totalWindows = totalWindows;
    this.minInformativeWords = options.minInformativeWords || MIN_INFORMATIVE_WORDS;
    this.minPointGain = options.minPointGain || MIN_POINT_GAIN;
    this.requiredStableWindows =
      options.requiredStableWindows || REQUIRED_STABLE_CORRELATED_WINDOWS;
    this.minProbeCoverageRatio =
      options.minProbeCoverageRatio || MIN_PROBE_COVERAGE_RATIO;
    this.maxFormulaDeltaSeconds =
      options.maxFormulaDeltaSeconds || MAX_FORMULA_DELTA_SECONDS;
    this.primaryWindows = Math.min(
      this.totalWindows,
      Number(options.primaryWindows) || this.totalWindows
    );

    this.completedWindows = 0;
    this.informativeWindows = 0;
    this.stableCorrelatedWindows = 0;
    this.lastFormula = null;
    this.lastFormulaDeltaSeconds = null;
    this.lastWindowWords = 0;
    this.lastPoints = 0;
    this.lastConfirmedPoints = null;
    this.lastPointGain = 0;
    this.probeCoverageRatio = 0;
    this.evidenceStart = null;
    this.evidenceEnd = null;
  }

  observe(window, words, stats) {
    void window;
    this.completedWindows += 1;
    this.lastWindowWords = Number(words) || 0;

    const informative = this.lastWindowWords >= this.minInformativeWords;
    if (informative) {
      this.informativeWindows += 1;
    }

    const correlated = Boolean(
      stats
      && stats.correlated
      && validFormula(stats.formula)
    );
    const points = Number(stats && stats.points) || 0;
    this.lastPoints = points;
    this.lastPointGain = 0;

    if (correlated) {
      const coverage = evidenceSpanRatio(stats, this.duration);
      this.probeCoverageRatio = coverage;
      this.evidenceStart = Number.isFinite(Number(stats.evidenceStart))
        ? Number(stats.evidenceStart)
        : null;
      this.evidenceEnd = Number.isFinite(Number(stats.evidenceEnd))
        ? Number(stats.evidenceEnd)
        : null;

      if (this.lastFormula) {
        this.lastFormulaDeltaSeconds = formulaDeltaSeconds(
          this.lastFormula,
          stats.formula,
          this.duration
        );

        if (this.lastFormulaDeltaSeconds > this.maxFormulaDeltaSeconds) {
          // A materially different canonical formula is contradictory evidence:
          // restart the confirmation sequence from this probe.
          this.stableCorrelatedWindows = informative ? 1 : 0;
          this.lastConfirmedPoints = informative ? points : null;
        } else if (informative) {
          if (this.lastConfirmedPoints == null) {
            this.stableCorrelatedWindows = 1;
            this.lastConfirmedPoints = points;
          } else {
            this.lastPointGain = Math.max(0, points - this.lastConfirmedPoints);
            if (this.lastPointGain >= this.minPointGain) {
              // Each confirmation must add a fresh canonical subtitle bucket.
              this.stableCorrelatedWindows += 1;
              this.lastConfirmedPoints = points;
            }
          }
        }

        this.lastFormula = {
          a: stats.formula.a,
          b: stats.formula.b,
        };
      } else if (informative) {
        this.lastFormula = {
          a: stats.formula.a,
          b: stats.formula.b,
        };
        this.lastFormulaDeltaSeconds = null;
        this.stableCorrelatedWindows = 1;
        this.lastConfirmedPoints = points;
      }
    }

    // An inconclusive probe is neutral: it neither confirms nor invalidates a
    // previous canonical result. Only a materially different canonical formula
    // can reset the sequence above.
    return this.getStatus();
  }

  getStatus() {
    const verified = (
      this.stableCorrelatedWindows >= this.requiredStableWindows
      && this.probeCoverageRatio >= this.minProbeCoverageRatio
    );

    const rescueWindowsTotal = Math.max(0, this.totalWindows - this.primaryWindows);
    const rescueWindowsCompleted = Math.max(0, this.completedWindows - this.primaryWindows);

    return {
      completedWindows: this.completedWindows,
      totalWindows: this.totalWindows,
      primaryWindows: this.primaryWindows,
      rescueWindowsTotal,
      rescueWindowsCompleted,
      phase: rescueWindowsCompleted > 0 ? 'rescue' : 'primary',
      informativeWindows: this.informativeWindows,
      stableCorrelatedWindows: this.stableCorrelatedWindows,
      probeCoverageRatio: this.probeCoverageRatio,
      evidenceStart: this.evidenceStart,
      evidenceEnd: this.evidenceEnd,
      lastFormulaDeltaSeconds: this.lastFormulaDeltaSeconds,
      lastWindowWords: this.lastWindowWords,
      lastPoints: this.lastPoints,
      lastPointGain: this.lastPointGain,
      verified,
    };
  }
}

module.exports = {
  MIN_INFORMATIVE_WORDS,
  MIN_POINT_GAIN,
  REQUIRED_STABLE_CORRELATED_WINDOWS,
  MIN_PROBE_COVERAGE_RATIO,
  MAX_FORMULA_DELTA_SECONDS,
  formulaDeltaSeconds,
  evidenceSpanRatio,
  RomanianConvergenceTracker,
};
