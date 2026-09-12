import JSZip from 'jszip';
import Gizmo from '../gizmowrap.js';
import Filesystem from './fs.js';
import assetList from '../data/assets.json';
import languages from '../data/languages.json';
import Logger from '../logger.js';
const logger = Logger.logger.get('[Assets]');

const ASSETS_DIR = '/assets';
const CACHE_METADATA_PATH = ASSETS_DIR + '/.subsync2-cache.json';

export default class Assets {

  static loadDictionary(langKey, langVal, minWordLen=1) {
    const asset = Assets.getAsset({ type: 'dict', params: [ langKey, langVal ].sort() });
    const reversed = langKey > langVal;
    const dict = new Gizmo.instance.Dictionary();

    const langKeyInfo = languages.find(lang => lang.code3 === langKey);
    const langValInfo = languages.find(lang => lang.code3 === langVal);

    const minKeyLen = langKeyInfo.ngrams || minWordLen;
    const minValLen = langValInfo.ngrams || minWordLen;

    const addEntry = (key, val) => {
      if (key.length >= minKeyLen && val.length >= minValLen) {
        if (langKeyInfo.rightToLeft) key = key.split('').reduce((rev, ch) => ch + rev, '')
        if (langValInfo.rightToLeft) val = val.split('').reduce((rev, ch) => ch + rev, '')
        for (const k of splitNgrams(key, langKeyInfo.ngrams)) {
          for (const v of splitNgrams(val, langValInfo.ngrams)) {
            k && v && dict.add(k.toLowerCase(), v);
          }
        }
      }
    }

    for (const line of asset.split('\n')) {
      if (!line.startsWith('#')) {
        const items = line.split('|');
        const key = items[0];
        for (const val of items.slice(1)) {
          if (reversed) {
            addEntry(val, key);
          } else {
            addEntry(key, val);
          }
        }
      }
    }
    return dict;
  }

  static loadSpeechModel(lang) {
    return JSON.parse(Assets.getAsset({ type: 'speech', params: [ lang ] }));
  }

  static getAsset(asset) {
    const path = Assets.getAssetPath(asset);
    logger.log(`loading asset ${Assets.getAssetName(asset)} from "${path}"`);
    return Gizmo.instance.FS.readFile(path, {encoding: 'utf8'});
  }

  static getBinaryAsset(asset) {
    const path = Assets.getAssetPath(asset);
    logger.log(`loading binary asset ${Assets.getAssetName(asset)} from "${path}"`);
    return Gizmo.instance.FS.readFile(path);
  }

  static getAssetName({type, params}) {
    return `${type}/${params.join('-')}`;
  }

  static getAssetPath({type, params}) {
    return Filesystem.join(ASSETS_DIR, type, `${params.join('-')}.${type}`);
  }

  static getAssetDescription(asset) {
    const name = Assets.getAssetName(asset);
    const description = assetList[name];
    if (!description) {
      throw new Error(`Unknown language asset: ${name}`);
    }
    return description;
  }

  static async preloadAsset(asset, onProgress) {
    const name = Assets.getAssetName(asset);
    const path = Assets.getAssetPath(asset);
    const description = Assets.getAssetDescription(asset);
    const report = event => {
      if (onProgress) {
        onProgress({
          asset: {
            type: asset.type,
            params: Array.from(asset.params),
            name,
            version: description.version,
          },
          ...event,
        });
      }
    };

    if (Filesystem.isFile(path)) {
      const metadata = Assets.readCacheMetadata();
      const cached = metadata[name] || {};
      const versionMatches = cached.version === description.version;
      const metadataRequired = description.type === 'binary' || !!cached.version;

      if (!metadataRequired || versionMatches) {
        report({
          state: 'cached',
          cached: true,
          loadedBytes: cached.bytes || null,
          totalBytes: cached.bytes || null,
        });
        return {
          name,
          state: 'cached',
          bytes: cached.bytes || null,
        };
      }

      logger.log(`cached asset ${name} is stale, replacing ${cached.version || 'unknown'} with ${description.version}`);
      Filesystem.removeFileIfExists(path);
      delete metadata[name];
      Assets.writeCacheMetadata(metadata);
    }

    report({
      state: 'downloading',
      cached: false,
      loadedBytes: 0,
      totalBytes: null,
    });
    const data = await Assets.downloadAsset(asset, progress => {
      report({ state: 'downloading', cached: false, ...progress });
    });

    if (description.sha256) {
      report({
        state: 'verifying',
        cached: false,
        loadedBytes: data.byteLength,
        totalBytes: data.byteLength,
      });
      await Assets.verifySha256(data, description.sha256);
    }

    if (description.type === 'binary') {
      report({
        state: 'storing',
        cached: false,
        loadedBytes: data.byteLength,
        totalBytes: data.byteLength,
      });
      Filesystem.mkdirIfNotExist(Filesystem.join(ASSETS_DIR, asset.type));
      Gizmo.instance.FS.writeFile(path, data);
    } else {
      report({
        state: 'extracting',
        cached: false,
        loadedBytes: data.byteLength,
        totalBytes: data.byteLength,
      });
      await Assets.extractAsset(data);
    }

    if (asset.type === 'speech') {
      const FS = Gizmo.instance.FS;
      const model = JSON.parse(FS.readFile(path, { encoding: 'utf8' }));
      const sphinx = model.sphinx;
      for (const param in sphinx) {
        if (sphinx[param].startsWith('./')) {
          sphinx[param] = Filesystem.join(ASSETS_DIR, '/speech', sphinx[param]);
        }
      }
      FS.writeFile(path, JSON.stringify(model));
    }

    const metadata = Assets.readCacheMetadata();
    metadata[name] = {
      bytes: data.byteLength,
      version: description.version,
      cachedAt: new Date().toISOString(),
    };
    Assets.writeCacheMetadata(metadata);

    report({
      state: 'ready',
      cached: false,
      loadedBytes: data.byteLength,
      totalBytes: data.byteLength,
    });
    return {
      name,
      state: 'ready',
      bytes: data.byteLength,
    };
  }

