'use strict';
const assert = require('assert');
const {summarizeEnRoEvidence: assess} = require('../../web/src/en-ro-evidence.js');
const sample = {
  correlated: true, formula: {a: 1, b: 0},
  precision: {rawPoints: 6, fitPointTimes: [[20, 20], [40, 40], [120, 120], [140, 140], [220, 220], [240, 240]], fitPointTimesTruncated: false}
};
const original = JSON.stringify(sample);
const good = assess(sample, 300);
assert.strictEqual(good.available, true);
assert.deepStrictEqual(good.thirds.map(x => x.rawMatchCount), [2, 2, 2]);
assert.deepStrictEqual(good.thirds.map(x => x.medianSignedResidualSeconds), [0, 0, 0]);
assert.strictEqual(good.medianAbsoluteModelResidualSeconds, 0);
assert.strictEqual(good.referenceEvidenceSpanRatio, 220 / 300);
assert.strictEqual(good.largestReferenceEvidenceGapSeconds, 80);
assert.strictEqual(JSON.stringify(sample), original, 'read-only analysis must not mutate inputs');

const missingMiddle = assess({...sample, precision: {rawPoints: 4, fitPointTimes: [[20,20], [40,40], [220,220], [240,240]]}}, 300);
assert.deepStrictEqual(missingMiddle.thirds.map(x => x.rawMatchCount), [2, 0, 2]);
assert.strictEqual(missingMiddle.thirds[1].medianSignedResidualSeconds, null);
assert.strictEqual(missingMiddle.largestReferenceEvidenceGapSeconds, 180);
assert.strictEqual(missingMiddle.available, true);

const jump = assess({...sample, precision: {rawPoints: 6, fitPointTimes: [[20,20],[40,40],[120,132],[140,152],[220,232],[240,252]]}}, 300);
assert.strictEqual(jump.thirds[0].medianSignedResidualSeconds, 0);
assert.strictEqual(jump.thirds[1].medianSignedResidualSeconds, 12);
assert.strictEqual(jump.thirds[2].medianSignedResidualSeconds, 12);
assert(!Object.hasOwn(jump, 'cutDetected'), 'no false cut classification');

const dupe = assess({...sample,precision:{rawPoints:3,fitPointTimes:[[20,20],[20,20],[240,240]]}},300);
assert.strictEqual(dupe.rawMatchCount,3);
assert.strictEqual(dupe.distinctSubtitleTimestamps,2);

assert.strictEqual(assess({...sample,correlated:false},300).available, false);
assert.strictEqual(assess(sample,0).reason,'reference-duration-unavailable');
assert.strictEqual(assess({...sample,precision:{...sample.precision,fitPointTimesTruncated:true}},300).reason,'retained-points-truncated');
assert.strictEqual(assess({...sample,precision:{rawPoints:5,fitPointTimes:sample.precision.fitPointTimes}},300).reason,'retained-count-mismatch');
assert.strictEqual(assess({...sample,precision:{rawPoints:2,fitPointTimes:[[20,20],[NaN,55]]}},300).reason,'invalid-point-coordinates');
assert.strictEqual(assess({...sample,precision:{rawPoints:2,fitPointTimes:[[20,20],[-1,55]]}},300).reason,'negative-point-coordinate');
assert.strictEqual(assess({...sample,precision:{rawPoints:2,fitPointTimes:[[20,20],[350,350]]}},300).reason,'insufficient-in-range-points');
assert.strictEqual(assess({...sample,precision:{rawPoints:257,fitPointTimes:Array.from({length:257},()=>[1,1])}},300).reason,'insufficient-or-unbounded-points');
const poisoned={...sample, secret:'private path', precision:{...sample.precision, candidatePointTimes:[[111,999]],speech:'secret words'}};
assert(!/secret|private|999/.test(JSON.stringify(assess(poisoned,300))));
const trueFormula = {...sample, canonicalFormula:{a:1,b:10}};
assert.strictEqual(assess(trueFormula,300).thirds[0].medianSignedResidualSeconds,-10);
console.log('SubSync2 English -> Romanian read-only evidence regressions PASS');

// Deliberately research-only. This tests the guard without importing the detector into the PWA.
require('./en-ro-discontinuity-research.js');
