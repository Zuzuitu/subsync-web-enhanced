#!/usr/bin/env node
'use strict';
// Issue #111 synthetic-only order test. No audio or transcripts in logs.
// Baseline asserts that unmodified WASM shows the recorded order defect.
// Regression asserts equal fresh/reused output with unchanged input/model.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'), mode=process.argv[2];
if(!['--baseline','--regression','--survey','--espeak-survey','--espeak-baseline','--espeak-regression'].includes(mode)) throw Error('Use a valid issue #111 probe mode');
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
  assert.ok(pcm && pcm.length>=480000);
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
  if(mode==='--espeak-baseline'||mode==='--espeak-regression'){
    // Verified public-safe A/B ordering cases from issue #111; same exact
    // Float32Array target is replayed fresh and after a prior synthetic probe.
    function readGenerated(name){
      const file=path.join(root,'tests/generated/issue111-espeak',name+'.wav');
      const bytes=readWav(fs.readFileSync(file));
      assert.equal(bytes.length,480000,'expected exactly 15 seconds of PCM16');
      const pcm=new Float32Array(240000);
      for(let i=0;i<pcm.length;i++) pcm[i]=bytes.readInt16LE(i*2)/32768;
      return pcm;
    }
    const speechA=readGenerated('A'),speechB=readGenerated('B');
    const softA=Float32Array.from(speechA,x=>x*0.3);
    const gatedB=Float32Array.from(speechB,(x,i)=>Math.floor(i/8000)%2===0?0:x);
    const cases=[
      {name:'originalA_originalB',prior:speechA,target:speechB},
      {name:'originalA_gatedB',prior:speechA,target:gatedB},
      {name:'softA_gatedB',prior:softA,target:gatedB}
    ];
    let lexicalMismatches=0,fullMismatches=0;
    const referencePath=path.join(root,'tests/generated/issue111-espeak/original-fresh-outputs.sha256.json');
    const digest=(value)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const modelDigest=crypto.createHash('sha256').update(model).digest('hex');
    const reference=mode==='--espeak-regression'?
      JSON.parse(fs.readFileSync(referencePath,'utf8')):
      {format:1,modelSha256:modelDigest,freshOutputs:{}};
    assert.equal(reference.format,1,'missing candidate comparison schema');
    assert.equal(reference.modelSha256,modelDigest,'model changed between baseline and candidate');
    if(mode==='--espeak-regression'){
      assert.deepEqual(
        Object.keys(reference.freshOutputs).sort(),
        cases.map(entry=>entry.name).sort(),
        'baseline cases missing or unexpected'
      );
    }
    const fullEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const wordsEqual=(a,b)=>a.length===b.length&&a.every((w,i)=>w.text===b[i].text);
    const timesEqual=(a,b)=>a.length===b.length&&a.every((w,i)=>
      w.time===b[i].time&&w.duration===b[i].duration);
    const scoresEqual=(a,b)=>a.length===b.length&&a.every((w,i)=>w.score===b[i].score);
    for(const entry of cases){
      const fresh=run([entry.target])[0];
      const freshRepeat=run([entry.target])[0];
      const after=run([entry.prior,entry.target])[1];
      const afterRepeat=run([entry.prior,entry.target])[1];
      assert.ok(fresh.length>0,'inconclusive: silent fresh result');
      assert.ok(fullEqual(fresh,freshRepeat),'inconclusive: unstable fresh control');
      assert.ok(fullEqual(after,afterRepeat),'inconclusive: unstable reused control');
      if(mode==='--espeak-regression'){
        assert.equal(digest(fresh),reference.freshOutputs[entry.name],
          'candidate modified previously verified fresh-instance decoding');
      }else{
        reference.freshOutputs[entry.name]=digest(fresh);
      }
      const lexicalEqual=wordsEqual(fresh,after);
      const equal=fullEqual(fresh,after);
      if(!lexicalEqual) lexicalMismatches++;
      if(!equal) fullMismatches++;
      console.log(JSON.stringify({
        issue111Strict:true,phase:mode.slice(2),case:entry.name,
        freshCount:fresh.length,reusedCount:after.length,
        lexicalEqual,timesEqual:timesEqual(fresh,after),
        scoresEqual:scoresEqual(fresh,after),fullEqual:equal,
        freshStable:true,reusedStable:true
      }));
      if(mode==='--espeak-regression'){
        assert.ok(equal,'candidate leaves history-dependent Whisper output');
      }
    }
    console.log(JSON.stringify({
      issue111StrictSummary:true,phase:mode.slice(2),
      cases:cases.length,lexicalMismatches,fullMismatches
    }));
    if(mode==='--espeak-baseline'){
      assert.ok(lexicalMismatches>=1,
        'unmodified WASM did not reproduce a lexical difference on synthetic input');
      fs.writeFileSync(referencePath,JSON.stringify(reference,null,2)+'\n');
      console.log('ISSUE111_SYNTHETIC_LEXICAL_RED_REPRODUCED');
    }else{
      console.log('ISSUE111_SYNTHETIC_GREEN_CANDIDATE_ONLY_AND_FRESH_PARITY');
    }
    return;
  }
  if(mode==='--espeak-survey'){
    // Numeric-only exploration of independent, generated eSpeak Romanian speech.
    // No private media, words, transcripts, or PCM fingerprints in logs.
    function fromGeneratedWav(name){
      const file=path.join(root,'tests/generated/issue111-espeak',name+'.wav');
      const data=readWav(fs.readFileSync(file));
      assert.equal(data.length,480000,'eSpeak probe must contain exactly 15s');
      const pcm=new Float32Array(240000);
      for(let i=0;i<pcm.length;i++)pcm[i]=data.readInt16LE(i*2)/32768;
      return pcm;
    }
    function transform(source,kind){
      const dest=new Float32Array(source.length);
      let state=0x193c02ee;
      for(let i=0;i<source.length;i++){
        let x=source[i];
        if(kind==='soft')x*=0.3;
        if(kind==='gated'&&Math.floor(i/8000)%2===0)x=0;
        if(kind==='noise'){
          state^=state<<13;state^=state>>>17;state^=state<<5;
          x+=(state/2147483648)*0.05;
        }
        dest[i]=Math.max(-1,Math.min(1,x));
      }
      return dest;
    }
    const A=fromGeneratedWav('A'),B=fromGeneratedWav('B');
    const contexts=[
      {name:'normalA',pcm:A},
      {name:'softA',pcm:transform(A,'soft')},
      {name:'noiseA',pcm:transform(A,'noise')}
    ];
    const targets=[
      {name:'normalB',pcm:B},
      {name:'gatedB',pcm:transform(B,'gated')},
      {name:'noiseB',pcm:transform(B,'noise')}
    ];
    const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
    let comparisons=0,differences=0;
    for(const target of targets){
      const fresh=run([target.pcm])[0];
      for(const prior of contexts){
        const actual=run([prior.pcm,target.pcm])[1];
        const equal=same(fresh,actual);
        comparisons++;
        if(!equal)differences++;
        console.log(JSON.stringify({
          espeakSurvey:true,prior:prior.name,target:target.name,
          freshCount:fresh.length,afterCount:actual.length,equal,
          inconclusive:fresh.length===0
        }));
      }
    }
    console.log(JSON.stringify({espeakSummary:true,comparisons,differences}));
    return;
  }
  if(mode==='--survey'){
    // Discovery-only. The strict --baseline gate below remains unchanged.
    // Synthetic speech generated by the pinned CI Piper fixture; no private inputs.
    const initialB=run([b])[0];
    const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
    let differences=0, trials=0;
    function inspect(label, target, indices, cachedFresh=null){
      const baseline=cachedFresh||run([target])[0];
      for(const index of indices){
        const probe=getWindow(index);
        const reused=run([probe,target])[1];
        const equal=same(baseline,reused);
        trials++;
        if(!equal) differences++;
        console.log(JSON.stringify({
          survey:true, variant:label, aIndex:index, bIndex:47,
          freshCount:baseline.length, afterCount:reused.length,
          equal, inconclusive:baseline.length===0
        }));
      }
    }
    function perturb(source, option){
      const dest=new Float32Array(source.length);
      let seed=0x51c31d77;
      for(let i=0;i<source.length;i++){
        let x=source[i]*(option.gain??1);
        if(option.noise){
          seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
          x+=(seed/2147483648)*option.noise;
        }
        if(option.gate && (Math.floor(i/6400)%2===0))x=0;
        dest[i]=Math.max(-1,Math.min(1,x));
      }
      return dest;
    }
    inspect('clean',b,[0,12,35,59,71],initialB);
    for(const candidate of [
      {name:'low-gain',gain:0.25},
      {name:'noise-025',noise:0.025},
      {name:'noise-080',noise:0.08},
      {name:'gated',gate:true}
    ]){
      inspect(candidate.name,perturb(b,candidate),[12,71]);
    }
    console.log(JSON.stringify({surveySummary:true,trials,differences}));
    return;
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