  static async verifySha256(data, expected) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error('Browser SHA-256 support is unavailable for Romanian speech model verification.');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    const actual = Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    if (actual !== expected.toLowerCase()) {
      throw new Error(`SHA-256 mismatch for downloaded language asset: ${actual} != ${expected}`);
    }
  }

  static async extractAsset(data) {
    const zip = new JSZip();
    await zip.loadAsync(data, { createFolders: true });

    const files = [];
    zip.forEach((path, file) => {
      if (file.dir) {
        Filesystem.mkdirIfNotExist(Filesystem.join(ASSETS_DIR, path));
      } else {
        files.push(file)
      }
    });

    await Promise.all(files.map(async file => {
      const path = Filesystem.join(ASSETS_DIR, file.name);
      const content = await file.async('uint8array');
      Gizmo.instance.FS.writeFile(path, content);
    }));
  }

  static downloadAsset(asset, onProgress) {
    const description = Assets.getAssetDescription(asset);
    const name = Assets.getAssetName(asset);
    const url = Gizmo.instance.locateFile(description.url, null, true);
    logger.log(`downloading asset ${name} from "${url}"`);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onprogress = event => {
        if (onProgress) {
          onProgress({
            loadedBytes: event.loaded,
            totalBytes: event.lengthComputable ? event.total : null,
          });
        }
      };
      xhr.onerror = () => reject(new Error(`Couldn't download asset from ${url}. Network error.`));
      xhr.onabort = () => reject(new Error(`Download cancelled for ${url}.`));
      xhr.onload = () => {
        if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) {
          reject(new Error(`Couldn't download asset from ${url}. Got status ${xhr.status}.`));
          return;
        }
        const response = xhr.response || new ArrayBuffer(0);
        const bytes = new Uint8Array(response);
        if (onProgress) {
          onProgress({
            loadedBytes: bytes.byteLength,
            totalBytes: bytes.byteLength,
          });
        }
        resolve(bytes);
      };
      xhr.send();
    });
  }

  static getCachedAssets() {
    const metadata = Assets.readCacheMetadata();
    const cached = [];

    for (const name of Object.keys(assetList).sort()) {
      const asset = Assets.assetFromName(name);
      if (!asset || !Filesystem.isFile(Assets.getAssetPath(asset))) {
        continue;
      }
      const entry = metadata[name] || {};
      cached.push({
        name,
        type: asset.type,
        params: asset.params,
        version: assetList[name].version,
        bytes: entry.bytes || null,
        cachedAt: entry.cachedAt || null,
      });
    }
    return cached;
  }

  static clearCachedAssets() {
    const cached = Assets.getCachedAssets();
    const knownBytes = cached.reduce((sum, asset) => sum + (asset.bytes || 0), 0);

    Filesystem.removeTree(Filesystem.join(ASSETS_DIR, 'dict'));
    Filesystem.removeTree(Filesystem.join(ASSETS_DIR, 'speech'));
    Filesystem.removeTree(Filesystem.join(ASSETS_DIR, 'asr'));
    Filesystem.removeFileIfExists(CACHE_METADATA_PATH);

    return {
      count: cached.length,
      knownBytes,
    };
  }

  static assetFromName(name) {
    const split = name.indexOf('/');
    if (split < 1) return null;
    const type = name.substring(0, split);
    const params = name.substring(split + 1).split('-');
    if (!params.length) return null;
    return { type, params };
  }

  static readCacheMetadata() {
    const FS = Gizmo.instance.FS;
    if (!Filesystem.isFile(CACHE_METADATA_PATH)) {
      return {};
    }
    try {
      return JSON.parse(FS.readFile(CACHE_METADATA_PATH, { encoding: 'utf8' }));
    } catch (error) {
      logger.warn('could not read language cache metadata, rebuilding lazily', error);
      return {};
    }
  }

  static writeCacheMetadata(metadata) {
    Gizmo.instance.FS.writeFile(
      CACHE_METADATA_PATH,
      JSON.stringify(metadata, null, 2)
    );
  }
}

function* splitNgrams(word, size) {
  if (size == null) {
    yield word;
  } else {
    for (let i = 0; i < word.length + 1 - size; i++) {
      yield word.substring(i, i + size);
    }
  }
}
