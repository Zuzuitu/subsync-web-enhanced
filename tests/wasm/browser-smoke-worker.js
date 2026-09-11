importScripts('/web/scripts/extractor.js');

function finish(status, details) {
  self.postMessage({ status, details });
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

    module = await gizmo({
      locateFile: path => '/web/scripts/' + path,
      print: text => console.log('[wasm]', text),
      printErr: text => console.warn('[wasm]', text),
    });

    const FS = module.FS;
    assert(FS && FS.filesystems && FS.filesystems.WORKERFS, 'WORKERFS is not available');

    const mkvFile = await fetchAsFile(
      '/tests/generated/reference-aac.mkv',
      'reference-aac.mkv',
      'video/x-matroska'
    );

    FS.mkdir('/mkv');
    FS.mount(FS.filesystems.WORKERFS, { files: [mkvFile] }, '/mkv');

    let mkvDemux;
    let audioDec;
    let mkvPackets = 0;
    let mkvStreams;
    let mkvDuration;

    try {
      mkvDemux = new module.Demux('/mkv/reference-aac.mkv');
      mkvStreams = mkvDemux.getStreamsInfo();
      mkvDuration = mkvDemux.getDuration();

      const audio = mkvStreams.find(stream => stream.type === 'audio');
      assert(audio, 'Generated MKV has no audio stream according to WASM demux');
      assert(audio.codec === 'aac', `Expected AAC audio stream, got ${audio.codec}`);
      assert(mkvDuration > 0, `Expected positive MKV duration, got ${mkvDuration}`);

      audioDec = new module.AudioDec();
      mkvDemux.connectDec(audioDec, audio.no);
      mkvDemux.start();

      while (mkvDemux.step()) {
        mkvPackets += 1;
        if (mkvPackets > 10000) throw new Error('MKV demux safety limit exceeded');
      }

      mkvDemux.stop();
      assert(mkvPackets > 0, 'MKV demux produced zero packets');
    } finally {
      if (audioDec) audioDec.delete();
      if (mkvDemux) mkvDemux.delete();
      FS.unmount('/mkv');
    }

    const srtFile = await fetchAsFile(
      '/tests/generated/target.srt',
      'target.srt',
      'application/x-subrip'
    );

    FS.mkdir('/srt');
    FS.mount(FS.filesystems.WORKERFS, { files: [srtFile] }, '/srt');

    let srtDemux;
    let subtitleDec;
    let subtitlePackets = 0;
    const subtitleEvents = [];
    let srtStreams;

    try {
      srtDemux = new module.Demux('/srt/target.srt');
      srtStreams = srtDemux.getStreamsInfo();

      const subtitle = srtStreams.find(stream => stream.type === 'subtitle/text');
      assert(subtitle, 'Generated SRT was not recognized as a text subtitle stream');

      subtitleDec = new module.SubtitleDec();
      subtitleDec.setEncoding('UTF-8');
      subtitleDec.setMinWordLen(1);
      subtitleDec.addSubsListener(event => subtitleEvents.push(event));
      srtDemux.connectDec(subtitleDec, subtitle.no);
      srtDemux.start();

      while (srtDemux.step()) {
        subtitlePackets += 1;
        if (subtitlePackets > 10000) throw new Error('SRT demux safety limit exceeded');
      }

      srtDemux.stop();
      assert(subtitlePackets > 0, 'SRT demux produced zero packets');
      assert(subtitleEvents.length > 0, 'Subtitle decoder emitted no subtitle events');
    } finally {
      if (subtitleDec) subtitleDec.delete();
      if (srtDemux) srtDemux.delete();
      FS.unmount('/srt');
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
    finish('fail', normalizeError(module, error));
  }
}

run();
