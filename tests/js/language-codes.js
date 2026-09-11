#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  findLanguage,
  canonicalizeLanguageCode,
} = require('../../web/src/language.js');

for (const code of ['ro', 'RO', 'rum', 'RON', 'ron']) {
  assert.strictEqual(
    canonicalizeLanguageCode(code),
    'rum',
    `Expected Romanian alias ${code} to canonicalize to rum`
  );
}

const romanian = findLanguage('ron');
assert(romanian, 'Expected ron to resolve to Romanian');
assert.strictEqual(romanian.name, 'Romanian');
assert.strictEqual(romanian.code2, 'ro');
assert.strictEqual(romanian.code3, 'rum');
assert(romanian.extraCodes.includes('ron'));
assert.strictEqual(
  romanian.enc[0],
  'Windows-1250',
  'Legacy Romanian subtitle fallback must remain Windows-1250'
);

assert.strictEqual(
  canonicalizeLanguageCode('ita'),
  'ita',
  'Known canonical codes must remain stable'
);
assert.strictEqual(
  canonicalizeLanguageCode('xyz'),
  'xyz',
  'Unknown metadata must not be silently rewritten'
);
assert.strictEqual(canonicalizeLanguageCode(undefined), undefined);

console.log('Romanian language aliases: OK');
