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

// Independent cues with a valid y=x-10 timeline. Repeated words in nearby
// lines also generate contradictory -2.5 s matches. The native canonical
// gate has already accepted the title; post-lock fitting must not allow these
// plausible cross-cue pairs to bias every exported timestamp.
const events = [];
const pairs = [];
for (let i = 0; i < 26; i++) {
  const x = 100 + 190 * i;
  events.push({ start: x - 1, end: x + 1 });
  pairs.push([x, x - 10 + (i % 5 - 2) * 0.08]);
  if (i % 4 === 0) pairs.push([x, x - 12.5]);
}
const contaminated = {
  ...balanced,
  formula: { a: 1.00015, b: -10.9 },
  precision: {
    ...balanced.precision,
    rawPoints: pairs.length,
    buckets: 26,
    beginningBuckets: 9,
    middleBuckets: 9,
    endBuckets: 8,
    refinementFormula: { a: 1.00014, b: -10.72 },
    fitPointTimes: pairs,
  },
};
const corrected = selectRomanianPrecisionRefinement(
  contaminated, convergence, events, 5000
);
assert.strictEqual(corrected.method, 'robust-retained-cues');
assert(corrected.mappedDeltaSeconds <= MAX_REFINEMENT_MAPPED_DELTA_SECONDS + 1e-9);
const errorAt = (formula, x) => Math.abs(formula.a * x + formula.b - (x - 10));
assert(errorAt(corrected.formula, 100) < errorAt(contaminated.precision.refinementFormula, 100));
assert(errorAt(corrected.formula, 4900) < errorAt(contaminated.precision.refinementFormula, 4900));

// Less than twenty independent cues cannot authorize a second estimator,
// even when many duplicate raw word pairs appear convincing.
const sparse = selectRomanianPrecisionRefinement({
  ...contaminated,
  precision: {
    ...contaminated.precision,
    fitPointTimes: pairs.slice(0, 22),
  },
}, convergence, events, 5000);
assert.strictEqual(sparse.method, undefined);

// Good existing alignment is left alone when the robust candidate cannot
// improve the median retained-point residual by a meaningful amount.
const clean = selectRomanianPrecisionRefinement({
  ...contaminated,
  formula: { a: 1, b: -10 },
  precision: {
    ...contaminated.precision,
    refinementFormula: { a: 1, b: -10 },
    fitPointTimes: pairs.filter(pair => pair[1] > pair[0] - 12),
  },
}, convergence, events, 5000);
assert.strictEqual(clean.method, undefined);

console.log('Romanian robust retained-match precision: OK');
