#!/usr/bin/env node
const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function requireMatch(text, re, message) {
  if (!re.test(text)) throw new Error(message);
}

const index = read('web/public/index.html');
const router = read('web/src/router.js');
const main = read('web/src/main.js');
const extractor = read('web/public/audio-extractor/app.js');
const extractorHtml = read('web/public/audio-extractor/index.html');
const runtime = JSON.parse(read('config/audio-extractor-runtime.json'));
const sw = read('web/public/sw.js.in');

requireMatch(index, /data-subsync2-tab="sync"/, 'Synchronize tab missing');
requireMatch(index, /data-subsync2-tab="audio"/, 'Audio Extractor tab missing');
requireMatch(router, /audio:\s*AudioExtractorScreen/, 'Audio route missing');
requireMatch(main, /get\('tab'\) === 'audio'/, 'Audio tab routing missing');
requireMatch(extractorHtml, /value="mp3"/, 'MP3 mode missing');
requireMatch(extractorHtml, /value="mka"/, 'MKA mode missing');
if (/id="fileInput"[^>]*\saccept=/.test(extractorHtml)) {
  throw new Error('Audio Extractor file picker must not restrict iOS Files with accept=; validate after selection instead');
}
requireMatch(extractor, /new BlobSource\(file\)/, 'Extractor must read selected media as File\/Blob');
requireMatch(extractor, /sampleRate:\s*16000/, 'MP3 must remain 16 kHz');
requireMatch(extractor, /bitrate:\s*64000/, 'MP3 must remain 64 kbps');
requireMatch(extractor, /copy:\s*mode==='mka'\?\{mode:'forced'\}/, 'MKA must use forced stream copy');
requireMatch(extractor, /navigator\.storage\?\.getDirectory/, 'OPFS output path missing');
requireMatch(extractor, /navigator\.share/, 'iOS Share Sheet path missing');
requireMatch(extractor, /\.\/vendor\/mediabunny\.min\.mjs/, 'Vendored Mediabunny core path missing');
requireMatch(extractor, /SubSync2Android\//, 'Android shell detection missing');
requireMatch(extractor, /prepareAndroidTvControls/, 'Android TV D-pad preparation missing');
requireMatch(extractor, /moveAndroidTvFocus/, 'Android TV directional focus navigation missing');
requireMatch(extractor, /SubSyncAndroid\.requestSave/, 'Android native save request missing');
requireMatch(extractor, /SubSyncAndroid\.writeSaveChunk/, 'Android native chunked save path missing');
requireMatch(extractor, /subsync2-native-save-ready/, 'Android native save callback missing');
if (/cdn\.jsdelivr\.net/.test(extractor)) {
  throw new Error('Audio Extractor must not depend on jsDelivr at runtime');
}
if (runtime.version !== '1.60.0' || runtime.files.length !== 4) {
  throw new Error('Pinned Audio Extractor runtime manifest mismatch');
}
for (const asset of runtime.files) {
  if (!/^[0-9a-f]{64}$/.test(asset.sha256) || !asset.url.includes('/releases/download/v1.60.0/')) {
    throw new Error('Audio Extractor runtime asset is not release+SHA pinned: ' + asset.name);
  }
}
if (/serviceWorker\.register/.test(extractor) || /manifest\.webmanifest/.test(extractorHtml)) {
  throw new Error('Audio Extractor must reuse the parent SubSync2 PWA shell, not register a nested PWA');
}
requireMatch(sw, /AUDIO_EXTRACTOR_INDEX/, 'Audio Extractor must have a separate offline navigation fallback');
requireMatch(sw, /audioExtractorNavigation/, 'Audio Extractor navigation must not overwrite the root offline index');

for (const asset of [
  "./audio-extractor/index.html",
  "./audio-extractor/styles.css",
  "./audio-extractor/app.js",
  "./audio-extractor/vendor/mediabunny.min.mjs?v=1.60.0",
  "./audio-extractor/vendor/mediabunny-mp3-encoder.min.js?v=1.60.0",
  "./audio-extractor/vendor/mediabunny-ac3.min.js?v=1.60.0",
  "./audio-extractor/vendor/mediabunny-dts.min.js?v=1.60.0"
]) {
  if (!sw.includes(asset)) throw new Error('SubSync2 service worker shell is missing ' + asset);
}
console.log('Audio Extractor tab regression: PASS');
