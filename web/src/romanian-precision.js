'use strict';

const {
  MIN_PRECISION_THIRD_SHARE,
  MAX_FORMULA_DELTA_SECONDS,
} = require('./romanian-convergence.js');
const { robustRetainedRefinement } = require('./romanian-robust.js');

const MAX_REFINEMENT_MAPPED_DELTA_SECONDS = MAX_FORMULA_DELTA_SECONDS;

function validFormula(formula) {
  return Boolean(
    formula
    && Number.isFinite(formula.a)
    && Number.isFinite(formula.b)
    && formula.a > 0
  );
}

function selectRomanianPrecisionRefinement(status, convergence, events, duration) {
  if (!status || !status.correlated || !convergence || !convergence.verified) {
    return null;
  }

  const precision = status.precision;
  if (!precision || !precision.available || !precision.refinementAvailable) {
    return null;
  }

  const buckets = Number(precision.buckets) || 0;
  const rawPoints = Number(precision.rawPoints) || 0;
  const counts = [
    Number(precision.beginningBuckets) || 0,
    Number(precision.middleBuckets) || 0,
    Number(precision.endBuckets) || 0,
  ];
  const total = counts.reduce((sum, count) => sum + count, 0);

  if (
    buckets <= 0
    || total !== buckets
    || rawPoints <= buckets
    || Math.min(...counts) / total < MIN_PRECISION_THIRD_SHARE
  ) {
    return null;
  }

  const mappedDeltaSeconds = Number(precision.refinementMappedDelta);
  if (
    !Number.isFinite(mappedDeltaSeconds)
    || mappedDeltaSeconds < 0
    || mappedDeltaSeconds > MAX_REFINEMENT_MAPPED_DELTA_SECONDS
  ) {
    return null;
  }

  if (!validFormula(precision.refinementFormula)) {
    return null;
  }

  const standard = {
    formula: {
      a: precision.refinementFormula.a,
      b: precision.refinementFormula.b,
    },
    mappedDeltaSeconds,
  };
  const robust = robustRetainedRefinement(
    precision, status.formula || standard.formula, standard.formula,
    events, duration, MAX_REFINEMENT_MAPPED_DELTA_SECONDS, MIN_PRECISION_THIRD_SHARE
  );
  return robust ? { ...robust, method: 'robust-retained-cues' } : standard;
}

module.exports = {
  MAX_REFINEMENT_MAPPED_DELTA_SECONDS,
  selectRomanianPrecisionRefinement,
};
