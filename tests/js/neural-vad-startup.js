'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../../web/src/extractor/neural-vad.js'), 'utf8');

function fixture(primaryError, fallbackError, primaryInferenceError, fallbackInferenceError) {
  const imports = [];
  let downloads = 0;
  let releases = 0;
  const runtime = (error, inferenceError) => ({
    env: { wasm: {} },
    Tensor: class {
      constructor(type, data) { this.data = data; }
      dispose() {}
    },
    InferenceSession: { create: async () => {
      if (error) throw error;
      return {
        run: async () => {
          if (inferenceError) throw inferenceError;
          return { output: { data: [.001], dispose() {} },
            stateN: { data: new Float32Array(256), dispose() {} } };
        },
        release: async () => { releases++; },
      };
    } },
  });
  const sandbox = {
    self: {}, Float32Array, BigInt64Array, Uint8Array, ArrayBuffer,
    importScripts: url => {
      imports.push(url);
      const fallback = url.startsWith('/fallback/');
      sandbox.self.ort = runtime(fallback ? fallbackError : primaryError,
        fallback ? fallbackInferenceError : primaryInferenceError);
    },
    fetch: async () => { downloads++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; },
    crypto: { subtle: { digest: async () => Uint8Array.from(Buffer.from(
      '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3', 'hex')) } },
  };
  vm.runInNewContext(source.replace('export default class NeuralVad', 'class NeuralVad')
    + '\nglobalThis.NeuralVad = NeuralVad;', sandbox);
  return { sandbox, imports, downloads: () => downloads, releases: () => releases };
}

(async () => {
  // Reproduce the currently observed initialization stage, without weakening
  // evidence thresholds or pretending the injected exception is a physical cause.
  const broken = fixture(new TypeError('Importing a module script failed.'));
  const recovered = await broken.sandbox.NeuralVad.create('/primary/', '/fallback/');
  assert.equal(recovered.initialization.fallbackAttempted, true);
  assert.equal(recovered.initialization.fallbackSucceeded, true);
  assert.equal(recovered.initialization.runtimeCode, 2);
  assert.equal(recovered.initialization.primaryFailureCode, 1);
  assert.equal(recovered.receivedSamples, 0, 'startup silence is not media evidence');
  assert.equal(recovered.count, 0, 'startup silence never leaks into a media probe');
  assert.equal(broken.downloads(), 1, 'the verified model must be reused, not re-fetched');
  assert.deepStrictEqual(broken.imports, ['/primary/ort.wasm.min.js', '/fallback/ort.wasm.min.js']);
  assert.equal(recovered.ort.env.wasm.numThreads, 1);
  assert.equal(recovered.ort.env.wasm.proxy, false);
  recovered.delete();
  assert.equal(broken.releases(), 1);

  const shared = fixture(new TypeError('shared WebAssembly.Memory is unsupported'));
  const safe = await shared.sandbox.NeuralVad.create('/primary/', '/fallback/');
  assert.equal(safe.initialization.primaryFailureCode, 3);
  safe.delete();

  const healthy = fixture();
  const normal = await healthy.sandbox.NeuralVad.create('/primary/', '/fallback/');
  assert.equal(normal.initialization.runtimeCode, 1);
  assert.equal(normal.initialization.fallbackAttempted, false);
  assert.equal(healthy.imports.length, 1, 'healthy primary runtime is not replaced');
  normal.delete();

  const coldInference = fixture(null, null, new Error('startup model execution failed'));
  const warmed = await coldInference.sandbox.NeuralVad.create('/primary/', '/fallback/');
  assert.equal(warmed.initialization.fallbackSucceeded, true);
  assert.equal(coldInference.releases(), 1, 'failed startup session is released before recovery');
  warmed.delete();
  assert.equal(coldInference.releases(), 2);

  const coldBoth = fixture(null, null, new Error('model execution failed'), new Error('model execution failed'));
  await assert.rejects(coldBoth.sandbox.NeuralVad.create('/primary/', '/fallback/'),
    error => error.voiceStage === 5 && !error.initialization.fallbackSucceeded);
  assert.equal(coldBoth.releases(), 2, 'both failed startup sessions must be released');

  const both = fixture(new Error('Out of memory'), new Error('failed to load wasm binary'));
  await assert.rejects(both.sandbox.NeuralVad.create('/primary/', '/fallback/'), error => {
    assert.equal(error.voiceStage, 4);
    assert.equal(error.voiceCode, 7);
    assert.equal(error.initialization.primaryFailureCode, 4);
    assert.equal(error.initialization.fallbackAttempted, true);
    assert.equal(error.initialization.fallbackSucceeded, false);
    return true;
  });
  assert.equal(both.imports.length, 2, 'recovery has one bounded attempt, never a loop');

  const corrupt = fixture(new Error('session should never be reached'));
  corrupt.sandbox.crypto.subtle.digest = async () => new Uint8Array(32);
  await assert.rejects(corrupt.sandbox.NeuralVad.create('/primary/', '/fallback/'),
    error => error.voiceStage === 3);
  assert.equal(corrupt.imports.length, 1, 'integrity failure must never trigger a bypass');

  console.log('Neural VAD startup recovery, warmup and fail-closed integrity: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
