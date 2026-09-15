import { el, mount, setAttr } from 'redom';
import i18n from 'es2015-i18n-tag';
import SaveSubtitlesPopup from './saveSubsPopup.jsx';
import { ProgressBar, simpleList } from './components.jsx';
import { Overlay } from './overlay.jsx';
import Router from '../router.js';
import Synchronizer from '../synchro.js';
import settings from '../settings.js';
import languages from '../data/languages.json';
import { makeFailureDiagnosis, stageLabel } from '../diagnostics.js';
const {
  isRomanianAdaptivePending,
  isSaveReady,
  canSaveInconclusive,
} = require('../save-policy.js');
import { timeStampFmt, timeStampFractionFmt, lineFormulaFmt, streamTypeName } from '../utils.js';
import Logger from '../logger.js';
import runtimeVersion from '../../version.json';
const { diagnosticReport } = require('../timing-review.js');
const logger = Logger.logger.get('[SyncScreen]');

export default class SyncScreen {

  constructor() {
    this.subReady = false;
    this.errors = {};
    this.updateTimer = null;
    this.assetStates = {};
    this.stageStates = {};
    this.fatalError = null;
    this.startTime = performance.now();

    <div this='el'>
      <h1>{i18n`Synchronization`}</h1>
      <p>
        <span this='state'>{i18n`Initializing...`}</span>
        <ProgressBar this='progressBar' />
      </p>
      <div this='assetPanel' class='asset_panel' hidden>
        <strong>Language data</strong>
        <ul this='assetList' />
      </div>
      <div this='diagnosticPanel' class='diagnostic_panel' hidden>
        <strong>Diagnostics</strong>
        <p>
          Stage: <span this='diagnosticStage'>-</span>
        </p>
        <p this='diagnosticEvidence'>Waiting for processing evidence...</p>
        <p this='diagnosticReason' class='diagnostic_reason' hidden />
      </div>
      <dl>
        <dt this='errorsTitle' hidden>{i18n`Errors:`}</dt>
        <dd this='errorsBody' hidden>
          { this.errorMsgs = simpleList('ul', 'li', {class: 'error'}) }
          <a onclick={this.showSyncErrors.bind(this)}>{i18n`Show more`}</a>
        </dd>
        <dt>{i18n`Subtitle:`}</dt>
        <dd><span this='subName' /></dd>
        <dt>{i18n`Reference:`}</dt>
        <dd><span this='refName' /></dd>
        <dt>
          <a this='showDetailsBtn' onclick={this.showDetails.bind(this, true)}>
            {i18n`Show details`}
          </a>
          <span this='detailsHeader' hidden>{i18n`Details:`}</span>
        </dt>
        <dd this='detailsBody' hidden>
          <ul>
            <li>{i18n`elapsed`}: <strong this='elapsed'>-</strong></li>
            <li>{i18n`synchronization points`}: <strong this='points'>-</strong></li>
            <li>{i18n`correlation`}: <strong this='correlation'>-</strong></li>
            <li>{i18n`formula`}: <strong this='formula'>-</strong></li>
            <li>{i18n`max change`}: <strong this='maxChange'>-</strong></li>
            <li this='canonicalAcceptanceRow' hidden>
              canonical acceptance: <strong this='canonicalAcceptance'>-</strong>
            </li>
            <li this='precisionEvidenceRow' data-diagnostic='precision-evidence' hidden>
              precision evidence: <strong this='precisionEvidence'>-</strong>
            </li>
            <li this='precisionRobustnessRow' data-diagnostic='precision-robustness' hidden>
              formula sensitivity: <strong this='precisionRobustness'>-</strong>
            </li>
          </ul>
          <a this='hideDetailsBtn' onclick={this.showDetails.bind(this, false)}>{i18n`hide`}</a>
        </dd>
      </dl>
      <p this='message' />
      <details this='timingReviewPanel' data-review='timing' hidden>
        <summary>Review timing changes</summary>
        <p this='timingReviewNote' />
        <ul this='timingReviewSamples' />
        <p>These are timing changes, not measured accuracy. Check these scenes in your player.
          Automatic correction for cut scenes or different editions is not available yet.</p>
      </details>
      <p this='timingReviewWarning' role='status' hidden />
      <div class='buttons'>
        <button this='stopBtn' disabled>{i18n`Stop`}</button>
        <button this='backBtn' hidden>{i18n`Back`}</button>
        <button this='saveBtn' class='highlight' disabled>{i18n`Save subtitles`}</button>
        <button this='reportBtn' disabled>Download diagnostic report</button>
      </div>
      <p>No media, filenames or subtitle text in the diagnostic report. Nothing is uploaded.</p>
    </div>;

    this.stopBtn.onclick = this.stop.bind(this);
    this.backBtn.onclick = Router.update.bind(Router, 'input');
    this.saveBtn.onclick = () => new SaveSubtitlesPopup(this.out).show();
    this.reportBtn.onclick = this.downloadReport.bind(this);
  }

