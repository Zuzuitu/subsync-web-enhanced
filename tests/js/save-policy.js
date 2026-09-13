'use strict';

const assert = require('assert');
const {
  isRomanianAdaptivePending,
  isSaveReady,
  canSaveInconclusive,
} = require('../../web/src/save-policy.js');

const settings = {
  minPointsNo: 20,
  minCorrelation: 0.9999,
  maxPointDist: 2,
};

const pendingRomanian = {
  subReady: true,
  points: 20,
  factor: 1,
  maxDistance: 0,
  diagnostics: {
    romanianConvergence: {
      completedWindows: 9,
      totalWindows: 24,
      verified: false,
    },
  },
};

assert.strictEqual(isRomanianAdaptivePending(pendingRomanian), true);
assert.strictEqual(
  isSaveReady(pendingRomanian),
  false,
  'Romanian subtitles must not be saveable before adaptive lock'
);
assert.strictEqual(
  canSaveInconclusive(pendingRomanian, settings),
  false,
  'Romanian adaptive runs must not use the weaker legacy inconclusive-save fallback'
);

const verifiedRomanian = {
  ...pendingRomanian,
  diagnostics: {
    romanianConvergence: {
      completedWindows: 18,
      totalWindows: 24,
      verified: true,
    },
  },
};
assert.strictEqual(isSaveReady(verifiedRomanian), true);

const ordinaryLegacy = {
  subReady: false,
  points: 15,
  factor: 1,
  maxDistance: 1,
  diagnostics: {},
};
assert.strictEqual(
  canSaveInconclusive(ordinaryLegacy, settings),
  true,
  'non-Romanian legacy fallback behavior must remain unchanged'
);

console.log('Romanian adaptive save policy: OK');
