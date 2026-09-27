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
const sw = read('web/public/sw.js.in');

requireMatch(index, /data-subsync2-tab="sync"/, 'Synchronize tab missing');
requireMatch(index, /data-subsync2-tab="audio"/, 'Audio Extractor tab missing');
requireMatch(router, /audio:\s*AudioExtractorScreen/, 'Audio route missing');
requireMatch(main, /get\('tab'\) === 'audio'/, 'Audio tab routing missing');
requireMatch(extractorHtml, /value="mp3"/, 'MP3 mode missing');
requireMatch(extractorHtml, /value="mka"/, 'MKA mode missing');
requireMatch(extractor, /new BlobSource\(file\)/, 'Extractor must read selected media as File\/Blob');
requireMatch(extractor, /sampleRate:\s*16000/, 'MP3 must remain 16 kHz');
requireMatch(extractor, /bitrate:\s*64000/, 'MP3 must remain 64 kbps');
requireMatch(extractor, /copy:\s*mode==='mka'\?\{mode:'forced'\}/, 'MKA must use forced stream copy');
requireMatch(extractor, /navigator\.storage\?\.getDirectory/, 'OPFS output path missing');
requireMatch(extractor, /navigator\.share/, 'iOS Share Sheet path missing');
if (/serviceWorker\.register/.test(extractor) || /manifest\.webmanifest/.test(extractorHtml)) {
  throw new Error('Audio Extractor must reuse the parent SubSync2 PWA shell, not register a nested PWA');
}
requireMatch(sw, /AUDIO_EXTRACTOR_INDEX/, 'Audio Extractor must have a separate offline navigation fallback');
requireMatch(sw, /audioExtractorNavigation/, 'Audio Extractor navigation must not overwrite the root offline index');

for (const asset of [
  "./audio-extractor/index.html",
  "./audio-extractor/styles.css",
  "./audio-extractor/app.js"
]) {
  if (!sw.includes(asset)) throw new Error('SubSync2 service worker shell is missing ' + asset);
}
console.log('Audio Extractor tab regression: PASS');