  update({sub, ref}) {
    this.out = {
      fileName: ref.file.name,
      lang: sub.lang
    };
    this.subName.textContent = this.renderStreamDescription(sub);
    this.refName.textContent = this.renderStreamDescription(ref);
    this.run(sub, ref);
  }

  async run(sub, ref) {
    try {
      var finished = await Synchronizer.instance.run(sub, ref, this);
    } catch (e) {
      logger.error('run:', e);
      this.fatalError = e;
      Overlay.showErrorPopup(i18n`Synchronization failed`, e);
      var finished = false;
    }
    this.updateStatusDone(Synchronizer.instance.getStatus(), finished);
  }

  stop() {
    Synchronizer.instance.stop();
    this.stopBtn.disabled = true;
    this.setState(i18n`Terminating...`);
  }

  showDetails(show) {
    this.showDetailsBtn.hidden = show;
    this.detailsHeader.hidden = !show;
    this.detailsBody.hidden = !show;
  }

  renderStreamDescription(s) {
    return `${s.file.name}, ${i18n`stream`} ${s.no + 1}: ${streamTypeName(s.type)}`;
  }

  onunmount() {
    clearTimeout(this.updateTimer);
  }

  onAssetProgress(event) {
    if (!event || !event.asset || !event.asset.name) {
      return;
    }

    this.assetStates[event.asset.name] = event;
    this.assetPanel.hidden = false;
    this.renderAssetProgress();

    if (event.state === 'downloading') {
      this.setState('Preparing language data...');
      if (event.totalBytes) {
        this.progressBar.value = Math.min(1, (event.loadedBytes || 0) / event.totalBytes);
      }
    } else if (event.state === 'extracting') {
      this.setState('Extracting language data...');
      this.progressBar.value = 1;
    } else if (event.state === 'verifying') {
      this.setState('Verifying language data...');
      this.progressBar.value = 1;
    } else if (event.state === 'storing') {
      this.setState('Storing language data locally...');
      this.progressBar.value = 1;
    } else if (event.state === 'cached') {
      this.setState('Using cached language data...');
      this.progressBar.value = 1;
    } else if (event.state === 'ready') {
      this.setState('Language data ready');
      this.progressBar.value = 1;
    }
  }

  renderAssetProgress() {
    this.assetList.textContent = '';
    for (const name of Object.keys(this.assetStates)) {
      const event = this.assetStates[name];
      const item = document.createElement('li');
      item.dataset.assetName = name;
      item.dataset.assetState = event.state || 'unknown';

      const label = document.createElement('strong');
      label.textContent = assetLabel(event.asset);
      item.appendChild(label);
      item.appendChild(document.createTextNode(': ' + assetStateText(event)));
      this.assetList.appendChild(item);
    }
  }

  onStageUpdate(event) {
    if (!event || !event.stage) {
      return;
    }

    this.stageStates[event.stage] = event;
    this.diagnosticPanel.hidden = false;
    const stateText = event.state === 'ready'
      ? 'ready'
      : event.state === 'error'
        ? 'error'
        : 'running';
    this.diagnosticStage.textContent = `${stageLabel(event.stage)} — ${stateText}`;
    setAttr(this.diagnosticStage, {
      class: event.state === 'error' ? 'sync_fail' : '',
    });
  }

  onSyncStarted() {
    this.progressBar.value = 0;
    this.setState(i18n`Synchronizing...`);
    this.updateTimer = setInterval(() => this.updateStatus(Synchronizer.instance.getStatus()), 1000);
    this.stopBtn.disabled = false;
  }

  setState(message, mark, sclass) {
    let m = '';
    if (mark === true) {
      m = '\u2714 ';
    } else if (mark === false) {
      m = '\u2716 ';
    }
    this.state.textContent = m + message;
    setAttr(this.state, { class: sclass });
  }

