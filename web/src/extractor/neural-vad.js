// Browser-local speech probabilities. PCM belongs to one bounded probe only.
const RATE = 16000;
const FRAME = 512;
const MAX_SAMPLES = RATE * 64;
const MODEL_SHA = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';

export default class NeuralVad {
  static async create(base) {
    // Stable numeric stages are safe to include in diagnostic exports:
    // 1 runtime script, 2 model fetch, 3 integrity, 4 WASM session.
    let stage = 1;
    try {
      importScripts(`${base}ort.wasm.min.js`);
      const ort = self.ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = base;
      stage = 2;
      const response = await fetch(`${base}silero_vad.onnx`);
      if (!response.ok) throw new Error('Voice detector download failed');
      const bytes = await response.arrayBuffer();
      stage = 3;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== MODEL_SHA) throw new Error('Voice detector integrity mismatch');
      stage = 4;
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      return new NeuralVad(ort, session);
    } catch (error) {
      const failure = new Error(String(error));
      failure.voiceStage = stage;
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

  push(samples, time) {
    if (this.closed || this.overflow || !Number.isFinite(time)) return;
    this.receivedSamples += samples.length;
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
