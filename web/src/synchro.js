import { wrap, proxy } from 'comlink';
import webworkify from 'webworkify';
import Subtitles from './subtitle.js';
import settings from './settings.js';
import Logger from './logger.js';
import { annotateErrorStage, classifyErrorStage } from './diagnostics.js';
const {
  PRIMARY_WINDOWS,
  RESCUE_WINDOWS,
  LATE_CONFIRMATION_WINDOWS,
  makePrimaryWindows,
  makeRescueWindows,
  makeLateConfirmationWindows,
} = require('./romanian-windows.js');
const {
  RomanianConvergenceTracker,
  MIN_PROBE_COVERAGE_RATIO,
  REQUIRED_STABLE_CORRELATED_WINDOWS,
  needsLateConfirmation,
  needsPrecisionPolish,
} = require('./romanian-convergence.js');
const { RomanianContextAnchorStream } = require('./romanian-context-anchors.js');
const { selectRomanianPrecisionRefinement } = require('./romanian-precision.js');
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
    this.referenceDuration = Number(ref && ref.duration) || 0;
    this.romanianConvergence = null;
    this.romanianScan = null;
    this.romanianContextAnchors = null;
    this.diagnostics = {
      currentStage: null,
      stages: {},
      errors: [],
      subWords: 0,
      refWords: 0,
      subtitles: 0,
      romanianSubContextAnchors: 0,
      romanianRefContextAnchors: 0,
      precision: null,
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
        const romanianSameLanguage =
          ref.type === 'audio' && ref.lang === 'rum' && sub.lang === 'rum';
        const romanianPrimaryWindows = ref.type === 'audio' && ref.lang === 'rum'
          ? makePrimaryWindows(ref.duration)
          : null;
        if (romanianSameLanguage) {
          this.romanianContextAnchors = {
            sub: new RomanianContextAnchorStream(),
            ref: new RomanianContextAnchorStream(),
          };
        }
        if (romanianPrimaryWindows) {
          this.romanianScan = {
            duration: ref.duration,
            primaryWindows: romanianPrimaryWindows,
            primarySummaries: [],
            windowSummaries: [],
            scheduledWindows: romanianPrimaryWindows.map(window => window.slice()),
            rescueAdded: false,
            lateConfirmationAdded: false,
          };
          this.romanianConvergence = new RomanianConvergenceTracker(
            ref.duration,
            romanianPrimaryWindows.length + RESCUE_WINDOWS,
            {
              primaryWindows: romanianPrimaryWindows.length,
              baseRescueWindows: RESCUE_WINDOWS,
            }
          );
          this.diagnostics.romanianConvergence = this.romanianConvergence.getStatus();
          logger.log(
            `Romanian ASR adaptive scan: ${romanianPrimaryWindows.length} primary probes; `
            + `up to ${RESCUE_WINDOWS} content-aware rescue checks within the same 120 s rescue budget`
          );
        }
        await Promise.all([
          this.subExtractor.open(sub, { otherLang: ref.lang, postSubtitles: true }),
          ...refExtractors.map((ex, i) => ex.open(ref, {
            timeWindow: ref.duration && [ i * ref.duration / refJobsNo, (i + 1) * ref.duration / refJobsNo + 1 ],
            timeWindows: romanianPrimaryWindows,
          }))
        ]);
        this.recordStage(listener, 'pipeline-open', 'ready');
      } catch (e) {
        throw this.recordError(listener, annotateErrorStage(e, 'pipeline-open'));
      }

      this.recordStage(listener, 'processing', 'running');
      listener.onSyncStarted();
      await Promise.all(this.extractors.map( (ex, i) => this.runExtractor(ex, i, listener)) );

      this.applyRomanianPrecisionRefinement();

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
        const windowSummary = this.romanianScan
          ? { ...s.windowCompleted }
          : null;

        let rawStats;
        try {
          rawStats = await this.correlator.getStats(this.referenceDuration);
        } catch (e) {
          const err = this.recordError(listener, annotateErrorStage(e, 'correlation'));
          onError(err);
          return;
        }

        this.status = selectCanonicalStatus(this.status, rawStats);
        if (this.status && this.status.precision) {
          this.diagnostics.precision = { ...this.status.precision };
        }
        let convergence = this.romanianConvergence.observe(
          s.windowCompleted,
          s.windowCompleted.wordCount || 0,
          rawStats
        );
        if (windowSummary) {
          windowSummary.candidatePointGain = convergence.candidatePointGain || 0;
          windowSummary.candidatePoints = convergence.lastPoints || 0;
          windowSummary.candidateSpan = convergence.candidateProbeCoverageRatio || 0;
          windowSummary.canonicalSpan = convergence.probeCoverageRatio || 0;
          windowSummary.correlated = Boolean(rawStats && rawStats.correlated);
          this.romanianScan.windowSummaries.push(windowSummary);
          if (
            this.romanianScan.primarySummaries.length
            < this.romanianScan.primaryWindows.length
          ) {
            this.romanianScan.primarySummaries.push(windowSummary);
          }
        }
        this.diagnostics.romanianConvergence = convergence;

        logger.log(
          `Romanian ASR probe ${convergence.completedWindows}/${convergence.totalWindows}: `
          + `words=${convergence.lastWindowWords}, points=${convergence.lastPoints}, `
          + `candidateGain=${convergence.candidatePointGain}, `
          + `correlated=${Boolean(rawStats && rawStats.correlated)}, `
          + `canonicalGain=${convergence.lastPointGain}, stable=${convergence.stableCorrelatedWindows}, `
          + `candidateCoverage=${(100 * convergence.candidateProbeCoverageRatio).toFixed(1)}%, `
          + `canonicalCoverage=${(100 * convergence.probeCoverageRatio).toFixed(1)}%, `
          + `verified=${convergence.verified}`
        );

        const precisionForPolish = (
          this.status && this.status.precision
            ? this.status.precision
            : rawStats && rawStats.precision
        );
        const precisionPolishPending = Boolean(
          this.romanianScan
          && this.romanianScan.lateConfirmationAdded
          && convergence.verified
          && needsPrecisionPolish(precisionForPolish)
          && convergence.completedWindows < convergence.totalWindows
        );

        if (convergence.verified && this.gotAllSubs && !precisionPolishPending) {
          logger.log(
            `Romanian ASR adaptive convergence verified after ${convergence.completedWindows}/${convergence.totalWindows} probes`
          );
          this.progress[no] = 1;
          break;
        }

        if (precisionPolishPending) {
          const precision = precisionForPolish || {};
          logger.log(
            'Romanian canonical verification reached 3/3, but title-third evidence '
            + `remains imbalanced (${precision.beginningBuckets || 0}/`
            + `${precision.middleBuckets || 0}/${precision.endBuckets || 0}); `
            + 'continuing within the already-reserved late-confirmation budget'
          );
        }

        if (
          this.romanianScan
          && !this.romanianScan.rescueAdded
          && convergence.completedWindows === this.romanianScan.primaryWindows.length
        ) {
          const canonicalCoverageDeficit = (
            convergence.probeCoverageRatio > 0
            && convergence.probeCoverageRatio < MIN_PROBE_COVERAGE_RATIO
            && Number.isFinite(convergence.evidenceStart)
            && Number.isFinite(convergence.evidenceEnd)
          );
          const candidateCoverageDeficit = (
            !canonicalCoverageDeficit
            && convergence.candidateProbeCoverageRatio > 0
            && convergence.candidateProbeCoverageRatio < MIN_PROBE_COVERAGE_RATIO
            && Number.isFinite(convergence.candidateEvidenceStart)
            && Number.isFinite(convergence.candidateEvidenceEnd)
          );
          const coverageRecovery = canonicalCoverageDeficit || candidateCoverageDeficit;
          const coverageEvidenceStart = canonicalCoverageDeficit
            ? convergence.evidenceStart
            : convergence.candidateEvidenceStart;
          const coverageEvidenceEnd = canonicalCoverageDeficit
            ? convergence.evidenceEnd
            : convergence.candidateEvidenceEnd;
          const rescueWindows = makeRescueWindows(
            this.romanianScan.duration,
            this.romanianScan.primaryWindows,
            this.romanianScan.primarySummaries,
            {
              prioritizeCoverage: coverageRecovery,
              evidenceStart: coverageEvidenceStart,
              evidenceEnd: coverageEvidenceEnd,
            }
          );
          this.romanianScan.rescueStrategy = canonicalCoverageDeficit
            ? 'canonical-coverage'
            : candidateCoverageDeficit
              ? 'candidate-coverage'
              : 'content-aware';
          this.romanianScan.rescueAdded = true;
          this.romanianScan.scheduledWindows.push(
            ...rescueWindows.map(window => window.slice())
          );
          this.romanianConvergence.setBaseRescueWindows(rescueWindows.length);
          convergence = this.romanianConvergence.setTotalWindows(
            this.romanianScan.primaryWindows.length + rescueWindows.length
          );
          this.diagnostics.romanianConvergence = convergence;

          if (rescueWindows.length) {
            const appended = await extractor.appendTimeWindows(rescueWindows);
            if (appended && appended.resumed) {
              s.done = false;
              s.progress = this.romanianScan.primaryWindows.length
                / this.romanianConvergence.totalWindows;
              logger.log(
                `Romanian ASR primary stage remained noncanonical at ${convergence.lastPoints} points; `
                + `continuing with ${rescueWindows.length} ${this.romanianScan.rescueStrategy} rescue checks `
                + 'within the 120 s reserve'
              );
            }
          } else {
            logger.log(
              'Romanian ASR primary stage remained noncanonical and no suitable unused rescue gaps were available'
            );
          }
        }

        if (
          this.romanianScan
          && this.romanianScan.rescueAdded
          && !this.romanianScan.lateConfirmationAdded
          && needsLateConfirmation(
            convergence,
            Boolean((rawStats && rawStats.correlated) || (this.status && this.status.correlated))
          )
        ) {
          const canonicalCoverageDeficit = (
            convergence.probeCoverageRatio > 0
            && convergence.probeCoverageRatio < MIN_PROBE_COVERAGE_RATIO
            && Number.isFinite(convergence.evidenceStart)
            && Number.isFinite(convergence.evidenceEnd)
          );
          const confirmationWindows = makeLateConfirmationWindows(
            this.romanianScan.duration,
            this.romanianScan.scheduledWindows,
            this.romanianScan.windowSummaries,
            {
              prioritizeCoverage: canonicalCoverageDeficit,
              evidenceStart: convergence.evidenceStart,
              evidenceEnd: convergence.evidenceEnd,
              precision: this.status && this.status.precision
                ? { ...this.status.precision }
                : rawStats && rawStats.precision
                  ? { ...rawStats.precision }
                  : null,
            }
          );
          this.romanianScan.lateConfirmationAdded = true;

          if (confirmationWindows.length) {
            this.romanianScan.scheduledWindows.push(
              ...confirmationWindows.map(window => window.slice())
            );
            convergence = this.romanianConvergence.setTotalWindows(
              convergence.totalWindows + confirmationWindows.length
            );
            this.diagnostics.romanianConvergence = convergence;

            const appended = await extractor.appendTimeWindows(confirmationWindows);
            if (appended && appended.resumed) {
              s.done = false;
              s.progress = convergence.completedWindows / convergence.totalWindows;
              logger.log(
                `Romanian canonical lock arrived too late for ${REQUIRED_STABLE_CORRELATED_WINDOWS}/${REQUIRED_STABLE_CORRELATED_WINDOWS} verification; `
                + `appended ${confirmationWindows.length}/${LATE_CONFIRMATION_WINDOWS} fresh 30 s confirmation probes`
              );
            }
          } else {
            logger.log(
              'Romanian canonical lock arrived late, but no unused 30 s confirmation gaps were available'
            );
          }
        }
      }

      this.progress[no] = s.progress;
      if (s.done) {
        break;
      }
    }
  }

  applyRomanianPrecisionRefinement() {
    const convergence = this.diagnostics && this.diagnostics.romanianConvergence;
    const refinement = selectRomanianPrecisionRefinement(this.status, convergence);
    if (!refinement || !this.status.formula) {
      return false;
    }

    const canonicalFormula = { ...this.status.formula };
    const precision = {
      ...this.status.precision,
      refinementApplied: true,
    };
    this.status = {
      ...this.status,
      canonicalFormula,
      formula: { ...refinement.formula },
      precision,
    };
    this.diagnostics.precision = { ...precision };

    logger.log(
      'Romanian verified precision refinement applied: equal cue-bucket weighting, '
      + `max mapped delta=${refinement.mappedDeltaSeconds.toFixed(3)} s`
    );
    return true;
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

    if (this.romanianContextAnchors) {
      const anchor = this.romanianContextAnchors.sub.push(word);
      if (anchor) {
        this.diagnostics.romanianSubContextAnchors += 1;
        const anchorStatus = await this.correlator.addSubWord(anchor);
        this.status = selectCanonicalStatus(this.status, anchorStatus);
      }
    }
  }

  async addRefWord(word) {
    const status = await this.correlator.addRefWord(word);
    this.status = selectCanonicalStatus(this.status, status);

    if (this.romanianContextAnchors) {
      const anchor = this.romanianContextAnchors.ref.push(word);
      if (anchor) {
        this.diagnostics.romanianRefContextAnchors += 1;
        const anchorStatus = await this.correlator.addRefWord(anchor);
        this.status = selectCanonicalStatus(this.status, anchorStatus);
      }
    }
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
        romanianSubContextAnchors: this.diagnostics.romanianSubContextAnchors,
        romanianRefContextAnchors: this.diagnostics.romanianRefContextAnchors,
        romanianConvergence: this.diagnostics.romanianConvergence
          ? { ...this.diagnostics.romanianConvergence }
          : null,
        precision: this.diagnostics.precision
          ? { ...this.diagnostics.precision }
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

  getTimingReview() {
    return this.subtitles.getTimingReview(this.status.formula);
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
