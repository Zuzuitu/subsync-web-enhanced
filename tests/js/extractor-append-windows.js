'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Exercise the actual extractor state machine with a deterministic demux,
// without loading media codecs, Whisper, browser imports, or copyrighted data.
const source = fs.readFileSync(require.resolve('../../web/src/extractor/worker.js'), 'utf8');
const sandbox = { performance, logger: { log() {} }, handleException(_, error) { throw error; } };
vm.runInNewContext(source.slice(source.indexOf('class Extractor {'),
  source.indexOf('\nfunction handleException(')) + '\nglobalThis.Extractor = Extractor;', sandbox);

function extractor(windows) {
  const instance = new sandbox.Extractor();
  let position = 0;
  instance.pipeline = { demux: {
    seek(value) { position = value; }, start() {}, stop() {},
    getPosition() { return position; }, getDuration() { return 100; },
    step() { position++; instance.windowWordCount++; return position < 100; },
  } };
  instance.timeWindows = windows.map(window => window.slice());
  instance.windowIndex = 0;
  instance.timeWindow = instance.timeWindows[0];
  instance.windowWordCount = 0;
  instance.words = [];
  instance.subtitles = [];
  instance.startCurrentWindow();
  return instance;
}

(async () => {
  const voiced = extractor([[1, 3], [10, 12]]);
  let completeVoice;
  voiced.romanianSpeechRec = { discontinuity() {}, drainActivity: (start, end) => {
    assert.strictEqual(start, 1);
    assert.strictEqual(end, 3);
    return new Promise(resolve => { completeVoice = resolve; });
  } };
  const voiceRun = voiced.run();
  assert.strictEqual(voiced.windowIndex, 0,
    'must wait for asynchronous voice evidence before advancing the decoder');
  completeVoice([{ time: 1.125, energy: .8 }]);
  const voiceResult = await voiceRun;
  assert.strictEqual(voiceResult.windowCompleted.activity[0].time, 1.125);
  assert.strictEqual(voiced.windowIndex, 1);

  const pending = extractor([[1, 3], [10, 12]]);
  const first = await pending.run();
  assert.strictEqual(first.done, false);
  assert.strictEqual(first.windowCompleted.start, 1);
  const appended = pending.appendTimeWindows([[20, 22], [30, 32], [40, 42]]);
  assert.strictEqual(appended.resumed, false,
    'appending must not seek past the already-started final scheduled window');
  const starts = [];
  for (let i = 0; i < 4; i++) {
    const status = await pending.run();
    starts.push(status.windowCompleted.start);
    assert.strictEqual(status.windowCompleted.wordCount, 2);
    assert.strictEqual(status.done, i === 3);
  }
  assert.deepStrictEqual(starts, [10, 20, 30, 40]);

  const exhausted = extractor([[1, 3]]);
  assert.strictEqual((await exhausted.run()).done, true);
  assert.strictEqual(exhausted.appendTimeWindows([[10, 12]]).resumed, true);
  const resumed = await exhausted.run();
  assert.strictEqual(resumed.windowCompleted.start, 10);
  assert.strictEqual(resumed.windowCompleted.wordCount, 2);
  assert.strictEqual(resumed.done, true);
  assert.strictEqual(exhausted.appendTimeWindows([[20, 22]]).resumed, true);
  assert.strictEqual((await exhausted.run()).windowCompleted.start, 20);

  const eof = extractor([[98, 105]]);
  assert.strictEqual((await eof.run()).done, true);
  assert.strictEqual(eof.appendTimeWindows([[0, 2]]).resumed, true);
  const rewind = await eof.run();
  assert.strictEqual(rewind.windowCompleted.start, 0);
  assert.strictEqual(rewind.windowCompleted.wordCount, 2,
    'resuming at time zero must seek back instead of staying at EOF');

  const partial = extractor([[1, 5]]);
  assert.strictEqual((await partial.run(0)).done, false);
  assert.strictEqual(partial.appendTimeWindows([[10, 12]]).resumed, false);
  assert.strictEqual((await partial.run()).windowCompleted.start, 1);
  assert.strictEqual((await partial.run()).windowCompleted.start, 10);
  assert.strictEqual(partial.appendTimeWindows([[0, 0], [NaN, 5], null]).added, 0);
  console.log('Extractor append preserves pending, partial, exhausted and EOF windows: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
