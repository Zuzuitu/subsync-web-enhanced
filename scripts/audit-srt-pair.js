'use strict';

// Local-only, read-only audit of an SRT pair. This tool intentionally does
// NOT decide whether either SRT aligns to a soundtrack or confirms a cut.
const fs = require('fs');

const TIME_LINE = /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3})\s*-->\s*(\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/;
function toMs(match, start) {
  return ((+match[start] * 3600 + +match[start + 1] * 60 + +match[start + 2]) * 1000
    + +match[start + 3]);
}
function parseSrt(input) {
  if (typeof input !== 'string' || input.length === 0) throw Error('empty-srt');
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw Error('empty-srt');
  const blocks = normalized.split(/\n[ \t]*\n/);
  if (blocks.length > 100000) throw Error('too-many-cues');
  const cues = [];
  let lastStart = -1;
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3 || !/^\d+$/.test(lines[0].trim())) throw Error('invalid-cue-index');
    const match = TIME_LINE.exec(lines[1].trim());
    if (!match) throw Error('invalid-timing-line');
    const start = toMs(match, 1), end = toMs(match, 5);
    if (!(end > start) || start < lastStart) throw Error('invalid-or-disordered-timing');
    const body = lines.slice(2).join('\n');
    if (!body.trim()) throw Error('empty-cue-body');
    const index = lines[0].trim();
    if (cues.length && BigInt(index) <= BigInt(cues[cues.length - 1].index)) {
      throw Error('duplicate-or-out-of-order-index');
    }
    cues.push({index, start, end, body});
    lastStart = start;
  }
  return cues;
}
function median(values) {
  const v = values.slice().sort((a,b) => a-b);
  return v.length % 2 ? v[(v.length-1)/2] : (v[v.length/2 - 1]+v[v.length/2])/2;
}
function auditSrtPair(original, shifted) {
  const left = parseSrt(original), right = parseSrt(shifted);
  const report = {
    schemaVersion: 1,
    scope: 'local-srt-timing-pair-only',
    readOnly: true,
    audioReferenceChecked: false,
    alignmentWithSoundtrackVerified: false,
    editionCutEstablished: false,
    comparable: false,
    cueCountOriginal: left.length,
    cueCountShifted: right.length,
  };
  if (left.length !== right.length) return {...report, reason: 'different-cue-count'};
  const starts = [], ends = [];
  for (let i=0;i<left.length;i++) {
    const a=left[i], b=right[i];
    if (a.index !== b.index || a.body !== b.body) {
      return {...report, reason:'cue-text-or-index-mismatch', firstMismatchCueOrdinal: i+1};
    }
    starts.push(b.start-a.start);
    ends.push(b.end-a.end);
  }
  const changes = starts.concat(ends);
  const unique = new Set(changes);
  const base = changes[0];
  const thirds = [[],[],[]];
  for (let i=0;i<starts.length;i++) {
    const bucket = Math.min(2,Math.floor(3*i/starts.length));
    thirds[bucket].push(starts[i]);
  }
  return {
    ...report,
    comparable: true,
    cuePayloadsIdentical: true,
    allDurationsPreserved: left.every((a,i)=>a.end-a.start===right[i].end-right[i].start),
    firstShiftMs: base,
    singleExactShiftMs: unique.size === 1 ? base : null,
    shiftValueCount: unique.size,
    startShiftRangeMs: [starts.reduce((a,b)=>Math.min(a,b), Infinity), starts.reduce((a,b)=>Math.max(a,b), -Infinity)],
    endShiftRangeMs: [ends.reduce((a,b)=>Math.min(a,b), Infinity), ends.reduce((a,b)=>Math.max(a,b), -Infinity)],
    firstMiddleLastStartShiftMs: [starts[0], starts[Math.floor(starts.length/2)], starts.at(-1)],
    thirdMedianStartShiftMs: thirds.map(xs=>xs.length?median(xs):null),
    maxDeviationFromFirstShiftMs: changes.reduce((a,x)=>Math.max(a,Math.abs(x-base)),0),
    interpretation: unique.size===1
      ? 'Exact uniform timestamp transformation; soundtrack alignment not verified.'
      : 'Nonuniform SRT timestamp transformation; cannot infer audio edits from SRT alone.'
  };
}
function auditFilePair(originalPath, shiftedPath) {
  return auditSrtPair(fs.readFileSync(originalPath,'utf8'),
    fs.readFileSync(shiftedPath,'utf8'));
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('Usage: node scripts/audit-srt-pair.js ORIGINAL.srt DECALARE.srt');
    process.exitCode=2;
  } else {
    try {
      const report=auditFilePair(args[0],args[1]);
      console.log(JSON.stringify(report,null,2)); // never prints filenames or dialogue
      if (!report.comparable) process.exitCode=1;
    } catch (err) {
      console.error('SRT audit unavailable: '+err.message);
      process.exitCode=1;
    }
  }
}
module.exports = {parseSrt,auditSrtPair,auditFilePair};
