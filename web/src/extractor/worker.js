import Logger from '../logger.js';
const logger = Logger.logger;

import { expose } from 'comlink';
import Gizmo from '../gizmowrap.js';
import Pipeline from './pipeline.js';
import Assets from './assets.js';
import Filesystem from './fs.js';
import settings from '../settings.js';
import RomanianSpeechRecognition from './romanian-whisper.js';
const { canonicalizeLanguageCode } = require('../language.js');

class Extractor {

  async init(newSettings, name) {
    try {
      if (name) {
        logger.setPrefix(`[${name}]`);
      }

      if (newSettings) {
        settings.assign(newSettings);
      }

      if (!Gizmo.instance) {
        await Gizmo.init(require('../../scripts/extractor.js'));
        const FS = Gizmo.instance.FS;
        FS.mkdir('/work');
        FS.mkdir('/assets');
        FS.mount(FS.filesystems.IDBFS, {}, '/assets');
        logger.info('ready');
        return true;
      }
    } catch (e) {
      handleException('init:', e);
    }
  }

  async preloadAssets(assets, progressCb) {
    try {
      await Filesystem.syncfs(true);
      const results = [];
      for (const asset of assets) {
        results.push(await Assets.preloadAsset(asset, progressCb));
      }
      await Filesystem.syncfs(false);
      return results;
    } catch (e) {
      handleException('preloadAssets:', e);
    }
  }

  async getCachedAssets() {
    try {
      await Filesystem.syncfs(true);
      return Assets.getCachedAssets();
    } catch (e) {
      handleException('getCachedAssets:', e);
    }
  }

  async clearCachedAssets() {
    try {
      await Filesystem.syncfs(true);
      const result = Assets.clearCachedAssets();
      await Filesystem.syncfs(false);
      return result;
    } catch (e) {
      handleException('clearCachedAssets:', e);
    }
  }

  async syncfs() {
    try {
      await Filesystem.syncfs(true);
    } catch (e) {
      handleException('syncfs:', e);
    }
  }

  async getFileInfo(file) {
    let pipeline = undefined;
    try {
      const path = this.mountFile(file);
      pipeline = new Pipeline(path);
      return {
        duration: pipeline.demux.getDuration(),
        streams: pipeline.streams,
      }

    } catch (e) {
      handleException('getFileInfo:', e);

    } finally {
      pipeline && pipeline.destroy();
      Gizmo.instance.FS.unmount('/work');
    }
  }

  async open(stream, params) {
    logger.log('open', stream);

    try {
      const path = this.mountFile(stream.file);
      this.pipeline = new Pipeline(path);
      this.timeWindows = params.timeWindows && params.timeWindows.length
        ? params.timeWindows
        : [ params.timeWindow || [ 0, undefined ] ];
      this.windowIndex = 0;
      this.timeWindow = this.timeWindows[0];
      this.words = [];
      this.subtitles = [];
      this.windowWordCount = 0;

      stream.lang = canonicalizeLanguageCode(stream.lang);
      let romanianSpeechRec = null;
      if (stream.type === 'audio' && stream.lang === 'rum') {
        const model = Assets.getBinaryAsset({ type: 'asr', params: [ 'rum' ] });
        romanianSpeechRec = await RomanianSpeechRecognition.create(model);
        this.romanianSpeechRec = romanianSpeechRec;
      }

      const output = this.pipeline.makePipeline(
        stream, params, path, romanianSpeechRec
      );
      output.addWordsListener(word => {
        this.words.push(word);
        this.windowWordCount += 1;
      });

      if (params.postSubtitles) {
        this.pipeline.addSubsListener( subtitle => this.subtitles.push(subtitle) );
      }

      this.startCurrentWindow();

    } catch (e) {
      this.close();
      handleException('open:', e);
    }
  }

