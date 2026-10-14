// Browser-local speech probabilities. PCM belongs to one bounded probe only.
const RATE = 16000;
const FRAME = 512;
const MAX_SAMPLES = RATE * 64;
const MODEL_SHA = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';

// Numeric categories only: never export an exception's URLs, paths or text.
// 0 unknown, 1 module import, 2 WASM compile/link, 3 shared memory/threads,
// 4 allocation, 5 timeout, 6 model/session, 7 network/asset loading.
function failureCode(error) {
  const message = String(error);
  if (/sharedarraybuffer|shared.*memory|wasm.*threads|atomics/i.test(message)) return 3;
  if (/out of memory|allocation|bad_alloc|cannot enlarge memory/i.test(message)) return 4;
  if (/timeout|timed out/i.test(message)) return 5;
  if (/importing a module|dynamically imported module|module script|importscripts/i.test(message)) return 1;
  if (/compileerror|linkerror|webassembly\.(instantiate|compile)/i.test(message)) return 2;
  if (/fetch|network|download|load wasm binary/i.test(message)) return 7;
  if (/onnx|model|session/i.test(message)) return 6;
  return 0;
}

export default class NeuralVad {
  static async create(base, fallbackBase) {
    // Stable numeric stages are safe to include in diagnostic exports:
    // 1 runtime script, 2 model fetch, 3 integrity, 4 WASM session, 5 inference.
    let stage = 1;
    const started = Date.now();
    const initialization = { runtimeCode: 1, fallbackAttempted: false,
      fallbackSucceeded: false, primaryFailureCode: 0, initializationMs: 0 };
    const loadRuntime = runtimeBase => {
      importScripts(`${runtimeBase}ort.wasm.min.js`);
      const ort = self.ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.simd = true;
      ort.env.wasm.wasmPaths = runtimeBase;
      return ort;
    };
    const initialize = async (ort, bytes) => {
      stage = 4;
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      const detector = new NeuralVad(ort, session);
      try {
        // One real inference catches broken sessions before a long movie scan.
        // Synthetic startup silence is discarded, never timing evidence.
        stage = 5;
        detector.push(new Float32Array(FRAME), 0);
        const check = await detector.drain(0, FRAME / RATE);
        if (check.length !== 1) throw new Error('Voice detector startup inference failed');
        detector.receivedSamples = 0;
        return detector;
      } catch (error) {
        await session.release().catch(() => {});
        detector.session = null;
        throw error;
      }
    };
    try {
      let ort = loadRuntime(base);
      stage = 2;
      const response = await fetch(`${base}silero_vad.onnx`);
      if (!response.ok) throw new Error('Voice detector download failed');
      const bytes = await response.arrayBuffer();
      stage = 3;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== MODEL_SHA) throw new Error('Voice detector integrity mismatch');
      let detector;
      try {
        detector = await initialize(ort, bytes);
      } catch (error) {
        if (!fallbackBase || (stage !== 4 && stage !== 5)) throw error;
        initialization.primaryFailureCode = failureCode(error);
        initialization.fallbackAttempted = true;
        initialization.runtimeCode = 2;
        ort = null;
        // The official 1.18 SIMD binary is genuinely unshared and its classic
        // loader has no dynamic .mjs import. Use it only after primary failure,
        // once, with the SAME verified model and unchanged timing estimator.
        stage = 1;
        detector = await initialize(loadRuntime(fallbackBase), bytes);
        initialization.fallbackSucceeded = true;
      }
      initialization.initializationMs = Date.now() - started;
      detector.initialization = initialization;
      return detector;
    } catch (error) {
      const failure = new Error(String(error));
      failure.voiceStage = stage;
      failure.voiceCode = failureCode(error);
      initialization.initializationMs = Date.now() - started;
      failure.initialization = initialization;
      throw failure;
    }
  }

  constructor(ort, session) {
    this.ort = ort;
    this.session = session;
    this.chunks = [];
    this.count = 0;
    this.overflow = false;
    this.receivedSamples = 0;
    this.overflowWindows = 0;
  }

  beginProbe(start, end) {
    if (this.closed) return false;
    if (this.active) throw new Error('Cannot replace an active voice probe');
    this.chunks = [];
    this.count = 0;
    this.overflow = false;
    this.probe = Number.isFinite(start) && Number.isFinite(end) && end > start
      ? { start, end } : null;
    return Boolean(this.probe);
  }

  push(samples, time) {
    if (this.closed || this.overflow || !Number.isFinite(time)) return;
    this.receivedSamples += samples.length;
    // Backward seeking can return a long decoder preroll. Clip BEFORE copying
    // and applying the memory cap, so irrelevant audio cannot discard the
    // requested bounded probe. Whisper still receives the unmodified PCM.
    if (this.probe) {
      const first = Math.max(0, Math.ceil((this.probe.start - time) * RATE - 1e-6));
      const last = Math.min(samples.length, Math.floor((this.probe.end - time) * RATE + 1e-6));
      if (last <= first) return;
      samples = samples.subarray(first, last);
      time += first / RATE;
    }
    if (this.count + samples.length > MAX_SAMPLES) {
      this.chunks = [];
      this.count = 0;
      this.overflow = true;
      this.overflowWindows++;
      return;
    }
    // WASM's view becomes invalid/reused after the synchronous callback.
    this.chunks.push({ samples: new Float32Array(samples), time });
    this.count += samples.length;
  }

  drain(start, end) {
    if (this.closed) return Promise.resolve([]);
    if (this.active) return Promise.reject(new Error('Concurrent voice detector drain'));
    this.active = this.drainProbe(start, end).finally(() => {
      this.active = null;
      if (this.closed) this.release();
    });
    return this.active;
  }

  async drainProbe(start, end) {
    const chunks = this.chunks;
    const overflow = this.overflow;
    this.chunks = [];
    this.count = 0;
    this.overflow = false;
    if (overflow) return [];
    const bins = new Map();
    let state = new Float32Array(256);
    let context = new Float32Array(64);
    let pending = new Float32Array(0);
    let pendingTime = null;
    const Tensor = this.ort.Tensor;
    for (const chunk of chunks) {
      const first = Math.max(0, Math.ceil((start - chunk.time) * RATE - 1e-6));
      const last = Math.min(chunk.samples.length, Math.floor((end - chunk.time) * RATE + 1e-6));
      if (last <= first) continue;
      const time = chunk.time + first / RATE;
      if (pendingTime === null || Math.abs(time - (pendingTime + pending.length / RATE)) > .002) {
        state = new Float32Array(256);
        context = new Float32Array(64);
        pending = new Float32Array(0);
        pendingTime = time;
      }
      const joined = new Float32Array(pending.length + last - first);
      joined.set(pending);
      joined.set(chunk.samples.subarray(first, last), pending.length);
      let offset = 0;
      for (; offset + FRAME <= joined.length; offset += FRAME) {
        const input = new Float32Array(FRAME + 64);
        input.set(context);
        input.set(joined.subarray(offset, offset + FRAME), 64);
        const feeds = {
          input: new Tensor('float32', input, [1, FRAME + 64]),
          state: new Tensor('float32', state, [2, 1, 128]),
          sr: new Tensor('int64', BigInt64Array.from([16000n]), []),
        };
        let output;
        let probability;
        try {
          output = await this.session.run(feeds);
          probability = Number(output.output.data[0]);
          if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
            throw new Error('Voice detector returned an invalid probability');
          }
          state = new Float32Array(output.stateN.data);
          context = input.slice(input.length - 64);
        } finally {
          for (const tensor of Object.values(feeds)) tensor.dispose();
          for (const tensor of Object.values(output || {})) tensor.dispose();
        }
        if (this.closed) return [];
        const midpoint = pendingTime + (offset + FRAME / 2) / RATE;
        const index = Math.floor((midpoint - start) / .25);
        if (Number.isFinite(probability) && probability >= 0 && probability <= 1) {
          const bin = bins.get(index) || { sum: 0, count: 0 };
          bin.sum += probability;
          bin.count++;
          bins.set(index, bin);
        }
      }
      pending = joined.slice(offset);
      pendingTime += offset / RATE;
    }
    return Array.from(bins, ([index, bin]) => ({
      time: start + (index + .5) * .25,
      energy: bin.sum / bin.count,
    }));
  }

  delete() {
    this.closed = true;
    this.chunks = [];
    this.count = 0;
    if (!this.active) this.release();
  }

  release() {
    if (this.session) {
      this.session.release().catch(() => {});
      this.session = null;
    }
  }
}
