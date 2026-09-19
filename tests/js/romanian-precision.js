'use strict';

const assert = require('assert');
const {
  MAX_REFINEMENT_MAPPED_DELTA_SECONDS,
  selectRomanianPrecisionRefinement,
} = require('../../web/src/romanian-precision.js');

assert.strictEqual(MAX_REFINEMENT_MAPPED_DELTA_SECONDS, 0.75);

const convergence = { verified: true };
const balanced = {
  correlated: true,
  precision: {
    available: true,
    rawPoints: 27,
    buckets: 22,
    beginningBuckets: 8,
    middleBuckets: 8,
    endBuckets: 6,
    refinementAvailable: true,
    refinementFactor: 0.99999,
    refinementMaxDistance: 1.4,
    refinementMappedDelta: 0.2,
    refinementFormula: { a: 1.0001, b: -10.4 },
  },
};

assert.deepStrictEqual(
  selectRomanianPrecisionRefinement(balanced, convergence),
  {
    formula: { a: 1.0001, b: -10.4 },
    mappedDeltaSeconds: 0.2,
  },
  'verified balanced evidence with duplicate raw matches may use cue-balanced refinement'
);

assert.strictEqual(
  selectRomanianPrecisionRefinement(balanced, { verified: false }),
  null,
  'refinement must never run before verified canonical convergence'
);

assert.strictEqual(
  selectRomanianPrecisionRefinement({
    ...balanced,
    precision: {
      ...balanced.precision,
      beginningBuckets: 8,
      middleBuckets: 9,
      endBuckets: 5,
    },
  }, convergence),
  null,
  '8/9/5 remains too imbalanced to refine'
);

assert.strictEqual(
  selectRomanianPrecisionRefinement({
    ...balanced,
    precision: {
      ...balanced.precision,
      rawPoints: 22,
      buckets: 22,
    },
  }, convergence),
  null,
  'no duplicate-cue leverage means no refinement is needed'
);

assert.strictEqual(
  selectRomanianPrecisionRefinement({
    ...balanced,
    precision: {
      ...balanced.precision,
      refinementMappedDelta: 0.751,
    },
  }, convergence),
  null,
  'refinement may not move farther than the existing canonical formula-stability guard'
);

assert.strictEqual(
  selectRomanianPrecisionRefinement({
    ...balanced,
    precision: {
      ...balanced.precision,
      refinementFormula: { a: NaN, b: -10 },
    },
  }, convergence),
  null,
  'invalid refinement formulas must fail closed'
);

console.log('Romanian post-lock cue-balanced precision refinement: OK');
