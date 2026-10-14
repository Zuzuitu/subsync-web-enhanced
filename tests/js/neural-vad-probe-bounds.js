'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../../web/src/extractor/neural-vad.js'), 'utf8');
const sandbox = { module: { exports: {} }, Float32Array, BigInt64Array, Map, Number, Array, Object, Math };
vm.runInNewContext(source.replace('export default class NeuralVad', 'class NeuralVad') +
  '\nmodule.exports = NeuralVad;', sandbox);
const NeuralVad = sandbox.module.exports;
class Tensor {
  constructor(type, data, dims) { this.data = data; this.dims = dims; }
  dispose() {}
}
const session = { run: async () => ({ output: new Tensor('', [.8], []),
  stateN: new Tensor('', new Float32Array(256), []) }), release: async () => {} };
(async () => {
  const detector = new NeuralVad({ Tensor }, session);
  // Matroska backward seeking may decode far before the requested interval.
  // That input must not exhaust the 64-second buffer for a 15-second probe.
  detector.beginProbe(70, 85);
  detector.push(new Float32Array(16000 * 70), 0);
  detector.push(new Float32Array(16000 * 15), 70);
  assert.equal(detector.count, 16000 * 15, 'preroll must not consume the voice probe buffer');
  assert.equal(detector.overflowWindows, 0);
  assert.equal((await detector.drain(70, 85)).length, 60);
  detector.beginProbe(100, 100.032);
  const overlapping = new Float32Array(1536).fill(.3);
  detector.push(overlapping, 99.968);
  overlapping.fill(99);
  assert.equal(detector.count, 512, 'both leading preroll and trailing audio must be clipped');
  assert.equal(detector.chunks[0].time, 100);
  assert(Math.abs(detector.chunks[0].samples[0] - .3) < 1e-6,
    'clipped samples must still copy the temporary WASM view');
  detector.push(new Float32Array(16000 * 70), 101);
  assert.equal(detector.overflowWindows, 0, 'postroll must not consume memory either');
  assert.equal((await detector.drain(100, 100.032)).length, 1);
  detector.beginProbe(200, 201);
  detector.push(new Float32Array(1024), 200);
  detector.beginProbe(300, 301);
  assert.equal(detector.count, 0, 'new probes must not inherit old PCM');
  detector.push(new Float32Array(512), 200);
  assert.equal(detector.count, 0, 'old callbacks outside the new interval are ignored');
  detector.push(new Float32Array(512), 300);
  assert.equal((await detector.drain(300, 301)).length, 1);
  detector.beginProbe(400, 470);
  detector.push(new Float32Array(16000 * 65), 400);
  assert.equal(detector.overflowWindows, 1, 'the actual 64-second memory cap is unchanged');
  assert.equal((await detector.drain(400, 470)).length, 0, 'oversized useful probes remain fail-closed');
  detector.delete();
  assert.equal(detector.beginProbe(0, 1), false, 'closed detectors must not reopen');
  console.log('Neural VAD probe bounds: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
