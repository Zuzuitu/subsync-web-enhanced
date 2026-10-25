'use strict';
const assert = require('assert');
const {studyIndependentStep: study} = require('../../web/src/en-ro-discontinuity-research.js');
function fixture(mode, count = 24) {
  const anchors = Array.from({length: count}, (_, i) => {
    const subtitleTime = 30 + i * 45;
    let residual = 0;
    if (mode === 'single-step') residual = i >= 12 ? 8 : 0;
    if (mode === 'affine-drift') residual = 0.008 * subtitleTime;
    if (mode === 'single-false-match' && i === 13) residual = 8;
    if (mode === 'two-steps') residual = i < 8 ? 0 : i < 16 ? 8 : 0;
    if (mode === 'noisy-step') residual = (i >= 12 ? 8 : 0) + (i % 2 ? 0.05 : -0.05);
    return {cueId: String(i+1), subtitleTime, referenceTime: subtitleTime + residual, independentlyVerified: true};
  });
  return {provenance: 'independently-verified-cue-pairs',formula:{a:1,b:0},durationSeconds:1200,anchors};
}
const clean = study(fixture('clean'));
assert.strictEqual(clean.supported, false, 'perfect affine data must not trigger a cut');
assert.strictEqual(study(fixture('affine-drift')).supported, false, 'linear drift is not a cut');
assert.strictEqual(study(fixture('single-false-match')).supported, false, 'one outlier is not a cut');
assert.strictEqual(study(fixture('two-steps')).supported, false, 'unsupported multiple changes fail closed');
for (const mode of ['single-step', 'noisy-step']) {
  const input = fixture(mode);
  const before = JSON.stringify(input);
  const result = study(input);
  assert.strictEqual(result.supported, true, mode);
  assert.strictEqual(result.verdict, 'possible-offset-step-not-a-confirmed-cut');
  assert(Math.abs(result.residualStepSeconds - 8) < 0.1);
  assert(!Object.hasOwn(result, 'correctedFormula'));
  assert.strictEqual(JSON.stringify(input), before, 'never mutate anchor inputs');
}
const sparse = fixture('single-step', 10);
assert.strictEqual(study(sparse).reason, 'insufficient-or-unbounded-anchors');
const unverified = fixture('single-step');
unverified.anchors[3].independentlyVerified = false;
assert.strictEqual(study(unverified).reason, 'invalid-anchor');
const fakeRaw = fixture('single-step');
fakeRaw.provenance = 'canonical-retained-matches';
assert.strictEqual(study(fakeRaw).reason, 'independent-provenance-required');
const duplicate = fixture('single-step');
duplicate.anchors[1].cueId = duplicate.anchors[0].cueId;
assert.strictEqual(study(duplicate).reason, 'duplicate-cue-provenance');
const privacy = fixture('single-step');
privacy.anchors[0].secretSubtitle = 'private movie transcript';
assert(!/private|movie|transcript/.test(JSON.stringify(study(privacy))));
const nonfinite = fixture('single-step');
nonfinite.anchors[0].referenceTime = NaN;
assert.strictEqual(study(nonfinite).reason, 'invalid-anchor');

// Adversarial train-only step: the held-out anchors remain perfectly affine,
// and must not be used to choose or validate a false hypothesis.
const deceptive = fixture('single-step');
deceptive.anchors.forEach((a, i) => {
  if (i % 2 === 1) a.referenceTime = a.subtitleTime;
});
assert.strictEqual(study(deceptive).supported, false, 'training-only jump must fail untouched heldout');
const reverseStep = fixture('single-step');
reverseStep.anchors.forEach((a, i) => {
  a.referenceTime = a.subtitleTime - (i >= 12 ? 8 : 0);
});
assert.strictEqual(study(reverseStep).supported, true, 'negative offset hypothesis supported');

// Deterministic adversarial matrix: synthetic fixtures only.
for (const mode of ['flat', 'slope', 'step8', 'stepMinus8', 'singleOutlier',
                    'twoSteps', 'alternatingNoise', 'missingAfter']) {
  for (let seed = 0; seed < 48; seed++) {
    const n = 24 + (seed % 3) * 8;
    const matrixAnchors = [];
    for (let i = 0; i < n; i++) {
      const time = 40 + 40 * i;
      const split = Math.floor(n / 2);
      if (mode === 'missingAfter' && i >= split) break;
      let delta = 0;
      if (mode === 'slope') delta = time * 0.007;
      if (mode === 'step8') delta = i >= split ? 8 : 0;
      if (mode === 'stepMinus8') delta = i >= split ? -8 : 0;
      if (mode === 'singleOutlier') delta = i === split ? 8 : 0;
      if (mode === 'twoSteps') delta =
        i >= Math.floor(n / 3) && i < Math.floor(2 * n / 3) ? 8 : 0;
      if (mode === 'alternatingNoise') delta = i % 2 ? 1.2 : -1.2;
      if (seed % 4 === 0) delta += ((i * 37 + seed) % 11 - 5) * 0.015;
      matrixAnchors.push({
        cueId: i + 1, subtitleTime: time,
        referenceTime: time + delta, independentlyVerified: true,
      });
    }
    const candidate = study({
      provenance: 'independently-verified-cue-pairs',
      formula: {a: 1, b: 0},
      durationSeconds: 40 + 40 * n + 60,
      anchors: matrixAnchors,
    });
    assert.strictEqual(candidate.supported, mode === 'step8' || mode === 'stepMinus8',
      'synthetic ' + mode + ' seed ' + seed);
  }
}
console.log('Read-only independent-evidence discontinuity research: PASS');
