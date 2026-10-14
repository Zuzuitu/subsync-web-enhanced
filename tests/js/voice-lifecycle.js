'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../../web/src/extractor/romanian-whisper.js'), 'utf8');
const sandbox = { logger: { warn() {} } };
vm.runInNewContext(source.slice(source.indexOf('export default class'))
  .replace('export default class', 'class') + '\nglobalThis.Recognition = RomanianSpeechRecognition;', sandbox);
class Recognizer { setWordsCallback() {} }
(async () => {
  const rec = new sandbox.Recognition({ RomanianWhisperRecognition: Recognizer });
  rec.voiceStatus.loadFailed = true;
  assert.equal((await rec.drainActivity(0, 1)).length, 0);
  assert.equal(rec.getVoiceStatus().loadFailed, true);
  rec.voiceStatus.loadFailed = false;
  rec.voiceStatus.available = true;
  rec.vad = { drain: async () => [{ time: .125, energy: .8 }] };
  await rec.drainActivity(0, 1);
  assert.equal(rec.getVoiceStatus().sampleCount, 1);
  rec.vad.drain = async () => [];
  await rec.drainActivity(1, 2);
  assert.equal(rec.getVoiceStatus().emptyWindows, 1);
  let released = false;
  rec.vad = { drain: async () => { throw new Error('fixture'); }, delete() { released = true; } };
  await rec.drainActivity(2, 3);
  assert(released);
  assert.equal(rec.getVoiceStatus().inferenceFailed, true);
  assert.equal(rec.getVoiceStatus().available, false);
  assert.equal(rec.getVoiceStatus().windows, 4);
  assert.equal(rec.getVoiceStatus().sampleCount, 1);
  const copy = rec.getVoiceStatus(); copy.sampleCount = 999;
  assert.equal(rec.getVoiceStatus().sampleCount, 1);
  console.log('Voice lifecycle diagnostics: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
