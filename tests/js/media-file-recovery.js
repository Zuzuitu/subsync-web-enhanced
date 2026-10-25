'use strict';
const assert = require('assert');
const { webcrypto, randomUUID } = require('crypto');
const { inspectMediaFile } = require('../../web/src/media-file.js');
const crypto = { subtle: webcrypto.subtle, randomUUID };
const nativeError = () => ({ message: "can't open multimedia file: invalid data", module: 'Demux.avformat_open_input', averror: 'AVERROR_INVALIDDATA', code: '-1094995529', source: 'demux.cpp:53' });
function fixture(size = 2 * 1024 * 1024 + 29) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  bytes.set([0, 0, 0, 32, 102, 116, 121, 112], 0);
  return new File([bytes], 'pistă audio (1963).mp4', { type: 'video/mp4', lastModified: 123456789 });
}
function storage(options = {}) {
  let chunks = [], fileName;
  const state = { writes: [], removed: 0, opened: 0, aborted: 0 };
  const handle = {
    async createWritable() {
      state.opened++;
      return {
        async write(bytes) {
          state.writes.push(bytes.length);
          if (options.writeFail) throw new Error('disk full');
          chunks.push(bytes.slice());
        },
        async close() {},
        async abort() { state.aborted++; },
      };
    },
    async getFile() {
      const snapshot = new File(chunks, fileName);
      if (options.corrupt) {
        const bytes = new Uint8Array(await snapshot.arrayBuffer());
        bytes[bytes.length - 1] ^= 1;
        return new File([bytes], fileName);
      }
      if (options.truncate) return new File([new Uint8Array(12)], fileName);
      return snapshot;
    },
  };
  const directory = {
    async getFileHandle(name) { fileName = name; return handle; },
    async removeEntry() { state.removed++; },
  };
  return {
    state,
    api: {
      async estimate() { return { quota: options.quota || 1000000000, usage: 0 }; },
      async getDirectory() { return { async getDirectoryHandle() { return directory; } }; },
    },
  };
}
async function main() {
  const file = fixture();
  let calls = 0;
  const direct = await inspectMediaFile(file, async f => { calls++; assert.strictEqual(f, file); return { streams: ['aac'] }; }, { storage: { getDirectory() { throw Error('must not copy a valid direct input'); } } });
  assert.strictEqual(calls, 1);
  assert.strictEqual(direct.recovered, false);
  await direct.release();

  const disk = storage();
  calls = 0;
  let announced = 0;
  const recovered = await inspectMediaFile(file, async f => {
    if (++calls === 1) throw nativeError();
    assert.notStrictEqual(f, file);
    assert.strictEqual(f.name, file.name);
    assert.strictEqual(f.type, file.type);
    assert.strictEqual(f.lastModified, file.lastModified);
    assert.deepStrictEqual(new Uint8Array(await f.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
    return { duration: 5669.418, streams: ['aac'] };
  }, { storage: disk.api, crypto, onRecovery() { announced++; } });
  assert.strictEqual(recovered.recovered, true);
  assert.strictEqual(calls, 2);
  assert.strictEqual(announced, 1);
  assert.strictEqual(recovered.info.duration, 5669.418);
  assert.deepStrictEqual(disk.state.writes, [1048576, 1048576, 29]);
  await recovered.release(); await recovered.release();
  assert.strictEqual(disk.state.removed, 1);

  for (const fault of [{ corrupt: true }, { truncate: true }, { writeFail: true }, { quota: 42 }]) {
    const broken = storage(fault);
    calls = 0;
    await assert.rejects(inspectMediaFile(file, async () => { calls++; throw nativeError(); }, { storage: broken.api, crypto }), error => {
      assert.strictEqual(error.module, 'Demux.avformat_open_input');
      assert.strictEqual(error.code, '-1094995529');
      assert.strictEqual(error.source, 'demux.cpp:53');
      assert.strictEqual(error.localReadRecovery.attempted, true);
      return true;
    });
    assert.strictEqual(calls, 1, 'bad copies must never reach FFmpeg');
    if (!fault.quota) assert.strictEqual(broken.state.removed, 1);
    if (fault.writeFail) assert.strictEqual(broken.state.aborted, 1);
  }

  const stillBad = storage();
  calls = 0;
  await assert.rejects(inspectMediaFile(file, async () => { calls++; throw nativeError(); }, { storage: stillBad.api, crypto }), error => error.module === 'Demux.avformat_open_input' && error.localReadRecovery.module === error.module);
  assert.strictEqual(calls, 2, 'a corrupt container gets at most one verified retry');
  assert.strictEqual(stillBad.state.removed, 1);

  const cancelled = storage();
  await assert.rejects(inspectMediaFile(file, async () => { throw nativeError(); }, { storage: cancelled.api, crypto, isCurrent: () => false }), error => error.localReadRecovery.message === 'File selection changed.');
  assert.strictEqual(cancelled.state.removed, 1);

  for (const error of [{ module: 'AudioDec', code: '-1094995529' }, { module: 'Demux.avformat_find_stream_info', code: '-1094995529' }, { module: 'Demux.avformat_open_input', code: '-2' }]) {
    await assert.rejects(inspectMediaFile(file, async () => { throw error; }), actual => actual === error);
  }
  const invalid = new File(['not a media container'], 'broken.mp4');
  const original = nativeError();
  await assert.rejects(inspectMediaFile(invalid, async () => { throw original; }), actual => actual === original);
  const unavailable = await inspectMediaFile(file, async () => { throw nativeError(); }, { storage: null }).catch(e => e);
  assert.match(unavailable.localReadRecovery.message, /unavailable/);
  const unreadable = { size: 12, slice() { return { async arrayBuffer() { return new ArrayBuffer(0); } }; } };
  await assert.rejects(inspectMediaFile(unreadable, async () => { throw nativeError(); }), e => /read completely/.test(e.localReadRecovery.message));
  console.log('Media import: direct path, byte-exact bounded retry, quota/write/verification failures, cancellation and native error preservation: PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
