import settings from '../settings.js';
import version from '../../version.json';
import Logger from '../logger.js';
import NeuralVad from './neural-vad.js';
import vadConfig from '../../../config/neural-vad.json';

const logger = Logger.logger.get('[RomanianWhisper]');
let modulePromise;

function locateFile(path) {
  let url = `${settings.url}scripts/${path}`;
  if (version.hash) {
    url += `?${version.hash}`;
  }
  return url;
}

function getFactory() {
  if (typeof self !== 'undefined' && typeof self.whisperGizmo === 'function') {
    return self.whisperGizmo;
  }
  if (typeof importScripts !== 'function') {
    throw new Error('Romanian Whisper module can only be loaded inside the extractor worker.');
  }

  importScripts(locateFile('whisper.js'));
  if (typeof self.whisperGizmo !== 'function') {
    throw new Error('Romanian Whisper JavaScript module did not initialize.');
  }
  return self.whisperGizmo;
}

async function getModule() {
  if (!modulePromise) {
    const factory = getFactory();
    modulePromise = factory({
      locateFile,
      print: logger.log.bind(logger),
      printErr: logger.warn.bind(logger),
    }).then(instance => {
      logger.log('module ready');
      return instance;
    });
  }
  return modulePromise;
}

export default class RomanianSpeechRecognition {
  static async create(modelBytes) {
    const module = await getModule();
    const recognition = new RomanianSpeechRecognition(module);
    const info = recognition.recognizer.systemInfo();
    if (!info || !info.includes('WASM_SIMD = 1')) {
      recognition.delete();
      throw new Error(
        'Romanian speech recognition requires WebAssembly SIMD support.'
      );
    }
    logger.log('runtime', info);
    recognition.recognizer.loadModel(modelBytes);
    try {
      recognition.vad = await NeuralVad.create(`${settings.url}scripts/vad/${vadConfig.directory}/`);
      recognition.voiceStatus.available = true;
    } catch (error) {
      recognition.voiceStatus.loadFailed = true;
      recognition.voiceStatus.failureStage = error.voiceStage || 4;
      logger.warn('Voice timing unavailable; retaining lexical verification', String(error));
    }
    return recognition;
  }

  constructor(module) {
    this.module = module;
    this.recognizer = new module.RomanianWhisperRecognition();
    this.listeners = [];
    this.voiceStatus = { attempted: true, available: false, loadFailed: false,
      inferenceFailed: false, failureStage: 0, windows: 0, emptyWindows: 0,
      sampleCount: 0, pcmSamples: 0, overflowWindows: 0 };
    this.recognizer.setWordsCallback(word => {
      for (const listener of this.listeners) {
        listener(word);
      }
    });
  }

  setLanguage(language) {
    this.recognizer.setLanguage(language);
  }

  setMinWordProb(value) {
    this.recognizer.setMinWordProb(value);
  }

  setMinWordLen(value) {
    this.recognizer.setMinWordLen(value);
  }

  addWordsListener(listener) {
    this.listeners.push(listener);
  }

  connectTranslator(translator) {
    this.addWordsListener(word => {
      translator.pushWordValues(
        word.text,
        word.time,
        word.duration || 0,
        word.score == null ? 1 : word.score
      );
    });
  }

  connectNgramSplitter(splitter) {
    this.addWordsListener(word => {
      splitter.pushWordValues(
        word.text,
        word.time,
        word.duration || 0,
        word.score == null ? 1 : word.score
      );
    });
  }

  connectPcmSink(sink) {
    sink.setFeedCallback((samples, startTime) => {
      if (this.vad) this.vad.push(samples, Number(startTime));
      this.recognizer.feed(samples, startTime);
    });
    sink.setFlushCallback(() => {
      this.recognizer.flush();
    });
    sink.setDiscontinuityCallback(() => {
      this.recognizer.discontinuity();
    });
  }

  discontinuity() {
    this.recognizer.discontinuity();
  }

  async drainActivity(start, end) {
    this.voiceStatus.windows++;
    if (!this.vad) return [];
    const detector = this.vad;
    this.voiceStatus.pcmSamples = detector.receivedSamples || 0;
    this.voiceStatus.overflowWindows = detector.overflowWindows || 0;
    try {
      const samples = await detector.drain(start, end);
      this.voiceStatus.sampleCount += samples.length;
      if (!samples.length) this.voiceStatus.emptyWindows++;
      return samples;
    } catch (error) {
      this.voiceStatus.available = false;
      this.voiceStatus.inferenceFailed = true;
      this.voiceStatus.failureStage = 5;
      logger.warn('Voice timing failed; retaining lexical verification', String(error));
      detector.delete();
      if (this.vad === detector) this.vad = null;
      return [];
    }
  }

  getVoiceStatus() {
    return { ...this.voiceStatus };
  }

  delete() {
    if (this.vad) this.vad.delete();
    this.vad = null;
    this.listeners = [];
    if (this.recognizer) {
      this.recognizer.delete();
      this.recognizer = null;
    }
  }
}