  updateStatus(status, finished) {
    const elapsed = performance.now() - this.startTime;
    this.elapsed.textContent = timeStampFmt(Math.trunc(elapsed / 1000));

    if (status.progress != null) {
      this.progressBar.value = status.progress;
    }

    this.renderDiagnosticEvidence(status);

    if (status && status.correlated != null) {
      this.points.textContent = status.points;
      this.correlation.textContent = (status.factor * 100).toFixed(2) + ' %';
      this.formula.textContent = lineFormulaFmt(status.formula);
      this.maxChange.textContent = timeStampFractionFmt(status.maxChange);
      this.renderPrecisionDetails(status);

      if (isSaveReady(status) && !this.subReady) {
        this.subReady = true;
        this.saveBtn.disabled = false;
        this.setState(
          i18n`Got initial synchronization, you could save subtitles already or wait for better result`,
          true, 'sync_success');
      }
    }
  }

  updateStatusDone(status, finished) {
    this.updateStatus(status, finished);
    this.stopBtn.hidden = true;
    this.backBtn.hidden = false;
    clearTimeout(this.updateTimer);

    if (isSaveReady(status)) {
      this.diagnosticReason.hidden = true;
      if (status.maxChange && status.maxChange > 0.5) {
        this.setState(i18n`Subtitles synchronized`, true, 'sync_success');
        if (Object.keys(this.errors).length) {
          mount(this.state, <span class='sync_fail'> {i18n`with errors`}</span>);
        }
      } else {
        this.setState(i18n`No need to synchronize`, true, 'sync_success');
      }
      this.saveBtn.disabled = false;
    } else if (finished) {
      this.renderFailureDiagnosis(status);
      if (canSaveInconclusive(status, settings)) {
        this.setState(i18n`Synchronization inconclusive`);
        this.saveBtn.disabled = false;
      } else if (isRomanianAdaptivePending(status)) {
        this.setState(i18n`Synchronization inconclusive`);
        this.saveBtn.disabled = true;
        if (this.diagnosticReason.hidden) {
          const convergence = status.diagnostics.romanianConvergence;
          this.diagnosticPanel.hidden = false;
          this.diagnosticReason.textContent =
            `Romanian adaptive verification did not gather enough canonical evidence. `
            + `Save stays disabled to avoid exporting an intermediate timing formula `
            + `(probes ${convergence.completedWindows}/${convergence.totalWindows}, `
            + `points ${convergence.lastPoints || status.points || 0}).`;
          this.diagnosticReason.hidden = false;
        }
      } else {
        this.setState(i18n`Couldn't synchronize`, false, 'sync_fail');
      }
    } else if (this.fatalError) {
      this.renderFailureDiagnosis(status);
      this.setState(i18n`Synchronization failed`, false, 'sync_fail');
    } else {
      this.setState(i18n`Synchronization terminated`);
    }
    this.renderTimingReview(status, finished);
  }

  renderTimingReview(status, finished) {
    const review = Synchronizer.instance.getTimingReview();
    this.reviewReport = diagnosticReport(status, review, {
      runtime: runtimeVersion,
      browser: navigator.userAgent,
      elapsedSeconds: (performance.now() - this.startTime) / 1000,
      outcome: this.fatalError ? 'failed' : finished ? 'completed' : 'stopped',
    });
    this.reportBtn.disabled = false;
    this.timingReviewPanel.hidden = !review.available;
    this.timingReviewNote.textContent = isSaveReady(status)
      ? 'Current accepted linear correction — start and end of each sample cue.'
      : 'Provisional correction only — this preview does not enable Save.';
    this.timingReviewSamples.textContent = '';
    for (const sample of review.samples) {
      const range = (start, end) => `${timeStampFractionFmt(start)} – ${timeStampFractionFmt(end)}`;
      const shift = `${sample.shiftSeconds >= 0 ? '+' : ''}${sample.shiftSeconds.toFixed(3)} s`;
      mount(this.timingReviewSamples, el('li',
        `${sample.position}, cue ${sample.cue}: ${range(sample.beforeStart, sample.beforeEnd)}`
        + ` → ${range(sample.afterStart, sample.afterEnd)} (${shift})`));
    }
    this.timingReviewWarning.hidden = !review.backwardStarts && !review.invalidCues;
    this.timingReviewWarning.textContent =
      `Timeline review: ${review.backwardStarts} backward start-time jumps; ${review.invalidCues} invalid cues. `
      + 'File order alone does not prove an edition mismatch. The linear correction does not repair timeline resets.';
  }

