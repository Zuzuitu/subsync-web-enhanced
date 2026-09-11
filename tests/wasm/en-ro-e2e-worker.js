function phase(name, data) {
  self.postMessage({ type: 'phase', phase: name, data: data === undefined ? null : data, at: Date.now() });
}
function finish(status, details) {
  self.postMessage({ type: 'result', status, details });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function normalizeError(error) {
  return {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined,
  };
}
async function fetchFile(url, name, type) {
  const response = await fetch(url);
  assert(response.ok, `Failed to fetch ${url}: HTTP ${response.status}`);
  return new File([await response.blob()], name, { type });
}
function mkdirp(FS, path) {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    try {
      FS.mkdir(current);
    } catch (error) {
      if (!FS.analyzePath(current).exists) throw error;
    }
  }
}
async function initModule(factory, wasmUrl, label) {
  phase(label + ':wasm-fetch:start');
  const wasmResponse = await fetch(wasmUrl, { cache: 'no-store' });
  phase(label + ':wasm-fetch:response', {
    ok: wasmResponse.ok,
    status: wasmResponse.status,
    contentType: wasmResponse.headers.get('content-type'),
    contentLength: wasmResponse.headers.get('content-length'),
  });
  assert(wasmResponse.ok, `Failed to fetch ${wasmUrl}: HTTP ${wasmResponse.status}`);

  const wasmBinary = await wasmResponse.arrayBuffer();
  phase(label + ':wasm-fetch:done', { bytes: wasmBinary.byteLength });

  const wrapper = await new Promise((resolve, reject) => {
    try {
      phase(label + ':factory:start');
      const candidate = factory({
        wasmBinary,
        locateFile: path => wasmUrl.substring(0, wasmUrl.lastIndexOf('/') + 1) + path,
        print: text => console.log('[wasm]', text),
        printErr: text => console.warn('[wasm]', text),
        monitorRunDependencies: left => phase(label + ':run-dependencies', { left }),
        onRuntimeInitialized: () => phase(label + ':runtime-initialized'),
        onAbort: reason => {
          phase(label + ':abort', { reason: String(reason) });
          reject(new Error('Emscripten aborted: ' + String(reason)));
        },
      });
      phase(label + ':factory:created');
      candidate.then(instance => {
        phase(label + ':factory:resolved');
        resolve({ instance });
      });
    } catch (error) {
      reject(error);
    }
  });
  return wrapper;
}

phase('worker-start');
importScripts('/web/scripts/extractor.js');
const extractorFactory = gizmo;
phase('extractor-js-loaded');

async function loadSpeechModel(module) {
  const FS = module.FS;
  mkdirp(FS, '/assets');

  const response = await fetch('/tests/generated/en-ro-e2e/speech-model/manifest.json');
  assert(response.ok, 'Missing English speech manifest');
  const manifest = await response.json();

  for (const relativePath of manifest.files) {
    if (relativePath === 'manifest.json') continue;
    const fileResponse = await fetch('/tests/generated/en-ro-e2e/speech-model/' + relativePath);
    assert(fileResponse.ok, 'Missing speech model file ' + relativePath);
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    const fsPath = '/assets/' + relativePath;
    mkdirp(FS, fsPath.substring(0, fsPath.lastIndexOf('/')));
    FS.writeFile(fsPath, bytes);
  }

  const descriptorPath = '/assets/' + manifest.descriptor;
  const model = JSON.parse(FS.readFile(descriptorPath, { encoding: 'utf8' }));
  const descriptorDir = descriptorPath.substring(0, descriptorPath.lastIndexOf('/'));
  for (const key of Object.keys(model.sphinx || {})) {
    const value = model.sphinx[key];
    if (typeof value === 'string' && value.startsWith('./')) {
      model.sphinx[key] = descriptorDir + '/' + value.substring(2);
    }
  }
  phase('speech-model-ready', { samplerate: model.samplerate, sampleformat: model.sampleformat });
  return model;
}

async function makeRomanianToEnglishDictionary(module) {
  const response = await fetch('/tests/generated/en-ro-e2e/dictionary/dict/eng-rum.dict');
  assert(response.ok, 'Missing eng-rum dictionary');
  const text = await response.text();
  const dict = new module.Dictionary();
  let added = 0;

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|');
    const english = (parts[0] || '').trim();
    if (english.length < 5) continue;
    for (const value of parts.slice(1)) {
      const romanian = value.trim();
      if (romanian.length >= 5) {
        dict.add(romanian.toLowerCase(), english.toLowerCase());
        added += 1;
      }
    }
  }
  phase('dictionary-ready', { entries: added });
  assert(added > 100, 'Dictionary unexpectedly small');
  return dict;
}

async function extractReferenceWords(module, model) {
  const FS = module.FS;
  const file = await fetchFile(
    '/tests/generated/en-ro-e2e/reference-english.mkv',
    'reference-english.mkv',
    'video/x-matroska'
  );
  mkdirp(FS, '/reference');
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, '/reference');

  let demux, dec, resampler, speech;
  const words = [];
  try {
    demux = new module.Demux('/reference/reference-english.mkv');
    const streams = demux.getStreamsInfo();
    const audio = streams.find(stream => stream.type === 'audio' && stream.lang === 'eng')
      || streams.find(stream => stream.type === 'audio');
    assert(audio, 'English MKV audio stream not found');

    speech = new module.SpeechRecognition();
    for (const [key, value] of Object.entries(model.sphinx || {})) {
      speech.setParam(key, String(value));
    }
    speech.setParam('-mmap', '0');
    speech.setMinWordProb(0.3);
    speech.setMinWordLen(5);
    speech.addWordsListener(word => words.push(word));

    dec = new module.AudioDec();
    resampler = new module.Resampler();
    demux.connectDec(dec, audio.no);
    dec.connectOutput(resampler);
    resampler.connectOutput(
      speech,
      module.AVSampleFormat[model.sampleformat],
      parseInt(model.samplerate, 10),
      32 * 1024
    );

    demux.start();
    let packets = 0;
    while (demux.step()) {
      packets += 1;
      if (packets > 100000) throw new Error('Reference demux safety limit exceeded');
    }
    demux.stop();

    phase('reference-words', {
      count: words.length,
      words: words.slice(0, 80).map(w => ({ text: w.text, time: w.time, duration: w.duration })),
    });
    return words;
  } finally {
    if (demux) demux.delete();
    if (dec) dec.delete();
    if (speech) speech.delete();
    if (resampler) resampler.delete();
    try { FS.unmount('/reference'); } catch (_) {}
  }
}

