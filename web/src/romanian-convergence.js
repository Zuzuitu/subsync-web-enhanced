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

    this.completedWindows = 0;
    this.informativeWindows = 0;
    this.stableCorrelatedWindows = 0;
    this.completedCenters = [];
    this.lastFormula = null;
    this.lastFormulaDeltaSeconds = null;
    this.lastWindowWords = 0;
    this.lastPoints = 0;
    this.lastConfirmedPoints = null;
    this.lastPointGain = 0;
  }

  observe(window, words, stats) {
    this.completedWindows += 1;
    this.lastWindowWords = Number(words) || 0;

    const start = Number(window && window.start);
    const end = Number(window && window.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      this.completedCenters.push((start + end) / 2);
    }

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

    if (correlated && this.lastFormula) {
      this.lastFormulaDeltaSeconds = formulaDeltaSeconds(
        this.lastFormula,
        stats.formula,
        this.duration
      );

      if (this.lastFormulaDeltaSeconds > this.maxFormulaDeltaSeconds) {
        // A materially different formula invalidates the previous stability
        // streak. A speech-bearing window can establish a new baseline, but
        // never inherits confirmations from the old formula.
        this.stableCorrelatedWindows = informative ? 1 : 0;
        this.lastConfirmedPoints = informative ? points : null;
        this.lastPointGain = 0;
      } else if (informative) {
        if (this.lastConfirmedPoints == null) {
          this.stableCorrelatedWindows = 1;
          this.lastConfirmedPoints = points;
          this.lastPointGain = 0;
        } else {
          this.lastPointGain = Math.max(0, points - this.lastConfirmedPoints);
          if (this.lastPointGain >= this.minPointGain) {
            // A stable formula alone is not enough: each confirmation must add
            // fresh canonical correlation evidence from another probe.
            this.stableCorrelatedWindows += 1;
            this.lastConfirmedPoints = points;
          }
        }
      } else {
        this.lastPointGain = 0;
      }

      this.lastFormula = {
        a: stats.formula.a,
        b: stats.formula.b,
      };
    } else if (correlated && informative) {
      this.lastFormula = {
        a: stats.formula.a,
        b: stats.formula.b,
      };
      this.lastFormulaDeltaSeconds = null;
      this.stableCorrelatedWindows = 1;
      this.lastConfirmedPoints = points;
      this.lastPointGain = 0;
    } else if (!correlated) {
      this.lastFormula = null;
      this.lastFormulaDeltaSeconds = null;
      this.stableCorrelatedWindows = 0;
      this.lastConfirmedPoints = null;
      this.lastPointGain = 0;
    }

    return this.getStatus();
  }

  getProbeCoverageRatio() {
    if (
      !Number.isFinite(this.duration)
      || this.duration <= 0
      || this.completedCenters.length < 2
    ) {
      return 0;
    }

    const min = Math.min(...this.completedCenters);
    const max = Math.max(...this.completedCenters);
    return Math.max(0, Math.min(1, (max - min) / this.duration));
  }

  getStatus() {
    const probeCoverageRatio = this.getProbeCoverageRatio();
    const verified = (
      this.stableCorrelatedWindows >= this.requiredStableWindows
      && probeCoverageRatio >= this.minProbeCoverageRatio
    );

    return {
      completedWindows: this.completedWindows,
      totalWindows: this.totalWindows,
      informativeWindows: this.informativeWindows,
      stableCorrelatedWindows: this.stableCorrelatedWindows,
      probeCoverageRatio,
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
  RomanianConvergenceTracker,
};