  downloadReport() {
    if (!this.reviewReport) return;
    let url;
    let link;
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(this.reviewReport, null, 2) + '\n'],
        {type: 'application/json'}));
      link = el('a', {href: url, download: 'subsync2-diagnostics.json', hidden: true});
      document.body.appendChild(link);
      link.click();
    } catch (error) {
      Overlay.showErrorPopup('Could not download diagnostic report', error);
    } finally {
      if (link) link.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  renderDiagnosticEvidence(status) {
    const diagnostics = status && status.diagnostics;
    if (!diagnostics) {
      return;
    }
    this.diagnosticPanel.hidden = false;
    const subCount = diagnostics.subtitles || 0;
    const subWords = diagnostics.subWords || 0;
    const refWords = diagnostics.refWords || 0;
    const convergence = diagnostics.romanianConvergence;
    const rescueText = convergence && convergence.rescueWindowsTotal
      ? convergence.rescueWindowsCompleted > 0
        ? ` · rescue: ${convergence.rescueWindowsCompleted}/${convergence.rescueWindowsTotal}`
        : convergence.completedWindows >= convergence.primaryWindows
          ? ` · rescue: ready 0/${convergence.rescueWindowsTotal}`
          : ''
      : '';
    const anchorText = convergence
      ? ` · context anchors: ${diagnostics.refWords ? diagnostics.romanianRefContextAnchors || 0 : 0}`
      : '';
    const convergenceText = convergence
      ? ` · Romanian probes: ${convergence.completedWindows}/${convergence.totalWindows}`
        + rescueText
        + ` · stable checks: ${convergence.stableCorrelatedWindows}`
        + ` · last probe words: ${convergence.lastWindowWords || 0}`
        + ` · points: ${convergence.lastPoints || 0}`
        + ` · candidate gain: +${convergence.candidatePointGain || 0}`
        + ` · candidate span: ${Math.round(100 * (convergence.candidateProbeCoverageRatio || 0))}%`
        + ` · canonical span: ${Math.round(100 * (convergence.probeCoverageRatio || 0))}%`
        + ` · adaptive lock: ${convergence.verified ? 'verified' : 'pending'}`
      : '';
    this.diagnosticEvidence.textContent =
      `Decoded subtitles: ${subCount} · subtitle words: ${subWords} · reference words: ${refWords}`
      + anchorText
      + convergenceText;
  }

  renderPrecisionDetails(status) {
    const precision = status && (
      status.precision
      || (status.diagnostics && status.diagnostics.precision)
    );

    const canonical = Boolean(status && status.correlated);
    this.canonicalAcceptanceRow.hidden = !canonical;
    if (canonical) {
      this.canonicalAcceptance.textContent = 'accepted';
    }

    if (!canonical || !precision || !precision.available) {
      this.precisionEvidenceRow.hidden = true;
      this.precisionRobustnessRow.hidden = true;
      return;
    }

    const beginning = Number(precision.beginningBuckets) || 0;
    const middle = Number(precision.middleBuckets) || 0;
    const end = Number(precision.endBuckets) || 0;
    const buckets = Number(precision.buckets) || 0;
    const rawPoints = Number(precision.rawPoints) || 0;
    const samples = Number(precision.jackknifeSamples) || 0;

    this.precisionEvidence.textContent =
      `${buckets} cue buckets · thirds ${beginning}/${middle}/${end} · raw matches ${rawPoints}`;
    this.precisionRobustness.textContent =
      `leave-one-cue max ${formatPrecisionSeconds(precision.maxMappedDelta)} · median ${formatPrecisionSeconds(precision.medianMappedDelta)} · slope max ${formatPrecisionPpm(precision.maxSlopeDeltaPpm)} · ${samples} checks`;

    this.precisionEvidenceRow.hidden = false;
    this.precisionRobustnessRow.hidden = false;
  }

  renderFailureDiagnosis(status) {
    const diagnosis = makeFailureDiagnosis(status || {}, settings);
    if (!diagnosis) {
      return;
    }
    this.diagnosticPanel.hidden = false;
    this.diagnosticStage.textContent = stageLabel(diagnosis.stage);
    this.diagnosticReason.textContent = `${diagnosis.title}. ${diagnosis.detail}`;
    this.diagnosticReason.hidden = false;
    setAttr(this.diagnosticReason, {
      class: diagnosis.kind === 'error'
        ? 'diagnostic_reason sync_fail'
        : 'diagnostic_reason',
    });
  }

  onSyncError(src, err) {
    const msg = syncErrorToString(src, err);
    let group = this.errors[msg];
    if (!group) {
      this.errors[msg] = group = {};
      this.errorMsgs.update(Object.keys(this.errors));
    }
    let fields = group[err.message];
    if (!fields) {
      group[err.message] = fields = {};
    }
    if (typeof err === 'object') {
      for (const key in err) {
        if (key !== 'message') {
          let field = fields[key];
          if (!field) {
            fields[key] = field = new Set();
          }
          field.add(err[key]);
        }
      }
    }

    if (!this.errorsVisible) {
      this.errorsTitle.hidden = false;
      this.errorsBody.hidden = false;
      this.errorsVisible = true;
    }
  }

  showSyncErrors() {
    const content = [];
    for (const [msg, errs] of Object.entries(this.errors)) {
      content.push(<p>{msg}</p>);
      const description = parseErrorsDescription(errs);
      if (description) {
        content.push(<pre>{description}</pre>);
      }
    }
    Overlay.showPopup(i18n`Synchronization errors`, content);
  }
}