async function extractTranslatedSubtitleWords(module, dict) {
  const FS = module.FS;
  const file = await fetchFile(
    '/tests/generated/en-ro-e2e/target.rum.srt',
    'target.rum.srt',
    'application/x-subrip'
  );
  mkdirp(FS, '/subtitle');
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, '/subtitle');

  let demux, dec, translator;
  const words = [];
  const subtitles = [];
  try {
    demux = new module.Demux('/subtitle/target.rum.srt');
    const streams = demux.getStreamsInfo();
    const subtitle = streams.find(stream => stream.type === 'subtitle/text');
    assert(subtitle, 'Romanian SRT stream not found');

    dec = new module.SubtitleDec();
    dec.setEncoding('UTF-8');
    dec.setMinWordLen(5);
    dec.addSubsListener(item => subtitles.push(item));

    translator = new module.Translator(dict);
    translator.setMinWordsSim(0.6);
    translator.addWordsListener(word => words.push(word));
    dec.connectTranslator(translator);
    demux.connectDec(dec, subtitle.no);

    demux.start();
    let packets = 0;
    while (demux.step()) {
      packets += 1;
      if (packets > 10000) throw new Error('Subtitle demux safety limit exceeded');
    }
    demux.stop();

    phase('subtitle-words', {
      count: words.length,
      subtitles: subtitles.length,
      words: words.slice(0, 100).map(w => ({ text: w.text, time: w.time, duration: w.duration })),
    });
    return { words, subtitles };
  } finally {
    if (demux) demux.delete();
    if (dec) dec.delete();
    if (translator) translator.delete();
    try { FS.unmount('/subtitle'); } catch (_) {}
  }
}

async function run() {
  let extractor, correlator, dict, sync;
  try {
    phase('extractor-init:start');
    extractor = (await initModule(extractorFactory, '/web/scripts/extractor.wasm', 'extractor')).instance;
    phase('extractor-init:done');

    phase('correlator-js-load:start');
    importScripts('/web/scripts/correlator.js');
    const correlatorFactory = gizmo;
    phase('correlator-js-load:done');

    phase('correlator-init:start');
    correlator = (await initModule(correlatorFactory, '/web/scripts/correlator.wasm', 'correlator')).instance;
    phase('correlator-init:done');

    assert(extractor.FS && extractor.FS.filesystems.WORKERFS, 'Extractor WORKERFS unavailable');

    const fixtureResponse = await fetch('/tests/generated/en-ro-e2e/fixture.json');
    assert(fixtureResponse.ok, 'Missing EN-RO fixture metadata');
    const fixture = await fixtureResponse.json();

    const model = await loadSpeechModel(extractor);
    dict = await makeRomanianToEnglishDictionary(extractor);

    const referenceWords = await extractReferenceWords(extractor, model);
    const sub = await extractTranslatedSubtitleWords(extractor, dict);

    sync = new correlator.Synchronizer(30 * 60, 0.9999, 2, 20, 0.6);
    for (const item of sub.subtitles) {
      sync.addSubtitle(item.start, item.end);
    }
    for (const word of sub.words) {
      sync.addSubWord(word.time, word.duration, word.text);
    }
    for (const word of referenceWords) {
      sync.addRefWord(word.time, word.duration, word.text);
    }

    const stats = sync.correlate();
    const formula = stats.formula;
    const details = {
      referenceWords: referenceWords.length,
      translatedSubtitleWords: sub.words.length,
      subtitles: sub.subtitles.length,
      correlated: stats.correlated,
      factor: stats.factor,
      points: stats.points,
      maxDistance: stats.maxDistance,
      formula: { a: formula.a, b: formula.b },
      expected: { a: 1, b: -fixture.offsetSeconds },
    };
    phase('correlation-result', details);

    assert(referenceWords.length >= 20, 'English speech recognition produced fewer than 20 usable words');
    assert(sub.words.length >= 20, 'Romanian subtitles produced fewer than 20 translated words');
    assert(stats.correlated, 'English audio and Romanian subtitles did not correlate');
    assert(stats.points >= 20, 'Correlation produced fewer than 20 synchronization points');
    assert(stats.factor >= 0.9999, 'Correlation factor below product threshold');
    assert(stats.maxDistance <= 2, 'Correlation max distance above product threshold');
    assert(Math.abs(formula.a - 1) <= 0.03, 'Unexpected synchronization slope: ' + formula.a);
    assert(
      Math.abs(formula.b + fixture.offsetSeconds) <= 1.5,
      'Unexpected synchronization offset: ' + formula.b
    );

    finish('pass', details);
  } catch (error) {
    const normalized = normalizeError(error);
    phase('error', normalized);
    finish('fail', normalized);
  } finally {
    if (sync) sync.delete();
    if (dict) dict.delete();
  }
}
run();
