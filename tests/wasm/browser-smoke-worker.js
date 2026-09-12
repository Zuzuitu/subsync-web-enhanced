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
    const audioStreams = streams.filter(stream => stream.type === 'audio');
    const videoStreams = streams.filter(stream => stream.type === 'video');
    const subtitleStreams = streams.filter(stream => stream.type.indexOf('subtitle') === 0);

    assert(audioStreams.length > 0, label + ': no audio stream');

    if (spec.expectedVideoCodec) {
      assert(videoStreams.length > 0, label + ': expected a video stream');
      assert(
        videoStreams.some(stream => stream.codec === spec.expectedVideoCodec),
        label + ': expected video codec ' + spec.expectedVideoCodec +
          ', got ' + videoStreams.map(stream => stream.codec).join(',')
      );
    }

    if (spec.minDuration != null) {
      assert(
        duration >= spec.minDuration,
        label + ': expected duration >= ' + spec.minDuration + ', got ' + duration
      );
    }

    if (spec.minAudioTracks != null) {
      assert(
        audioStreams.length >= spec.minAudioTracks,
        label + ': expected at least ' + spec.minAudioTracks +
          ' audio tracks, got ' + audioStreams.length
      );
    }

    let audio = audioStreams[0];
    if (spec.language) {
      audio = audioStreams.find(stream => stream.lang === spec.language);
      assert(audio, label + ': expected audio language ' + spec.language);
    }

    if (spec.expectedCodec) {
      assert(
        audio.codec === spec.expectedCodec,
        label + ': expected codec ' + spec.expectedCodec + ', got ' + audio.codec
      );
    }

    if (spec.expectedTitle) {
      assert(
        audio.title === spec.expectedTitle,
        label + ': expected title ' + spec.expectedTitle + ', got ' + audio.title
      );
    }

    if (spec.expectSubtitle) {
      assert(subtitleStreams.length > 0, label + ': expected embedded subtitle stream');
    }

    phase(label + ':audio-stream', {
      stream: audio,
      duration,
      streams,
      audioTracks: audioStreams.length,
      subtitleTracks: subtitleStreams.length,
    });

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

    let seekReportedPosition = null;
    let minObservedPosition = Infinity;
    let maxObservedPosition = -Infinity;

    if (spec.seekTo != null) {
      phase(label + ':seek:start', { seekTo: spec.seekTo });
      demux.seek(spec.seekTo);
      seekReportedPosition = demux.getPosition();
      assert(
        Math.abs(seekReportedPosition - spec.seekTo) < 0.01,
        label + ': demux did not report requested seek position'
      );
      phase(label + ':seek:done', { seekReportedPosition });
    }

    phase(label + ':demux-start:start');
    demux.start();
    phase(label + ':demux-start:done');

    phase(label + ':demux-loop:start');
    while (demux.step()) {
      packets += 1;
      const position = demux.getPosition();
      minObservedPosition = Math.min(minObservedPosition, position);
      maxObservedPosition = Math.max(maxObservedPosition, position);

      if (packets <= 5 || packets % 25 === 0) {
        phase(label + ':demux-loop:progress', {
          packets,
          words: words.length,
          position,
        });
      }

      if (spec.stopAt != null && position >= spec.stopAt) {
        break;
      }
      if (packets > 10000) throw new Error(label + ': demux safety limit exceeded');
    }
    phase(label + ':demux-loop:done', { packets, words: words.length });

    phase(label + ':demux-stop:start');
    demux.stop();
    phase(label + ':demux-stop:done', { words: words.length });

    assert(packets > 0, label + ': demux produced zero packets');

    if (spec.seekTo != null) {
      const toleranceBefore = spec.seekToleranceBefore == null
        ? 0
        : spec.seekToleranceBefore;
      assert(
        maxObservedPosition >= spec.seekTo,
        label + ': seek never reached requested time; max=' + maxObservedPosition
      );
      assert(
        minObservedPosition >= spec.seekTo - toleranceBefore,
        label + ': seek landed too far before requested time; min=' +
          minObservedPosition + ', requested=' + spec.seekTo
      );
      if (spec.stopAt != null) {
        assert(
          maxObservedPosition >= spec.stopAt,
          label + ': time-window run did not reach stopAt=' + spec.stopAt +
            ', max=' + maxObservedPosition
        );
      }
    }

    return {
      label,
      fileSize: file.size,
      duration,
      packets,
      words: words.length,
      audioStream: audio,
      audioTracks: audioStreams.length,
      subtitleTracks: subtitleStreams.length,
      seekReportedPosition,
      minObservedPosition: Number.isFinite(minObservedPosition)
        ? minObservedPosition
        : null,
      maxObservedPosition: Number.isFinite(maxObservedPosition)
        ? maxObservedPosition
        : null,
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
  const words = [];

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
    subtitleDec.addWordsListener(word => words.push(word));
    demux.connectDec(subtitleDec, subtitle.no);

    demux.start();
    while (demux.step()) {
      packets += 1;
      if (packets > 10000) throw new Error('SRT demux safety limit exceeded');
    }
    demux.stop();

    assert(packets > 0, 'SRT produced zero packets');
    assert(subtitles.length > 0, 'SRT decoder emitted no subtitles');

    const subtitleText = subtitles.map(item => item.text || '').join('\n');
    const wordText = words.map(item => item.text || '').join(' ');
    const requiredRomanian = ['ă', 'â', 'î', 'ș', 'ț', 'Ă', 'Â', 'Î', 'Ș', 'Ț'];

    for (const char of requiredRomanian) {
      assert(
        subtitleText.includes(char) || wordText.includes(char),
        'Romanian UTF-8 character was not preserved: ' + char
      );
    }

    assert(
      subtitleText.includes('Română') || wordText.includes('Română'),
      'Romanian UTF-8 word Română was not preserved'
    );

    phase('srt:done', {
      packets,
      subtitles: subtitles.length,
      words: words.length,
      romanianUtf8: true,
      streams,
    });

    return {
      packets,
      subtitles: subtitles.length,
      words: words.length,
      romanianUtf8: true,
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

async function runLegacyRomanianSubtitle(module) {
  const FS = module.FS;
  const file = await fetchAsFile(
    '/tests/generated/target-windows-1250.srt',
    'target-windows-1250.srt',
    'application/x-subrip'
  );

  mkdirp(FS, '/srt-cp1250');
  FS.mount(FS.filesystems.WORKERFS, { files: [file] }, '/srt-cp1250');

  let demux;
  let subtitleDec;
  let packets = 0;
  const subtitles = [];
  const words = [];

  try {
    demux = new module.Demux('/srt-cp1250/target-windows-1250.srt');
    const streams = demux.getStreamsInfo();
    const subtitle = streams.find(stream => stream.type === 'subtitle/text');
    assert(subtitle, 'Windows-1250 Romanian SRT was not recognized');

    subtitleDec = new module.SubtitleDec();
    subtitleDec.setEncoding('Windows-1250');
    subtitleDec.setMinWordLen(1);
    subtitleDec.addSubsListener(event => subtitles.push(event));
    subtitleDec.addWordsListener(word => words.push(word));
    demux.connectDec(subtitleDec, subtitle.no);

    demux.start();
    while (demux.step()) {
      packets += 1;
      if (packets > 10000) {
        throw new Error('Windows-1250 SRT demux safety limit exceeded');
      }
    }
    demux.stop();

    const subtitleText = subtitles.map(item => item.text || '').join('\n');
    const wordText = words.map(item => item.text || '').join(' ');

    for (const value of ['Română', 'ă', 'â', 'î', 'ş', 'ţ', 'Ş', 'Ţ']) {
      assert(
        subtitleText.includes(value) || wordText.includes(value),
        'Windows-1250 Romanian character/text was not preserved: ' + value
      );
    }

    phase('srt-cp1250:done', {
      packets,
      subtitles: subtitles.length,
      words: words.length,
      romanianWindows1250: true,
      streams,
    });

    return {
      packets,
      subtitles: subtitles.length,
      words: words.length,
      romanianWindows1250: true,
      streams,
    };
  } finally {
    if (demux) demux.delete();
    if (subtitleDec) subtitleDec.delete();
    try {
      FS.unmount('/srt-cp1250');
    } catch (_) {}
  }
}

async function loadAndValidateFixtureManifest() {
  const response = await fetch('/tests/generated/mkv-fixture-manifest.json');
  assert(response.ok, 'MKV fixture manifest HTTP ' + response.status);
  const manifest = await response.json();

  function streams(name) {
    assert(manifest[name], 'Missing fixture manifest entry: ' + name);
    return manifest[name].probe.streams || [];
  }

  const h264 = streams('reference-h264-aac-stereo.mkv');
  assert(
    h264.some(stream => stream.codec_type === 'video' && stream.codec_name === 'h264'),
    'H.264 fixture probe mismatch'
  );
  assert(
    h264.some(stream =>
      stream.codec_type === 'audio' &&
      stream.codec_name === 'aac' &&
      stream.channels === 2
    ),
    'H.264 stereo AAC fixture probe mismatch'
  );

  const hevc = streams('reference-hevc-eac3-5.1.mkv');
  assert(
    hevc.some(stream => stream.codec_type === 'video' && stream.codec_name === 'hevc'),
    'HEVC fixture probe mismatch'
  );
  assert(
    hevc.some(stream =>
      stream.codec_type === 'audio' &&
      stream.codec_name === 'eac3' &&
      stream.channels === 6
    ),
    'HEVC E-AC3 5.1 fixture probe mismatch'
  );

  const reversed = streams('reference-multitrack-reversed.mkv')
    .filter(stream => stream.codec_type === 'audio');
  assert(reversed.length >= 2, 'Reversed multitrack fixture lost audio streams');
  assert(
    reversed[0].tags && reversed[0].tags.language === 'spa',
    'Reversed multitrack first audio language is not spa'
  );
  assert(
    reversed[1].tags && reversed[1].tags.language === 'eng',
    'Reversed multitrack second audio language is not eng'
  );
  assert(
    reversed[1].channels === 6,
    'Reversed multitrack English stream is not 5.1'
  );

  const longDuration = parseFloat(
    manifest['reference-long-seek.mkv'].probe.format.duration
  );
  assert(longDuration >= 124, 'Long seek fixture duration is too short');

  const summary = {
    h264Stereo: true,
    hevcEac3FiveOne: true,
    reversedMultitrack: true,
    longDuration,
    longFixtureBytes: manifest['reference-long-seek.mkv'].bytes,
  };
  phase('fixture-manifest:validated', summary);
  return summary;
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

    const fixtureManifest = await loadAndValidateFixtureManifest();
    const model = await loadSpeechModel(module);

    const specs = [
      {
        label: 'mkv-aac',
        url: '/tests/generated/reference-aac.mkv',
        name: 'reference-aac.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'aac',
      },
      {
        label: 'mkv-ac3',
        url: '/tests/generated/reference-ac3.mkv',
        name: 'reference-ac3.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'ac3',
      },
      {
        label: 'mkv-eac3',
        url: '/tests/generated/reference-eac3.mkv',
        name: 'reference-eac3.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'eac3',
      },
      {
        label: 'mkv-multitrack',
        url: '/tests/generated/reference-multitrack.mkv',
        name: 'reference-multitrack.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'ac3',
        minAudioTracks: 2,
      },
      {
        label: 'mkv-embedded-subs',
        url: '/tests/generated/reference-embedded-subs.mkv',
        name: 'reference-embedded-subs.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'aac',
        expectSubtitle: true,
      },
      {
        label: 'mkv-h264-aac-stereo',
        url: '/tests/generated/reference-h264-aac-stereo.mkv',
        name: 'reference-h264-aac-stereo.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'aac',
        expectedVideoCodec: 'h264',
      },
      {
        label: 'mkv-hevc-eac3-5.1',
        url: '/tests/generated/reference-hevc-eac3-5.1.mkv',
        name: 'reference-hevc-eac3-5.1.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'eac3',
        expectedVideoCodec: 'hevc',
      },
      {
        label: 'mkv-multitrack-reversed',
        url: '/tests/generated/reference-multitrack-reversed.mkv',
        name: 'reference-multitrack-reversed.mkv',
        type: 'video/x-matroska',
        language: 'eng',
        expectedCodec: 'ac3',
        expectedVideoCodec: 'h264',
        expectedTitle: 'English main 5.1',
        minAudioTracks: 2,
      },
      {
        label: 'mkv-long-seek-window',
        url: '/tests/generated/reference-long-seek.mkv',
        name: 'reference-long-seek.mkv',
        type: 'video/x-matroska',
        language: 'ita',
        expectedCodec: 'aac',
        expectedVideoCodec: 'h264',
        minDuration: 124,
        seekTo: 62.5,
        stopAt: 68.0,
        seekToleranceBefore: 5.0,
      },
      {
        label: 'wav',
        url: '/tests/generated/reference-audio.wav',
        name: 'reference-audio.wav',
        type: 'audio/wav',
        expectedCodec: 'pcm_s16le',
      },
    ];

    const references = {};
    for (const spec of specs) {
      references[spec.label] = await runSpeechReference(module, model, spec);
    }

    const srt = await runSubtitleReference(module);
    const legacyRomanianSrt = await runLegacyRomanianSubtitle(module);

    finish('pass', {
      model: {
        sampleformat: model.sampleformat,
        samplerate: model.samplerate,
      },
      fixtureManifest,
      references,
      srt,
      legacyRomanianSrt,
    });
  } catch (error) {
    const normalized = normalizeError(module, error);
    phase('error', normalized);
    finish('fail', normalized);
  }
}

run();
