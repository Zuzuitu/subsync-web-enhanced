const assert = require('assert');
const { makePrimaryWindows } = require('../../web/src/romanian-windows.js');
const { makeVoiceConfirmationWindows } = require('../../web/src/voice-confirmation-windows.js');
for (const duration of [600, 601, 3600, 4661.748, 6000, 7200, 10800, 14400]) {
  const primary = makePrimaryWindows(duration);
  const extra = makeVoiceConfirmationWindows(duration, primary);
  assert.equal(extra.length, 32);
  assert(Math.abs(extra.reduce((sum, [a, b]) => sum + b - a, 0) - 120) < 1e-8);
  for (const [a, b] of extra) assert(!primary.some(([c, d]) => a < d && b > c));
  assert.equal(makeVoiceConfirmationWindows(duration, primary.concat(extra)).length, 0);
}
assert.equal(makeVoiceConfirmationWindows(599, []).length, 0);
console.log('Voice confirmation windows: OK');
