function phase(name, data) {
  self.postMessage({
    type: 'phase',
    phase: name,
    data: data === undefined ? null : data,
    at: Date.now(),
  });
}

phase('worker-start');
importScripts('/web/scripts/extractor.js');
phase('extractor-js-loaded');

function finish(status, details) {
  self.postMessage({ type: 'result', status, details });
}

function normalizeError(module, error) {
  if (typeof error === 'number' && module && module.getCurrentException) {
    try {
      return module.getCurrentException() || { thrown: error };
    } catch (_) {
      return { thrown: error };
    }
  }
  return {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchAsFile(url, name, type) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new File([blob], name, { type });
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

async function loadSpeechModel(module) {
  const FS = module.FS;
  phase('speech-model-manifest:start');
  const manifestResponse = await fetch('/tests/generated/speech-model/manifest.json');
  assert(manifestResponse.ok, `Speech manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  phase('speech-model-manifest:done', {
    descriptor: manifest.descriptor,
    files: manifest.files.length,
    releaseAssetId: manifest.releaseAssetId,
  });

  let totalBytes = 0;
  let loadedFiles = 0;
  for (const relativePath of manifest.files) {
    if (relativePath === 'manifest.json') continue;

    const response = await fetch('/tests/generated/speech-model/' + relativePath);
    assert(response.ok, `Speech model file ${relativePath}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const fsPath = '/assets/' + relativePath;
    mkdirp(FS, fsPath.substring(0, fsPath.lastIndexOf('/')));
    FS.writeFile(fsPath, bytes);

    totalBytes += bytes.byteLength;
    loadedFiles += 1;
    if (loadedFiles <= 3 || loadedFiles % 25 === 0) {
      phase('speech-model-load:progress', {
        loadedFiles,
        totalFiles: manifest.files.length - 1,
        totalBytes,
        file: relativePath,
      });
    }
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

  phase('speech-model-load:done', {
    loadedFiles,
    totalBytes,
    sampleformat: model.sampleformat,
    samplerate: model.samplerate,
    sphinxParams: Object.keys(model.sphinx || {}),
  });
  return model;
}

async function runSpeechReference(module, model, spec) {
  const FS = module.FS;
  const label = spec.label;
  const mountPath = '/ref-' + label;

  phase(label + ':fetch:start');
  const file = await fetchAsFile(spec.url, spec.name, spec.type);
  phase(label + ':fetch:done', { size: file.size });

  mkdirp(FS, mountPath);
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, mountPath);
  phase(label + ':mount:done');

  let demux;
  let audioDec;
  let resampler;
  let speechRec;
  let packets = 0;
  const words = [];

  try {
    phase(label + ':demux-construct:start');
    demux = new module.Demux(mountPath + '/' + spec.name);
    phase(label + ':demux-construct:done');

    const streams = demux.getStreamsInfo();
    const duration = demux.getDuration();
    const audio = streams.find(stream => stream.type === 'audio');
    assert(audio, label + ': no audio stream');
    phase(label + ':audio-stream', { stream: audio, duration, streams });

    phase(label + ':speech-pipeline:start');
    speechRec = new module.SpeechRecognition();
    for (const [key, value] of Object.entries(model.sphinx || {})) {
      speechRec.setParam(key, String(value));
    }
    speechRec.setParam('-mmap', '0');
    speechRec.setMinWordProb(0.3);
    speechRec.setMinWordLen(1);
    speechRec.addWordsListener(word => words.push(word));

    audioDec = new module.AudioDec();
    resampler = new module.Resampler();
    demux.connectDec(audioDec, audio.no);
    audioDec.connectOutput(resampler);

    const sampleFormat = module.AVSampleFormat[model.sampleformat];
    assert(sampleFormat !== undefined, `Unknown model sample format ${model.sampleformat}`);

    resampler.connectOutput(
      speechRec,
      sampleFormat,
      parseInt(model.samplerate, 10),
      32 * 1024
    );
    phase(label + ':speech-pipeline:done');

    phase(label + ':demux-start:start');
    demux.start();
    phase(label + ':demux-start:done');

    phase(label + ':demux-loop:start');
    while (demux.step()) {
      packets += 1;
      if (packets <= 5 || packets % 25 === 0) {
        phase(label + ':demux-loop:progress', { packets, words: words.length });
      }
      if (packets > 10000) throw new Error(label + ': demux safety limit exceeded');
    }
    phase(label + ':demux-loop:done', { packets, words: words.length });

    phase(label + ':demux-stop:start');
    demux.stop();
    phase(label + ':demux-stop:done', { words: words.length });

    assert(packets > 0, label + ': demux produced zero packets');

    return {
      label,
      fileSize: file.size,
      duration,
      packets,
      words: words.length,
      audioStream: audio,
      streams,
    };
  } finally {
    phase(label + ':cleanup:start');
    if (demux) demux.delete();
    if (audioDec) audioDec.delete();
    if (speechRec) speechRec.delete();
    if (resampler) resampler.delete();
    try {
      FS.unmount(mountPath);
    } catch (_) {}
    phase(label + ':cleanup:done');
  }
}

async function runSubtitleReference(module) {
  const FS = module.FS;
  const srtFile = await fetchAsFile(
    '/tests/generated/target.srt',
    'target.srt',
    'application/x-subrip'
  );
  mkdirp(FS, '/srt');
  FS.mount(FS.filesystems.WORKERFS, { files: [srtFile] }, '/srt');

  let demux;
  let subtitleDec;
  let packets = 0;
  const subtitles = [];

  try {
    phase('srt:demux-construct:start');
    demux = new module.Demux('/srt/target.srt');
    phase('srt:demux-construct:done');

    const streams = demux.getStreamsInfo();
    const subtitle = streams.find(stream => stream.type === 'subtitle/text');
    assert(subtitle, 'SRT was not recognized as text subtitles');

    subtitleDec = new module.SubtitleDec();
    subtitleDec.setEncoding('UTF-8');
    subtitleDec.setMinWordLen(1);
    subtitleDec.addSubsListener(event => subtitles.push(event));
    demux.connectDec(subtitleDec, subtitle.no);

    demux.start();
    while (demux.step()) {
      packets += 1;
      if (packets > 10000) throw new Error('SRT demux safety limit exceeded');
    }
    demux.stop();

    assert(packets > 0, 'SRT produced zero packets');
    assert(subtitles.length > 0, 'SRT decoder emitted no subtitles');
    phase('srt:done', { packets, subtitles: subtitles.length, streams });

    return {
      packets,
      subtitles: subtitles.length,
      streams,
    };
  } finally {
    if (demux) demux.delete();
    if (subtitleDec) subtitleDec.delete();
    try {
      FS.unmount('/srt');
    } catch (_) {}
  }
}

async function initModule() {
  const wasmResponse = await fetch('/web/scripts/extractor.wasm', { cache: 'no-store' });
  phase('wasm-prefetch:response', {
    ok: wasmResponse.ok,
    status: wasmResponse.status,
    contentType: wasmResponse.headers.get('content-type'),
    contentLength: wasmResponse.headers.get('content-length'),
  });
  assert(wasmResponse.ok, `Failed to fetch extractor.wasm: HTTP ${wasmResponse.status}`);

  const wasmBinary = await wasmResponse.arrayBuffer();
  phase('wasm-prefetch:done', { bytes: wasmBinary.byteLength });

  const wrapper = await new Promise((resolve, reject) => {
    try {
      const candidate = gizmo({
        wasmBinary,
        locateFile: path => '/web/scripts/' + path,
        print: text => console.log('[wasm]', text),
        printErr: text => console.warn('[wasm]', text),
        monitorRunDependencies: left => phase('module-run-dependencies', { left }),
        onRuntimeInitialized: () => phase('module-runtime-initialized'),
        onAbort: reason => {
          phase('module-abort', { reason: String(reason) });
          reject(new Error('Emscripten aborted: ' + String(reason)));
        },
      });
      candidate.then(instance => resolve({ instance }));
    } catch (error) {
      reject(error);
    }
  });

  phase('module-init:done');
  return wrapper;
}

async function run() {
  let module;
  try {
    assert(typeof gizmo === 'function', 'Emscripten extractor factory is not available');
    phase('module-init:start');
    const initialized = await initModule();
    module = initialized.instance;

    const FS = module.FS;
    assert(FS && FS.filesystems && FS.filesystems.WORKERFS, 'WORKERFS is not available');

    const model = await loadSpeechModel(module);

    const mkv = await runSpeechReference(module, model, {
      label: 'mkv',
      url: '/tests/generated/reference-aac.mkv',
      name: 'reference-aac.mkv',
      type: 'video/x-matroska',
    });

    const audio = await runSpeechReference(module, model, {
      label: 'wav',
      url: '/tests/generated/reference-audio.wav',
      name: 'reference-audio.wav',
      type: 'audio/wav',
    });

    const srt = await runSubtitleReference(module);

    finish('pass', {
      model: {
        sampleformat: model.sampleformat,
        samplerate: model.samplerate,
      },
      mkv,
      audio,
      srt,
    });
  } catch (error) {
    const normalized = normalizeError(module, error);
    phase('error', normalized);
    finish('fail', normalized);
  }
}

run();
