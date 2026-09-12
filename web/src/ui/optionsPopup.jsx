import { el } from 'redom';
import i18n from 'es2015-i18n-tag';
import { Overlay, OverlayItem } from './overlay.jsx';
import { infoButton } from './components.jsx';
import settings from '../settings.js';
import Synchronizer from '../synchro.js';
import languages from '../data/languages.json';
import { version } from '../../version.json';

export default class OptionsPopup extends OverlayItem {

  constructor() {
    super(i18n`Advanced options`, true);
    const descriptions = getDescriptions();

    // Own the option view instances explicitly. Relying on nested custom JSX
    // `this=` refs leaves these views undefined with the current REDOM JSX
    // transform even though refs on native DOM elements work correctly.
    this.windowSize = new MinNumberOption({ min: 5, step: 1 });
    this.jobsNo = new NumberOption({ min: 1, step: 1 });
    this.maxPointDist = new NumberOption({ min: 0, step: 0.01 });
    this.minPointsNo = new NumberOption({ min: 0, step: 1 });
    this.minWordLen = new NumberOption({ min: 0, step: 1 });
    this.minWordsSim = new NumberOption({ min: 0, max: 1, step: 0.01 });
    this.minCorrelation = new NumberOption({ min: 0, max: 1, step: 0.00001 });
    this.minWordProb = new NumberOption({ min: 0, max: 1, step: 0.01 });

    // Keep cache UI references explicit too. This popup predates the current
    // browser build and nested JSX refs are not reliable here.
    this.cacheSummary = <p>Checking downloaded language data...</p>;
    this.cacheList = <ul />;
    this.clearCacheBtn = <button disabled>Clear downloaded language data</button>;
    this.clearCacheBtn.onclick = this.clearLanguageCache.bind(this);

    this.content = <div>
      <dl class='options'>
        <dt>{i18n`Max adjustment`} ({i18n`min`}):</dt>
        <dd>
          {this.windowSize}
          {infoButton(i18n`Max adjustment`, descriptions.windowSize)}
        </dd>
        <dt>{i18n`Extractor jobs no`}:</dt>
        <dd>
          {this.jobsNo}
          {infoButton(i18n`Extractor jobs no`, descriptions.jobsNo)}
        </dd>
        <dt>{i18n`Max points distance`}:</dt>
        <dd>
          {this.maxPointDist}
          {infoButton(i18n`Max points distance`, descriptions.maxPointDist)}
        </dd>
        <dt>{i18n`Min points no`}:</dt>
        <dd>
          {this.minPointsNo}
          {infoButton(i18n`Min points no`, descriptions.minPointsNo)}
        </dd>
        <dt>{i18n`Min word length`}:</dt>
        <dd>
          {this.minWordLen}
          {infoButton(i18n`Min word length`, descriptions.minWordLen)}
        </dd>
        <dt>{i18n`Min words similarity`}:</dt>
        <dd>
          {this.minWordsSim}
          {infoButton(i18n`Min words similarity`, descriptions.minWordsSim)}
        </dd>
        <dt>{i18n`Min correlation factor`}:</dt>
        <dd>
          {this.minCorrelation}
          {infoButton(i18n`Min correlation factor`, descriptions.minCorrelation)}
        </dd>
        <dt>{i18n`Min speech recognition score`}:</dt>
        <dd>
          {this.minWordProb}
          {infoButton(i18n`Min speech recognition score`, descriptions.minWordProb)}
        </dd>
      </dl>
      <section class='language_cache'>
        <h2>Language data</h2>
        {this.cacheSummary}
        {this.cacheList}
        {this.clearCacheBtn}
      </section>
      <p><em>subsync version {version}</em></p>
      <div class='buttons'>
        <button onclick={this.save.bind(this)} class='highlight'>{i18n`OK`}</button>
        <button onclick={this.hide.bind(this)}>{i18n`Cancel`}</button>
        <button onclick={this.init.bind(this, settings.defaults)}>{i18n`Restore defaults`}</button>
      </div>
    </div>;

    this.jobsNo.setDefaultValue(settings.defaultJobsNo);
    this.keys = settings.keys.filter(key => key in this);
    this.init(settings);
    this.refreshLanguageCache();
  }

