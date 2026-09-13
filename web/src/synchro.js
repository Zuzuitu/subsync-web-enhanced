import { wrap, proxy } from 'comlink';
import webworkify from 'webworkify';
import Subtitles from './subtitle.js';
import settings from './settings.js';
import Logger from './logger.js';
import { annotateErrorStage, classifyErrorStage } from './diagnostics.js';
const {
  PRIMARY_WINDOWS,
  makeRomanianTimeWindows,
} = require('./romanian-windows.js');
const { RomanianConvergenceTracker } = require('./romanian-convergence.js');
const { selectCanonicalStatus } = require('./correlation-status.js');
const logger = Logger.logger.get('[Synchronizer]');

export default class Synchronizer {

  constructor() {
    this.correlator = wrap(webworkify(require('./correlator/worker.js')));
    this.subExtractor = wrap(webworkify(require('./extractor/worker.js')));
    this.refExtractors = [];
    this.extractors = [];
  }

  async ensureSubExtractorInitialized() {
    await this.subExtractor.init(settings, 'SubExtractor');
  }

  async getFileInfo(file) {
    await this.ensureSubExtractorInitialized();
    return await this.subExtractor.getFileInfo(file);
  }

  async getCachedAssets() {
    await this.ensureSubExtractorInitialized();
    return await this.subExtractor.getCachedAssets();
  }

  async clearCachedAssets() {
    await this.ensureSubExtractorInitialized();
    return await this.subExtractor.clearCachedAssets();
  }

  async run(sub, ref, listener) {
    this.running = true;
    this.progress = [];
    this.subtitles = new Subtitles();
    this.status = {};
    this.gotAllSubs = false;
    this.romanianConvergence = null;
    this.diagnostics = {
      currentStage: null,
      stages: {},
      errors: [],
      subWords: 0,
      refWords: 0,
      subtitles: 0,
    };

    try {
      this.recordStage(listener, 'initialization', 'running');
      const refJobsNo = calcRefJobsNo(ref);
      this.progress = new Array(refJobsNo + 1).fill(0);
      for (let i = this.refExtractors.length; i < refJobsNo; i++) {
        this.refExtractors.push(wrap(webworkify(require('./extractor/worker.js'))));
      }

      const refExtractors = this.refExtractors.slice(0, refJobsNo);
      this.extractors = [ this.subExtractor, ...refExtractors ];

      try {
        await Promise.all([
          this.correlator.init(settings.serialize()),
          this.subExtractor.init(settings.serialize(), 'SubExtractor'),
          ...refExtractors.map((ex, i) => ex.init(settings.serialize(), `RefExtractor${i}`)),
        ]);
        this.recordStage(listener, 'initialization', 'ready');
      } catch (e) {
        throw this.recordError(listener, annotateErrorStage(e, 'initialization'));
      }

      try {
        this.recordStage(listener, 'language-assets', 'running');
        if (await this.preloadAssets(sub, ref, listener)) {
          await Promise.all(refExtractors.map(ex => ex.syncfs()));
        }
        this.recordStage(listener, 'language-assets', 'ready');
      } catch (e) {
        throw this.recordError(listener, annotateErrorStage(e, 'language-assets'));
      }

      try {
        this.recordStage(listener, 'pipeline-open', 'running');
        const romanianWindows = ref.type === 'audio' && ref.lang === 'rum'
          ? makeRomanianTimeWindows(ref.duration)
          : null;
        if (romanianWindows) {
          this.romanianConvergence = new RomanianConvergenceTracker(
            ref.duration,
            romanianWindows.length,
            { primaryWindows: Math.min(PRIMARY_WINDOWS, romanianWindows.length) }
          );
          this.diagnostics.romanianConvergence = this.romanianConvergence.getStatus();
          logger.log(
            `Romanian ASR adaptive scan: ${Math.min(PRIMARY_WINDOWS, romanianWindows.length)} primary + `
            + `${Math.max(0, romanianWindows.length - PRIMARY_WINDOWS)} rescue windows`
          );
        }
        await Promise.all([
          this.subExtractor.open(sub, { otherLang: ref.lang, postSubtitles: true }),
          ...refExtractors.map((ex, i) => ex.open(ref, {
            timeWindow: ref.duration && [ i * ref.duration / refJobsNo, (i + 1) * ref.duration / refJobsNo + 1 ],
            timeWindows: romanianWindows,
          }))
        ]);
        this.recordStage(listener, 'pipeline-open', 'ready');
      } catch (e) {
        throw this.recordError(listener, annotateErrorStage(e, 'pipeline-open'));
      }

      this.recordStage(listener, 'processing', 'running');
      listener.onSyncStarted();
      await Promise.all(this.extractors.map( (ex, i) => this.runExtractor(ex, i, listener)) );
      this.recordStage(listener, 'processing', 'ready');
      this.recordStage(listener, 'correlation', 'ready', {
        points: this.status.points || 0,
        factor: this.status.factor || 0,
      });

    } finally {
      await Promise.all(this.extractors.map(ex => ex.close()));
      this.extractors = [];
    }
    return this.running;
  }

