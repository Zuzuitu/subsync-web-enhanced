const STAGE_LABELS = {
  initialization: 'Initialization',
  'language-assets': 'Language data',
  'pipeline-open': 'Media pipeline',
  demux: 'Demux / container read',
  'audio-decode': 'Audio decoding',
  resampler: 'Audio resampling',
  'speech-recognition': 'Speech recognition',
  'subtitle-decode': 'Subtitle decoding',
  dictionary: 'Dictionary / translation',
  processing: 'Media processing',
  correlation: 'Correlation',
  unknown: 'Unknown stage',
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || STAGE_LABELS.unknown;
}

export function classifyErrorStage(err, fallback) {
  const module = err && typeof err.module === 'string' ? err.module : '';

  if (module.indexOf('Demux') === 0) return 'demux';
  if (module.indexOf('AudioDec') === 0) return 'audio-decode';
  if (module.indexOf('Resampler') === 0) return 'resampler';
  if (module.indexOf('SpeechRecognition') === 0) return 'speech-recognition';
  if (module.indexOf('SubtitleDec') === 0) return 'subtitle-decode';
  if (module.indexOf('Translator') === 0 || module.indexOf('Dictionary') === 0) {
    return 'dictionary';
  }

  return fallback || 'unknown';
}

export function annotateErrorStage(err, fallback) {
  if (err && typeof err === 'object') {
    if (!err.stage) {
      err.stage = classifyErrorStage(err, fallback);
    }
    return err;
  }

  const wrapped = new Error(String(err));
  wrapped.stage = fallback || 'unknown';
  return wrapped;
}

export function makeFailureDiagnosis(status, settings) {
  const diagnostics = status && status.diagnostics ? status.diagnostics : {};
  const errors = diagnostics.errors || [];
  const latestError = errors.length ? errors[errors.length - 1] : null;

  if (latestError) {
    return {
      stage: latestError.stage || 'unknown',
      title: stageLabel(latestError.stage),
      detail: latestError.message || 'The stage reported an error.',
      kind: 'error',
    };
  }

  const subWords = diagnostics.subWords || 0;
  const refWords = diagnostics.refWords || 0;
  const subtitles = diagnostics.subtitles || 0;
  const points = status && status.points != null ? status.points : 0;
  const factor = status && status.factor != null ? status.factor : 0;
  const maxDistance = status && status.maxDistance != null ? status.maxDistance : null;

  if (subtitles === 0) {
    return {
      stage: 'subtitle-decode',
      title: 'No subtitle cues were decoded',
      detail: 'Check the selected subtitle stream, subtitle format and character encoding.',
      kind: 'evidence',
    };
  }

  if (subWords === 0) {
    return {
      stage: 'dictionary',
      title: 'No usable subtitle words were produced',
      detail: 'The subtitle stream was read, but no words reached correlation. Check language selection, text content and dictionary compatibility.',
      kind: 'evidence',
    };
  }

  if (refWords === 0) {
    return {
      stage: 'speech-recognition',
      title: 'No usable reference words were produced',
      detail: 'The reference path finished without a reported decoder error, but no words reached correlation. Check the selected audio track, language and speech model.',
      kind: 'evidence',
    };
  }

  if (settings && points < settings.minPointsNo) {
    return {
      stage: 'correlation',
      title: 'Not enough synchronization points',
      detail: `Correlation found ${points} point${points === 1 ? '' : 's'}; the configured minimum is ${settings.minPointsNo}.`,
      kind: 'evidence',
    };
  }

  if (settings && factor < settings.minCorrelation) {
    return {
      stage: 'correlation',
      title: 'Correlation confidence is below the required threshold',
      detail: `Measured correlation is ${(factor * 100).toFixed(2)}%; the configured threshold is ${(settings.minCorrelation * 100).toFixed(2)}%.`,
      kind: 'evidence',
    };
  }

  if (settings && maxDistance != null && maxDistance > settings.maxPointDist) {
    return {
      stage: 'correlation',
      title: 'Synchronization points are too far apart',
      detail: `Maximum point distance is ${maxDistance.toFixed(2)} s; the configured limit is ${settings.maxPointDist.toFixed(2)} s.`,
      kind: 'evidence',
    };
  }

  return {
    stage: 'correlation',
    title: 'Correlation did not produce a reliable result',
    detail: 'Media processing completed, but the available evidence was not strong enough to accept a timing correction.',
    kind: 'evidence',
  };
}