  startCurrentWindow() {
    const demux = this.pipeline.demux;
    const startTime = this.timeWindow[0] || 0;
    if (startTime) {
      demux.seek(startTime);
    }
    demux.start();
  }

  advanceTimeWindow() {
    if (this.windowIndex + 1 >= this.timeWindows.length) {
      return false;
    }

    const demux = this.pipeline.demux;
    demux.stop();
    this.windowIndex += 1;
    this.timeWindow = this.timeWindows[this.windowIndex];
    this.windowWordCount = 0;
    const startTime = this.timeWindow[0] || 0;
    if (startTime) {
      demux.seek(startTime);
    }
    demux.start();
    return true;
  }

  currentWindowSummary() {
    return {
      index: this.windowIndex,
      start: this.timeWindow[0] || 0,
      end: this.timeWindow[1] == null
        ? this.pipeline.demux.getDuration()
        : this.timeWindow[1],
      wordCount: this.windowWordCount,
    };
  }

  getWindowProgress(position) {
    const [ startTime, endTime ] = this.timeWindow;
    const windowEnd = endTime == null ? this.pipeline.demux.getDuration() : endTime;
    const den = windowEnd - startTime;
    const current = den ? Math.max(0, Math.min(1, (position - startTime) / den)) : 1;
    return (this.windowIndex + current) / this.timeWindows.length;
  }

  async run(timeout) {
    try{
      const demux = this.pipeline.demux;
      const ts = performance.now();
      const status = { progress: 1, done: true };
      let finished = false;

      while (!finished) {
        const [ , endTime ] = this.timeWindow;
        if (endTime != null && demux.getPosition() >= endTime) {
          if (this.romanianSpeechRec) {
            this.romanianSpeechRec.discontinuity();
          }
          status.windowCompleted = this.currentWindowSummary();
          if (this.advanceTimeWindow()) {
            status.done = false;
          } else {
            finished = true;
          }
          // Return at every window boundary so the main synchronizer can
          // evaluate convergence against exactly this window's evidence.
          break;
        }

        if (!demux.step()) {
          // Demux::step() flushes and emits a discontinuity at EOF. Sparse
          // probes may intentionally visit the end before earlier regions, so
          // EOF is only the end of the current probe, not necessarily the scan.
          status.windowCompleted = this.currentWindowSummary();
          if (this.advanceTimeWindow()) {
            status.done = false;
          } else {
            finished = true;
          }
          break;
        }

        if (timeout != null && (performance.now() - ts) >= timeout) {
          status.progress = this.getWindowProgress(demux.getPosition());
          status.done = false;
          break;
        }
      }

      if (this.words.length) {
        status.words = this.words;
        this.words = [];
      }
      if (this.subtitles.length) {
        status.subtitles = this.subtitles;
        this.subtitles = [];
      }

      if (status.done) {
        status.progress = 1;
        logger.log('finished');
      }
      return status;

    } catch (e) {
      handleException('run:', e);
    }
  }

  close() {
    logger.log('close');
    if (this.pipeline) {
      this.pipeline.destroy();
      this.pipeline = undefined;
      this.timeWindow = undefined;
      this.timeWindows = undefined;
      this.windowIndex = undefined;
      this.romanianSpeechRec = undefined;
      this.windowWordCount = undefined;
      Gizmo.instance.FS.unmount('/work');
    }
  }

  mountFile(file) {
    const FS = Gizmo.instance.FS;
    FS.mount(FS.filesystems.WORKERFS, { files: [ file ] }, '/work');
    return '/work/' + file.name;
  }
}

function handleException(msg, err) {
  if (typeof err === 'number') {
    err = Gizmo.instance.getCurrentException() || err;
  } else if (!(err instanceof Error)) {
    err = Object.assign(new Error(), err, {message: err.message, stack: err.stack});
  }
  logger.error(msg, err);
  throw err;
}

export default function() {
  logger.setPrefix('[Extractor]');
  return expose(new Extractor);
}