  stop() {
    this.running = false;
  }

  async runExtractor(extractor, no, listener) {
    const issub = extractor === this.subExtractor;
    const onNewWord = (issub ? this.addSubWord : this.addRefWord).bind(this);
    const onError = listener.onSyncError.bind(listener, issub ? 'sub' : 'ref');

    while (this.running) {
      let s;
      try {
        s = await extractor.run(2000);
      } catch (e) {
        const fallback = issub ? 'subtitle-decode' : 'processing';
        const err = this.recordError(listener, annotateErrorStage(e, fallback));
        logger.error(issub ? 'subExtractor:' : `refExtractor${no - 1}:`, err);
        onError(err);
        break;
      }

      if (this.running && s.subtitles) {
        this.diagnostics.subtitles += s.subtitles.length;
        for (const sub of s.subtitles) {
          this.subtitles.addSubtitle(sub);
        }
        if (s.done) {
          this.gotAllSubs = true;
        }
        try {
          await this.correlator.addSubtitles(s.subtitles);
        } catch (e) {
          const err = this.recordError(listener, annotateErrorStage(e, 'correlation'));
          onError(err);
          break;
        }
      }

      if (this.running && s.words) {
        if (issub) {
          this.diagnostics.subWords += s.words.length;
        } else {
          this.diagnostics.refWords += s.words.length;
        }

        const dp = ((s.progress || 0) - (this.progress[no] || 0)) * 2
          / (s.words.length * (s.words.length+1));

        for (const [i, word] of s.words.entries()) {
          this.progress[no] += dp * i;
          try {
            await onNewWord(word);
          } catch (e) {
            const err = this.recordError(listener, annotateErrorStage(e, 'correlation'));
            onError(err);
            return;
          }
          if (!this.running) {
            break;
          }
        }
      }

      if (!issub && this.romanianConvergence && s.windowCompleted) {
        let rawStats;
        try {
          rawStats = await this.correlator.getStats();
        } catch (e) {
          const err = this.recordError(listener, annotateErrorStage(e, 'correlation'));
          onError(err);
          return;
        }

        this.status = selectCanonicalStatus(this.status, rawStats);
        const convergence = this.romanianConvergence.observe(
          s.windowCompleted,
          s.windowCompleted.wordCount || 0,
          rawStats
        );
        this.diagnostics.romanianConvergence = convergence;

        logger.log(
          `Romanian ASR probe ${convergence.completedWindows}/${convergence.totalWindows}: `
          + `words=${convergence.lastWindowWords}, points=${convergence.lastPoints}, `
          + `correlated=${Boolean(rawStats && rawStats.correlated)}, `
          + `pointGain=${convergence.lastPointGain}, stable=${convergence.stableCorrelatedWindows}, `
          + `evidence=${convergence.evidenceStart == null ? 'n/a' : convergence.evidenceStart.toFixed(1)}-`
          + `${convergence.evidenceEnd == null ? 'n/a' : convergence.evidenceEnd.toFixed(1)}, `
          + `coverage=${(100 * convergence.probeCoverageRatio).toFixed(1)}%, `
          + `verified=${convergence.verified}`
        );

        if (convergence.verified && this.gotAllSubs) {
          logger.log(
            `Romanian ASR adaptive convergence verified after ${convergence.completedWindows}/${convergence.totalWindows} probes`
          );
          this.progress[no] = 1;
          break;
        }
      }

      this.progress[no] = s.progress;
      if (s.done) {
        break;
      }
    }
  }

