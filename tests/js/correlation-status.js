'use strict';

const assert = require('assert');
const { selectCanonicalStatus } = require('../../web/src/correlation-status.js');

const initial = {};
const inconclusive = {
  correlated: false,
  points: 12,
  factor: 0.98,
  formula: { a: 1, b: -3 },
};
assert.strictEqual(selectCanonicalStatus(initial, inconclusive), inconclusive);

const canonical = {
  correlated: true,
  points: 20,
  factor: 0.99995,
  formula: { a: 1, b: -8 },
};
assert.strictEqual(selectCanonicalStatus(inconclusive, canonical), canonical);

const degraded = {
  correlated: false,
  points: 21,
  factor: 0.997,
  formula: { a: 1, b: -4 },
};
assert.strictEqual(
  selectCanonicalStatus(canonical, degraded),
  canonical,
  'a degraded candidate must not replace the last canonical formula'
);

const improved = {
  correlated: true,
  points: 23,
  factor: 0.99999,
  formula: { a: 1.00001, b: -8.05 },
};
assert.strictEqual(
  selectCanonicalStatus(canonical, improved),
  improved,
  'a later canonical correlation should replace the previous canonical formula'
);

console.log('Canonical correlation status selection: OK');
