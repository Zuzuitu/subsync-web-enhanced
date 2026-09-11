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

async function fetchAsFile(url, name, type) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new File([blob], name, { type });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  let module;
  try {
    assert(typeof gizmo === 'function', 'Emscripten extractor factory is not available');

    phase('wasm-prefetch:start');
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
    assert(wasmBinary.byteLength > 0, 'extractor.wasm is empty');

    phase('module-init:start');
    module = await gizmo({
      wasmBinary,
      locateFile: path => '/web/scripts/' + path,
      print: text => console.log('[wasm]', text),
      printErr: text => console.warn('[wasm]', text),
      monitorRunDependencies: left => phase('module-run-dependencies', { left }),
      onRuntimeInitialized: () => phase('module-runtime-initialized'),
      onAbort: reason => phase('module-abort', { reason: String(reason) }),
    });
    phase('module-init:done');

    const FS = module.FS;
    assert(FS && FS.filesystems && FS.filesystems.WORKERFS, 'WORKERFS is not available');
    phase('workerfs-available');

    phase('mkv-fetch:start');
    const mkvFile = await fetchAsFile(
      '/tests/generated/reference-aac.mkv',
      'reference-aac.mkv',
      'video/x-matroska'
    );
    phase('mkv-fetch:done', { size: mkvFile.size });

    phase('mkv-mount:start');
    FS.mkdir('/mkv');
    FS.mount(FS.filesystems.WORKERFS, { files: [mkvFile] }, '/mkv');
    phase('mkv-mount:done');

    let mkvDemux;
    let audioDec;
    let mkvPackets = 0;
    let mkvStreams;
    let mkvDuration;

    try {
      phase('mkv-demux-construct:start');
      mkvDemux = new module.Demux('/mkv/reference-aac.mkv');
      phase('mkv-demux-construct:done');

      phase('mkv-stream-info:start');
      mkvStreams = mkvDemux.getStreamsInfo();
      phase('mkv-stream-info:done', { streams: mkvStreams });

      phase('mkv-duration:start');
      mkvDuration = mkvDemux.getDuration();
      phase('mkv-duration:done', { duration: mkvDuration });

      const audio = mkvStreams.find(stream => stream.type === 'audio');
      assert(audio, 'Generated MKV has no audio stream according to WASM demux');
      assert(audio.codec === 'aac', `Expected AAC audio stream, got ${audio.codec}`);
      assert(mkvDuration > 0, `Expected positive MKV duration, got ${mkvDuration}`);
      phase('mkv-audio-stream-selected', { stream: audio });

      phase('audio-decoder-construct:start');
      audioDec = new module.AudioDec();
      phase('audio-decoder-construct:done');

      phase('audio-decoder-connect:start');
      mkvDemux.connectDec(audioDec, audio.no);
      phase('audio-decoder-connect:done');

      phase('mkv-demux-start:start');
      mkvDemux.start();
      phase('mkv-demux-start:done');

      phase('mkv-demux-loop:start');
      while (mkvDemux.step()) {
        mkvPackets += 1;
        if (mkvPackets <= 5 || mkvPackets % 25 === 0) {
          phase('mkv-demux-loop:progress', { packets: mkvPackets });
        }
        if (mkvPackets > 10000) throw new Error('MKV demux safety limit exceeded');
      }
      phase('mkv-demux-loop:done', { packets: mkvPackets });

      phase('mkv-demux-stop:start');
      mkvDemux.stop();
      phase('mkv-demux-stop:done');

      assert(mkvPackets > 0, 'MKV demux produced zero packets');
    } finally {
      phase('mkv-cleanup:start');
      if (audioDec) audioDec.delete();
      if (mkvDemux) mkvDemux.delete();
      FS.unmount('/mkv');
      phase('mkv-cleanup:done');
    }

    phase('srt-fetch:start');
    const srtFile = await fetchAsFile(
      '/tests/generated/target.srt',
      'target.srt',
      'application/x-subrip'
    );
    phase('srt-fetch:done', { size: srtFile.size });

    phase('srt-mount:start');
    FS.mkdir('/srt');
    FS.mount(FS.filesystems.WORKERFS, { files: [srtFile] }, '/srt');
    phase('srt-mount:done');

    let srtDemux;
    let subtitleDec;
    let subtitlePackets = 0;
    const subtitleEvents = [];
    let srtStreams;

    try {
      phase('srt-demux-construct:start');
      srtDemux = new module.Demux('/srt/target.srt');
      phase('srt-demux-construct:done');

      phase('srt-stream-info:start');
      srtStreams = srtDemux.getStreamsInfo();
      phase('srt-stream-info:done', { streams: srtStreams });

      const subtitle = srtStreams.find(stream => stream.type === 'subtitle/text');
      assert(subtitle, 'Generated SRT was not recognized as a text subtitle stream');
      phase('srt-subtitle-stream-selected', { stream: subtitle });

      subtitleDec = new module.SubtitleDec();
      subtitleDec.setEncoding('UTF-8');
      subtitleDec.setMinWordLen(1);
      subtitleDec.addSubsListener(event => subtitleEvents.push(event));
      phase('subtitle-decoder-ready');

      srtDemux.connectDec(subtitleDec, subtitle.no);
      phase('subtitle-decoder-connected');

      srtDemux.start();
      phase('srt-demux-started');

      phase('srt-demux-loop:start');
      while (srtDemux.step()) {
        subtitlePackets += 1;
        if (subtitlePackets <= 5 || subtitlePackets % 25 === 0) {
          phase('srt-demux-loop:progress', { packets: subtitlePackets });
        }
        if (subtitlePackets > 10000) throw new Error('SRT demux safety limit exceeded');
      }
      phase('srt-demux-loop:done', {
        packets: subtitlePackets,
        events: subtitleEvents.length,
      });

      srtDemux.stop();
      phase('srt-demux-stopped');

      assert(subtitlePackets > 0, 'SRT demux produced zero packets');
      assert(subtitleEvents.length > 0, 'Subtitle decoder emitted no subtitle events');
    } finally {
      phase('srt-cleanup:start');
      if (subtitleDec) subtitleDec.delete();
      if (srtDemux) srtDemux.delete();
      FS.unmount('/srt');
      phase('srt-cleanup:done');
    }

    finish('pass', {
      mkv: {
        duration: mkvDuration,
        packets: mkvPackets,
        streams: mkvStreams,
      },
      srt: {
        packets: subtitlePackets,
        events: subtitleEvents.length,
        streams: srtStreams,
      },
    });
  } catch (error) {
    const normalized = normalizeError(module, error);
    phase('error', normalized);
    finish('fail', normalized);
  }
}

run();