function parseErrorsDescription(errors) {
  const details = [];
  for (const [msg, fields] of Object.entries(errors)) {
    details.push(msg);
    for (const key in fields) {
      const vals = Array.from(fields[key]).sort();
      const val = vals.slice(0, 10).join(', ') + (vals.length > 10 ? '...' : '');
      details.push(`${key}: ${val}`);
    }
  }
  return details.join('\n');
}

function syncErrorToString(source, err) {
  const module = typeof err.module === 'string' ? err.module : '';
  const stage = err && err.stage;

  if (stage === 'language-assets') {
    return 'Language data could not be loaded';
  }
  if (stage === 'demux') {
    return source === 'sub'
      ? 'Could not read the subtitle container'
      : 'Could not read the reference container';
  }
  if (stage === 'audio-decode') {
    return 'Reference audio decoding failed';
  }
  if (stage === 'resampler') {
    return 'Reference audio resampling failed';
  }
  if (stage === 'speech-recognition') {
    return 'Speech recognition failed';
  }
  if (stage === 'dictionary') {
    return 'Dictionary / translation processing failed';
  }
  if (stage === 'correlation') {
    return 'Correlation failed';
  }

  if (source === 'sub') {
    if (module.startsWith('SubtitleDec.decode')) {
      return i18n`Some subtitles can't be decoded (invalid encoding?)`;
    } else {
      return i18n`Error during subtitles read`;
    }
  } else if (source === 'ref') {
    if (module.startsWith('SubtitleDec.decode')) {
      return i18n`Some reference subtitles can't be decoded (invalid encoding?)`;
    } else {
      return i18n`Error during reference read`;
    }
  } else {
    return i18n`Unexpected error occurred`;
  }
}


function assetLabel(asset) {
  const langName = code => {
    const lang = languages.find(item => item.code3 === code);
    return lang ? lang.name : code;
  };

  if (asset.type === 'speech') {
    return `${langName(asset.params[0])} speech model`;
  }
  if (asset.type === 'asr') {
    return `${langName(asset.params[0])} local speech model (Whisper)`;
  }
  if (asset.type === 'dict') {
    return `${asset.params.map(langName).join(' ↔ ')} dictionary`;
  }
  return asset.name;
}

function assetStateText(event) {
  const bytes = event.totalBytes || event.loadedBytes || null;
  const size = bytes ? ` · ${formatBytes(bytes)}` : '';

  if (event.state === 'cached') {
    return 'Cached' + size;
  }
  if (event.state === 'ready') {
    return 'Ready' + size;
  }
  if (event.state === 'extracting') {
    return 'Extracting' + size;
  }
  if (event.state === 'verifying') {
    return 'Verifying SHA-256' + size;
  }
  if (event.state === 'storing') {
    return 'Storing locally' + size;
  }
  if (event.state === 'downloading') {
    if (event.totalBytes) {
      const percent = Math.round(100 * (event.loadedBytes || 0) / event.totalBytes);
      return `Downloading ${formatBytes(event.loadedBytes || 0)} / ${formatBytes(event.totalBytes)} (${percent}%)`;
    }
    return `Downloading ${formatBytes(event.loadedBytes || 0)}`;
  }
  return event.state || 'Preparing';
}

function formatPrecisionSeconds(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) ? `${Math.round(1000 * value)} ms` : '-';
}

function formatPrecisionPpm(ppm) {
  const value = Number(ppm);
  return Number.isFinite(value) ? `${Math.round(value)} ppm` : '-';
}


function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