  init(settings) {
    for (const key of this.keys) {
      this[key].setValue(settings[key]);
    }
  }

  save() {
    for (const key of this.keys) {
      settings[key] = this[key].getValue();
    }
    settings.save();
    this.hide();
  }

  async refreshLanguageCache() {
    try {
      const assets = await Synchronizer.instance.getCachedAssets();
      this.cacheList.textContent = '';

      if (!assets.length) {
        this.cacheSummary.textContent = 'No downloaded language data.';
        this.clearCacheBtn.disabled = true;
        return;
      }

      const knownBytes = assets.reduce((sum, asset) => sum + (asset.bytes || 0), 0);
      const unknownCount = assets.filter(asset => !asset.bytes).length;
      this.cacheSummary.textContent =
        `${assets.length} cached package${assets.length === 1 ? '' : 's'}` +
        (knownBytes ? ` · ${formatBytes(knownBytes)} recorded` : '') +
        (unknownCount ? ` · ${unknownCount} legacy size unknown` : '');

      for (const asset of assets) {
        const item = document.createElement('li');
        item.dataset.cachedAsset = asset.name;
        item.textContent = assetLabel(asset) +
          (asset.bytes ? ` · ${formatBytes(asset.bytes)}` : '');
        this.cacheList.appendChild(item);
      }
      this.clearCacheBtn.disabled = false;
    } catch (error) {
      this.cacheSummary.textContent = 'Could not read downloaded language data.';
      this.clearCacheBtn.disabled = true;
    }
  }

  async clearLanguageCache() {
    if (!window.confirm(
      'Remove downloaded speech models and dictionaries from this browser? They can be downloaded again when needed.'
    )) {
      return;
    }

    this.clearCacheBtn.disabled = true;
    this.cacheSummary.textContent = 'Clearing downloaded language data...';
    try {
      await Synchronizer.instance.clearCachedAssets();
      await this.refreshLanguageCache();
    } catch (error) {
      Overlay.showErrorPopup('Could not clear language data', error);
      await this.refreshLanguageCache();
    }
  }
}

class NumberOption {

  constructor(props) {
    this.props = props;
    <input this='el' type='number' />;
  }

  setDefaultValue(defval) {
    this.defval = defval
  }

  setValue(val) {
    if (val == null && this.defval != null) {
      val = this.defval;
    }
    if (this.props.step && this.props.step < 1) {
      const digits = Math.ceil(-Math.log10(this.props.step));
      val = val.toFixed(digits);
    }
    this.el.value = val;
  }

  getValue() {
    let val = this.el.valueAsNumber;
    if (this.props.step && this.props.step >= 1) val = parseInt(val);
    if ('min' in this.props && val < this.props.min) val = this.props.min;
    if ('max' in this.props && val > this.props.max) val = this.props.max;
    return val !== this.defval ? val : this.defval;
  }
}

class MinNumberOption extends NumberOption {

  setValue(val) {
    super.setValue(val / 60);
  }

  getValue() {
    return super.getValue() * 60;
  }
}

function getDescriptions() {
  return {
    windowSize: i18n`Subtitle time will be changed no more than this value. Higher value will result in longer synchronization, but if you set this too low, synchronization will fail.`,
    jobsNo: i18n`Number of concurrent synchronization threads.`,
    maxPointDist: i18n`Maximum acceptable synchronization error, in seconds. Synchronization points with error greater than this will be discarded.`,
    minPointsNo: i18n`Minumum number of synchronization points. Should not be set too high because it could result with generating large number of false positives.`,
    minWordLen: i18n`Minimum word length, in letters. Shorter words will not be used as synchronization points. Applies only to alphabet-based languages.`,
    minWordsSim: i18n`Minimum words similarity for synchronization points. Between 0.0 and 1.0.`,
    minCorrelation: i18n`Minimum correlation factor, between 0.0 and 1.0. Used to determine synchronization result. If correlation factor is smaller than this, synchronization will fail.`,
    minWordProb: i18n`Minimum speech recognition score, between 0.0 and 1.0. Words transcribed with smaller score will be rejected.`,
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

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
