#!/usr/bin/env node
'use strict';
// Issue #111 synthetic-only order test. No audio or transcripts in logs.
// Baseline asserts that unmodified WASM shows the recorded order defect.
// Regression asserts equal fresh/reused output with unchanged input/model.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), mode=process.argv[2];
if(!['--baseline','--regression'].includes(mode)) throw Error('Use --baseline or --regression');
const fixturePath=path.join(root,'tests/generated/romanian-audio-e2e');
const dist=path.join(root,'web/dist');
const paths={
  model:path.join(dist,'assets/data/ggml-tiny-q5_1.bin'),
  js:path.join(dist,'scripts/whisper.js'),
  wasm:path.join(dist,'scripts/whisper.wasm'),
  wav:path.join(fixturePath,'reference-romanian.wav'),
  fixture:path.join(fixturePath,'fixture.json')
};
for(const p of Object.values(paths)) assert.ok(fs.existsSync(p),'Missing generated fixture/build asset');
const fixture=JSON.parse(fs.readFileSync(paths.fixture,'utf8'));
assert.equal(fixture.sampleRate,16000);
assert.equal(fixture.mode,'piper-ro_RO-mihai-medium');
assert.ok(fixture.phrases.length>=48);
function readWav(data){
  assert.equal(data.toString('ascii',0,4),'RIFF');
  assert.equal(data.toString('ascii',8,12),'WAVE');
  let fmt,pcm;
  for(let at=12;at+8<=data.length;){
    const name=data.toString('ascii',at,at+4), n=data.readUInt32LE(at+4);
    assert.ok(at+8+n<=data.length,'Invalid WAV chunk');
    if(name==='fmt '){
      assert.ok(n>=16);
      fmt=[data.readUInt16LE(at+8),data.readUInt16LE(at+10),
        data.readUInt32LE(at+12),data.readUInt16LE(at+22)];
    }
    if(name==='data') pcm=data.subarray(at+8,at+8+n);
    at+=8+n+(n%2);
  }
  assert.deepEqual(fmt,[1,1,16000,16]);
  assert.ok(pcm && pcm.length>480000);
  return pcm;
}
const raw=readWav(fs.readFileSync(paths.wav)), audioLength=raw.length/32000;
function getWindow(index){
  const p=fixture.phrases[index];
  assert.ok(Number.isFinite(p.audioStart)&&Number.isFinite(p.audioEnd));
  const start=Math.min(Math.max(0,p.audioStart-0.5),audioLength-15);
  const at=Math.round(start*16000), pcm=new Float32Array(240000);
  for(let i=0;i<pcm.length;i++) pcm[i]=raw.readInt16LE((at+i)*2)/32768;
  return pcm;
}
const a=getWindow(12), b=getWindow(47);
async function main(){
  const model=Uint8Array.from(fs.readFileSync(paths.model));
  const module=await require(paths.js)({
    wasmBinary:fs.readFileSync(paths.wasm),print:()=>{},printErr:()=>{}
  });
  function run(parts){
    const rec=new module.RomanianWhisperRecognition();
    try{
      rec.loadModel(model);rec.setLanguage('ro');
      rec.setMinWordProb(0.3);rec.setMinWordLen(5);
      let words=[];
      rec.setWordsCallback(w=>words.push({
        text:w.text,time:w.time,duration:w.duration,score:w.score
      }));
      const batches=[];
      for(const pcm of parts){
        words=[]; rec.feed(pcm,0);rec.discontinuity();batches.push(words);
      }
      return batches;
    }finally{rec.delete();}
  }
  const af=run([a])[0],bf=run([b])[0],ba=run([a,b])[1],
    ab=run([b,a])[1],bb=run([b,b])[1],bf2=run([b])[0];
  const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
  const checks={
    bAfterA:same(bf,ba), aAfterB:same(af,ab),
    bAfterB:same(bf,bb), freshRepeat:same(bf,bf2)
  };
  console.log(JSON.stringify({mode,counts:{
    freshA:af.length,freshB:bf.length,bAfterA:ba.length,
    aAfterB:ab.length,bAfterB:bb.length
  },checks}));
  assert.ok(af.length>0&&bf.length>0,'Inconclusive: empty synthetic windows');
  assert.ok(checks.freshRepeat,'Inconclusive: fresh run differed');
  if(mode==='--baseline'){
    assert.equal(checks.bAfterA,false,'Piper pair does not show baseline RED');
    console.log('BASELINE_RED_REPRODUCED');
  }else{
    assert.ok(Object.values(checks).every(Boolean),'Order dependence persists');
    console.log('REGRESSION_GREEN_SYNTHETIC_ONLY');
  }
}
main().catch(e=>{console.error('Issue111 synthetic test:',e.message);process.exitCode=1;});
