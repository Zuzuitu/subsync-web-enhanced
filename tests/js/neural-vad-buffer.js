const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../../web/src/extractor/neural-vad.js'), 'utf8');
const sandbox = { module: { exports: {} }, Float32Array, BigInt64Array, Map, Number, Array, Object, Math };
vm.runInNewContext(source.replace('export default class NeuralVad', 'class NeuralVad') + '\nmodule.exports = NeuralVad;', sandbox);
const NeuralVad = sandbox.module.exports;
let calls = 0;
class Tensor {
  constructor(type, data, dims) { this.data = data; this.dims = dims; }
  dispose() {}
}
const session = {
  async run(feeds) {
    calls++;
    assert.equal(feeds.input.data.length, 576);
    assert.equal(feeds.state.data.length, 256);
    return { output: new Tensor('', [.8], []), stateN: new Tensor('', new Float32Array(256), []) };
  },
  async release() {},
};
(async () => {
  const rejectedStage = stage => error => error.voiceStage === stage;
  sandbox.importScripts = () => { throw new Error('runtime fixture'); };
  await assert.rejects(NeuralVad.create('/fixture/'), rejectedStage(1));
  sandbox.importScripts = () => {};
  sandbox.self = { ort: { env: { wasm: {} }, InferenceSession: {
    create: async () => { throw new Error('session fixture'); },
  } } };
  sandbox.fetch = async () => { throw new Error('fetch fixture'); };
  await assert.rejects(NeuralVad.create('/fixture/'), rejectedStage(2));
  sandbox.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  sandbox.crypto = { subtle: { digest: async () => new Uint8Array(32) } };
  await assert.rejects(NeuralVad.create('/fixture/'), rejectedStage(3));
  sandbox.crypto.subtle.digest = async () => Uint8Array.from(Buffer.from(
    '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3', 'hex'));
  await assert.rejects(NeuralVad.create('/fixture/'), rejectedStage(4));
  const detector = new NeuralVad({ Tensor }, session);
  const pcm = new Float32Array(256).fill(.3);
  detector.push(pcm, 10);
  pcm.fill(99);
  assert(Math.abs(detector.chunks[0].samples[0] - .3) < 1e-6, 'WASM view must be copied');
  detector.push(new Float32Array(256), 10.016);
  const activity = await detector.drain(10, 10.032);
  assert.equal(calls, 1, 'split callbacks must form one complete model frame');
  assert.equal(activity.length, 1);
  assert.equal(activity[0].time, 10.125);
  assert.equal(activity[0].energy, .8);
  assert.equal(detector.count, 0);
  detector.push(new Float32Array(256), 20);
  detector.push(new Float32Array(256), 22);
  await detector.drain(20, 23);
  assert.equal(calls, 1, 'must not join across missing audio');
  detector.push(new Float32Array(1024), 30);
  await detector.drain(30.032, 30.064);
  assert.equal(calls, 2, 'must exclude decoder preroll before the probe');
  detector.push(new Float32Array(16000 * 65), 40);
  assert.equal((await detector.drain(40, 105)).length, 0, 'overflow must fail closed');
  assert.equal(detector.overflowWindows, 1);
  detector.delete();
  let resume;
  let released = 0;
  const slow = new NeuralVad({ Tensor }, {
    run: () => new Promise(resolve => { resume = resolve; }),
    release: async () => { released++; },
  });
  slow.push(new Float32Array(512), 0);
  const pending = slow.drain(0, 1);
  slow.delete();
  assert.equal(released, 0, 'cancellation must not release a running session');
  resume({ output: new Tensor('', [.8], []), stateN: new Tensor('', new Float32Array(256), []) });
  assert.equal((await pending).length, 0, 'cancelled inference must not publish evidence');
  assert.equal(released, 1);
  slow.delete();
  assert.equal(released, 1, 'release must be idempotent');
  const invalid = new NeuralVad({ Tensor }, {
    run: async () => ({ output: new Tensor('', [NaN], []),
      stateN: new Tensor('', new Float32Array(256), []) }),
    release: async () => {},
  });
  invalid.push(new Float32Array(512), 0);
  await assert.rejects(invalid.drain(0, 1), /invalid probability/);
  invalid.delete();
  console.log('Neural VAD buffer: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
