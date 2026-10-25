'use strict';
const assert = require('node:assert/strict');
const {auditSrtPair,parseSrt} = require('../../scripts/audit-srt-pair.js');
function ms(v) {
  const h=Math.floor(v/3600000),m=Math.floor(v/60000)%60,s=Math.floor(v/1000)%60,r=v%1000;
  return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':')+','+String(r).padStart(3,'0');
}
function srt(offset=0, bodyPrefix='Fraza', n=9, change=()=>0) {
  return '\uFEFF'+Array.from({length:n},(_,i)=>{
    const a=10000 + i*3000 + offset + change(i),b=a+1500;
    return (i+1)+'\r\n'+ms(a)+' --> '+ms(b)+'\r\n'+bodyPrefix+' '+(i+1);
  }).join('\r\n\r\n')+'\r\n';
}
const good=auditSrtPair(srt(0),srt(10000));
assert.strictEqual(good.comparable,true);
assert.strictEqual(good.cueCountOriginal,9);
assert.strictEqual(good.singleExactShiftMs,10000);
assert.deepStrictEqual(good.thirdMedianStartShiftMs,[10000,10000,10000]);
assert.strictEqual(good.shiftValueCount,1);
assert.strictEqual(good.maxDeviationFromFirstShiftMs,0);
assert.strictEqual(good.cuePayloadsIdentical,true);
assert.strictEqual(good.allDurationsPreserved,true);
assert.strictEqual(good.audioReferenceChecked,false);
assert.strictEqual(good.alignmentWithSoundtrackVerified,false);
assert(!JSON.stringify(good).includes('Fraza'), 'never include subtitle content in report');

const nonuniform=auditSrtPair(srt(0),srt(10000,'Fraza',9,i=>i>=4?8000:0));
assert.strictEqual(nonuniform.comparable,true);
assert.strictEqual(nonuniform.singleExactShiftMs,null);
assert.strictEqual(nonuniform.shiftValueCount,2);
assert.strictEqual(nonuniform.editionCutEstablished,false);
assert.deepStrictEqual(nonuniform.startShiftRangeMs,[10000,18000]);

const drift=auditSrtPair(srt(0),srt(10000,'Fraza',9,i=>i*15));
assert.strictEqual(drift.singleExactShiftMs,null);
assert.strictEqual(drift.shiftValueCount,9);
assert.strictEqual(drift.maxDeviationFromFirstShiftMs,120);

const wrongText=auditSrtPair(srt(0),srt(10000,'Alt text'));
assert.strictEqual(wrongText.comparable,false);
assert.strictEqual(wrongText.reason,'cue-text-or-index-mismatch');
assert(!Object.hasOwn(wrongText,'singleExactShiftMs'));
const fewer=auditSrtPair(srt(0),srt(10000,'Fraza',8));
assert.strictEqual(fewer.reason,'different-cue-count');
assert.strictEqual(parseSrt(srt(0)).length,9);
assert.throws(()=>parseSrt(''),/empty-srt/);
assert.throws(()=>parseSrt('1\n00:00:01,000 --> 00:00:00,999\nA'),/invalid-or-disordered-timing/);
assert.throws(()=>parseSrt('1\n00:00:01,000 -> 00:00:02,000\nA'),/invalid-timing-line/);
assert.throws(()=>parseSrt('1\n00:00:01,000 --> 00:00:02,000\nA\n\n1\n00:00:03,000 --> 00:00:04,000\nB'),/duplicate-or-out-of-order-index/);
assert.throws(()=>parseSrt('1\n00:00:06,000 --> 00:00:07,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB'),/invalid-or-disordered-timing/);
console.log('Private SRT pair local timing audit: PASS');
