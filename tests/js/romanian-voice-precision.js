'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const fixture = require('../fixtures/romanian-voice-affine-retained.json');
const { selectRomanianPrecisionRefinement } = require('../../web/src/romanian-precision.js');
const { voicePrecisionRefinement } = require('../../web/src/romanian-voice-precision.js');
const status = { correlated: true, formula: fixture.canonical, precision: fixture.precision };
const correction = selectRomanianPrecisionRefinement(status, {verified:true},
  fixture.events, fixture.duration, fixture.voice);
const expected = fixture.expectedEvaluationOnly;
const starts = fixture.events.map(x=>x.start);
const span = Math.max(...starts)-Math.min(...starts);
assert(Math.abs((correction.formula.a-expected.a)*span) < .35,
  'retained synthetic failure must meet the unchanged ±0.35-second drift limit');
const mae = formula=>starts.reduce((s,x)=>s+Math.abs(formula.a*x+formula.b-(expected.a*x+expected.b)),0)/starts.length;
assert(mae(correction.formula) < mae(fixture.existing)/2,
  'independently verified speech timing must materially improve full-title timing');
assert.equal(correction.method, 'voice-validated-affine');
assert.equal(correction.voiceValidationFolds, 3);
assert(correction.mappedDeltaSeconds <= .75+1e-9);
assert(correction.voiceMinimumValidationGain >= .02);
assert(correction.voiceScore > .9);

// All existing canonical and cue-balance guards still apply.
assert.equal(selectRomanianPrecisionRefinement(status,{verified:false},fixture.events,
  fixture.duration,fixture.voice),null);
const noVoice=selectRomanianPrecisionRefinement(status,{verified:true},fixture.events,fixture.duration);
assert.deepStrictEqual(noVoice.formula,fixture.existing);

const refine = voice=>voicePrecisionRefinement(voice,fixture.events,fixture.duration,
  fixture.canonical,fixture.existing,fixture.precision.fitPointTimes,.75);
assert.equal(refine({...fixture.voice,windows:[null,...fixture.voice.windows.slice(1)]}),null);
assert.equal(refine({...fixture.voice,windows:[fixture.voice.windows[0],...fixture.voice.windows]}),null,
  'duplicate/overlapping PCM cannot leak into independent validation');
assert.equal(refine({...fixture.voice,windows:fixture.voice.windows.slice(0,8)}),null);
assert.equal(refine({...fixture.voice,activity:fixture.voice.activity.map(x=>({...x,energy:0}))}),null);
assert.equal(refine({...fixture.voice,activity:[{time:NaN,energy:.5},...fixture.voice.activity.slice(1)]}),null);
assert.equal(refine({...fixture.voice,activity:fixture.voice.activity.map(x=>({
  ...x,energy:x.time>fixture.duration*2/3?1-x.energy:x.energy}))}),null,
  'a contradictory final third cannot be hidden by improvements elsewhere');
const unbalanced={...status,precision:{...fixture.precision,beginningBuckets:4,middleBuckets:14,endBuckets:10}};
assert.equal(selectRomanianPrecisionRefinement(unbalanced,{verified:true},fixture.events,
  fixture.duration,fixture.voice),null);

// A separate synthetic timeline proves true speed/drift is supported: no
// constant offset assumption and no needless alteration of already correct fit.
const duration=600, truth={a:1.004,b:-10};
const events=Array.from({length:40},(_,i)=>({start:12+14*i,end:14.5+14*i}));
const windows=Array.from({length:9},(_,i)=>[20+i*60,35+i*60]);
const occupied=time=>events.some(event=>time>=event.start&&time<=event.end);
const activity=windows.flatMap(([start,end])=>Array.from({length:60},(_,i)=>{
  const time=start+(i+.5)*.25;
  return {time,energy:occupied((time-truth.b)/truth.a)?.95:.02};
}));
const pairs=events.flatMap(event=>[event.start+.5,event.start+1.5].map(x=>[x,truth.a*x+truth.b]));
assert.equal(voicePrecisionRefinement({activity,windows},events,duration,truth,truth,pairs,.75),null,
  'true frame-rate drift must be preserved when the current fit is already correct');
const biased={a:truth.a+.0008,b:truth.b-.3};
const drift=voicePrecisionRefinement({activity,windows},events,duration,biased,biased,pairs,.75);
assert.equal(drift,null,'quantized binary evidence with inconsistent fold fits must stay conservative');
// Apply a real speed change to the retained independent probability profile.
// This checks equivariance without teaching the estimator a slope of one.
const speed=1.004;
const scaledVoice={activity:fixture.voice.activity.map(x=>({...x,time:x.time*speed})),
  windows:fixture.voice.windows.map(x=>x.map(time=>time*speed))};
const scaledFormula=f=>({a:f.a*speed,b:f.b*speed});
const scaled=voicePrecisionRefinement(scaledVoice,fixture.events,fixture.duration*speed,
  scaledFormula(fixture.canonical),scaledFormula(fixture.existing),
  fixture.precision.fitPointTimes.map(([x,y])=>[x,y*speed]),.75);
assert(scaled && scaled.formula.a>1.002,'a supported speed change must not be flattened to an offset');
assert(Math.abs(scaled.formula.a-speed)<Math.abs(fixture.existing.a*speed-speed));
assert(scaled.mappedDeltaSeconds<=.75+1e-9);

// The actual synchronizer guard protects the accepted offset-only VAD path
// (including the sixth MKA) and prevents a second refinement after export fit.
const source=fs.readFileSync(require.resolve('../../web/src/synchro.js'),'utf8');
const method=source.slice(source.indexOf('  applyRomanianPrecisionRefinement() {'),
  source.indexOf('  async preloadAssets('));
const sandbox={selectRomanianPrecisionRefinement(){throw new Error('must not run');}};
vm.runInNewContext('class Guard {'+method+'}\nglobalThis.Guard=Guard;',sandbox);
const guard=new sandbox.Guard();
guard.status={vadVerified:true};
assert.equal(guard.applyRomanianPrecisionRefinement(),false);
guard.status={canonicalFormula:{a:1,b:-10}};
assert.equal(guard.applyRomanianPrecisionRefinement(),false);
console.log('Romanian retained affine voice regression and canonical guards: OK');