  async preloadAssets(sub, ref, listener) {
    const assets = [];
    if (sub.lang && ref.lang && sub.lang !== ref.lang) {
      assets.push({ type: 'dict', params: [sub.lang, ref.lang].sort() });
    }
    if (ref.type === 'audio') {
      assets.push(ref.lang === 'rum'
        ? { type: 'asr', params: ['rum'] }
        : { type: 'speech', params: [ref.lang] });
    }
    if (assets.length) {
      logger.log('preloading assets', assets);
      const progressCb = proxy(event => {
        if (listener && listener.onAssetProgress) {
          listener.onAssetProgress(event);
        }
      });
      await this.subExtractor.preloadAssets(assets, progressCb);
      return true;
    }
  }

  async addSubWord(word) {
    const status = await this.correlator.addSubWord(word);
    this.status = selectCanonicalStatus(this.status, status);
  }

  async addRefWord(word) {
    const status = await this.correlator.addRefWord(word);
    this.status = selectCanonicalStatus(this.status, status);
  }

  recordStage(listener, stage, state, details) {
    if (!this.diagnostics) return;
    this.diagnostics.currentStage = stage;
    this.diagnostics.stages[stage] = {
      state,
      ...(details || {}),
    };
    if (listener && listener.onStageUpdate) {
      listener.onStageUpdate({
        stage,
        state,
        ...(details || {}),
      });
    }
  }

  recordError(listener, err) {
    const stage = err && err.stage
      ? err.stage
      : classifyErrorStage(err, 'unknown');
    const entry = {
      stage,
      message: err && err.message ? err.message : String(err),
      module: err && err.module ? err.module : null,
    };
    this.diagnostics.errors.push(entry);
    this.recordStage(listener, stage, 'error', {
      message: entry.message,
      module: entry.module,
    });
    return err;
  }

  getStatus() {
    return {
      ...this.status,
      subReady: this.status.correlated && this.gotAllSubs,
      progress: this.getProgress(),
      maxChange: this.subtitles.getMaxChange(this.status.formula),
      diagnostics: this.diagnostics ? {
        currentStage: this.diagnostics.currentStage,
        stages: { ...this.diagnostics.stages },
        errors: this.diagnostics.errors.slice(),
        subWords: this.diagnostics.subWords,
        refWords: this.diagnostics.refWords,
        subtitles: this.diagnostics.subtitles,
        romanianConvergence: this.diagnostics.romanianConvergence
          ? { ...this.diagnostics.romanianConvergence }
          : null,
      } : null,
    };
  }

  getProgress() {
    let progress = this.progress[0];
    const refs = this.progress.slice(1);
    if (refs.length) {
      const pr = refs.reduce((sum, pr) => sum + (pr || 0), 0) / refs.length;
      progress = Math.min(progress || 0, pr);
    }
    return progress || 0;
  }

  getSynchronizedSubtitles(format) {
    const formula = this.status.formula;
    if (formula) {
      return this.subtitles.getSynchronizedSubtitles(formula, format);
    }
  }
}

Synchronizer.instance = new Synchronizer();

function calcRefJobsNo(stream) {
  if (stream.type === 'audio' && stream.lang === 'rum') {
    // Each worker owns an independent Whisper context/model. Keep Romanian
    // recognition single-worker on memory-constrained browsers until measured
    // multi-context iPhone/WebKit evidence justifies a higher cap.
    return 1;
  }

  let jobsNo = settings.jobsNo || settings.defaultJobsNo;
  if (stream.duration == null) {
    jobsNo = 1;
  } else if (stream.duration / 60 < jobsNo) {
    jobsNo = Math.trunc(stream.duration / 60) || 1;
  }
  return jobsNo;
}
