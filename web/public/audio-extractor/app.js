const MEDIABUNNY_URL='https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/+esm';
const MP3_ENCODER_URL='https://cdn.jsdelivr.net/npm/@mediabunny/mp3-encoder@1.60.0/+esm';
const AC3_URL='https://cdn.jsdelivr.net/npm/@mediabunny/ac3@1.60.0/+esm';
const DTS_URL='https://cdn.jsdelivr.net/npm/@mediabunny/dts@1.60.0/+esm';

let mb=null,input=null,sourceFile=null,audioTracks=[],primaryAudio=null,activeConversion=null,result=null,toastTimer=null,compatibilityToken=0;
const extensions={mp3:false,ac3:false,dts:false};
const $=id=>document.getElementById(id);
const fileInput=$('fileInput'),pickBtn=$('pickBtn'),changeFileBtn=$('changeFileBtn'),fileMeta=$('fileMeta'),tracksCard=$('tracksCard'),trackList=$('trackList'),modeCard=$('modeCard'),actionCard=$('actionCard'),compatibility=$('compatibility'),extractBtn=$('extractBtn'),cancelBtn=$('cancelBtn'),progressWrap=$('progressWrap'),progressBar=$('progressBar'),progressPct=$('progressPct'),statusText=$('statusText'),resultActions=$('resultActions'),shareBtn=$('shareBtn'),downloadBtn=$('downloadBtn'),resetBtn=$('resetBtn'),toast=$('toast');

function bytes(n){if(!Number.isFinite(n))return'—';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return n.toFixed(i<2?1:2)+' '+u[i]}
function formatDuration(s){if(!Number.isFinite(s)||s<0)return null;const t=Math.round(s),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),x=t%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`}
function safeName(n){return String(n||'audio').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').trim()||'audio'}
function baseName(n){return safeName(n).replace(/\.[^/.]+$/,'')}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showToast(m,e=false){clearTimeout(toastTimer);toast.textContent=m;toast.classList.remove('hidden','error');if(e)toast.classList.add('error');toastTimer=setTimeout(()=>toast.classList.add('hidden'),6000)}
function readableError(err){if(err?.name==='ConversionCanceledError'||err?.name==='AbortError')return'Procesarea a fost oprită.';const m=err?.message||String(err||'Eroare necunoscută');return /memory|allocation|out of memory/i.test(m)?'iOS nu mai are suficientă memorie disponibilă. Închide aplicațiile grele și încearcă din nou.':m}
async function safeCall(fn,fallback=null){try{return await fn()}catch(_){return fallback}}
async function loadEngine(){if(!mb)mb=await import(MEDIABUNNY_URL);return mb}
async function ensureMp3Encoder(){if(extensions.mp3)return;const ext=await import(MP3_ENCODER_URL);ext.registerMp3Encoder();extensions.mp3=true}
async function ensureDecoder(track){
  const codec=String(await safeCall(()=>track.getCodec(),'')||'').toLowerCase();
  const internal=String(await safeCall(()=>track.getInternalCodecId(),'')||'').toLowerCase();
  const key=`${codec} ${internal}`;
  if((key.includes('ac3')||key.includes('eac3')||key.includes('e-ac-3'))&&!extensions.ac3){const ext=await import(AC3_URL);ext.registerAc3Decoder();extensions.ac3=true}
  if(key.includes('dts')&&!extensions.dts){const ext=await import(DTS_URL);ext.registerDtsDecoder();extensions.dts=true}
  if(!await safeCall(()=>track.canDecode(),false))throw new Error(`Pista ${codec||internal||'cu codec necunoscut'} nu poate fi decodată pe acest iPhone pentru MP3. Poți încerca „Original MKA”.`);
}
async function disposeInput(){compatibilityToken++;try{input?.dispose?.()}catch(_){}input=null;sourceFile=null;audioTracks=[];primaryAudio=null}
async function cleanupResult(){if(!result)return;const old=result;result=null;resultActions.classList.add('hidden');try{if(old.opfs&&old.root&&old.entryName)await old.root.removeEntry(old.entryName)}catch(_){}}
async function resetAll(openPicker=false){if(activeConversion)return;await cleanupResult();await disposeInput();fileMeta.classList.add('hidden');tracksCard.classList.add('hidden');modeCard.classList.add('hidden');actionCard.classList.add('hidden');progressWrap.classList.add('hidden');compatibility.classList.add('hidden');trackList.innerHTML='';fileInput.value='';if(openPicker)fileInput.click()}
async function analyze(file){
  if(!file)return;await cleanupResult();await disposeInput();sourceFile=file;
  fileMeta.innerHTML=`<strong>${escapeHtml(file.name)}</strong><span>•</span><span>${bytes(file.size)}</span>`;fileMeta.classList.remove('hidden');
  tracksCard.classList.add('hidden');modeCard.classList.add('hidden');actionCard.classList.add('hidden');pickBtn.disabled=true;pickBtn.querySelector('strong').textContent='Analizez pistele…';
  try{
    const {Input,BlobSource,ALL_FORMATS}=await loadEngine();input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
    if(!await input.canRead())throw new Error('Fișierul nu poate fi citit ca MKV/MP4 compatibil.');
    const [tracks,primary,duration]=await Promise.all([input.getAudioTracks(),input.getPrimaryAudioTrack(),safeCall(()=>input.getDurationFromMetadata(undefined,{skipLiveWait:true}),null)]);
    audioTracks=tracks;primaryAudio=primary;if(!audioTracks.length)throw new Error('Nu am găsit nicio pistă audio în acest fișier.');
    const dt=formatDuration(duration);fileMeta.innerHTML=[`<strong>${escapeHtml(file.name)}</strong>`,`<span>•</span><span>${bytes(file.size)}</span>`,dt?`<span>•</span><span>${escapeHtml(dt)}</span>`:''].join('');
    await renderTracks();tracksCard.classList.remove('hidden');modeCard.classList.remove('hidden');actionCard.classList.remove('hidden');resultActions.classList.add('hidden');progressWrap.classList.add('hidden');await updateCompatibility();
  }catch(err){await disposeInput();showToast(readableError(err),true)}finally{pickBtn.disabled=false;pickBtn.querySelector('strong').textContent='Alege MKV / MP4'}
}
async function renderTracks(){
  const cards=[];
  for(let i=0;i<audioTracks.length;i++){
    const track=audioTracks[i];
    const [codec,internal,lang,name,channels,rate,disposition]=await Promise.all([safeCall(()=>track.getCodec(),null),safeCall(()=>track.getInternalCodecId(),null),safeCall(()=>track.getLanguageCode(),'und'),safeCall(()=>track.getName(),null),safeCall(()=>track.getNumberOfChannels(),null),safeCall(()=>track.getSampleRate(),null),safeCall(()=>track.getDisposition(),{})]);
    const isPrimary=primaryAudio&&track.id===primaryAudio.id,checked=isPrimary||(!primaryAudio&&i===0),language=lang&&lang!=='und'?String(lang).toUpperCase():'limbă necunoscută',title=name||`Pista audio ${track.number||i+1}`,flags=[];
    if(disposition?.default)flags.push('default');if(disposition?.commentary)flags.push('comentariu');
    const detail=[codec||internal||'codec necunoscut',language,Number.isFinite(channels)?`${channels} ch`:null,Number.isFinite(rate)?`${Math.round(rate/100)/10} kHz`:null,...flags].filter(Boolean).join(' • ');
    cards.push(`<label class="track-option"><input type="radio" name="audioTrack" value="${i}" ${checked?'checked':''}><div class="track-body"><div class="track-title">${escapeHtml(title)} ${isPrimary?'<span class="primary-tag">principală</span>':''}</div><div class="track-detail">${escapeHtml(detail)}</div></div></label>`);
  }
  trackList.innerHTML=cards.join('');trackList.querySelectorAll('input[name="audioTrack"]').forEach(el=>el.addEventListener('change',updateCompatibility));
}
function selectedTrack(){const r=document.querySelector('input[name="audioTrack"]:checked');return r?audioTracks[Number(r.value)]:null}
function selectedMode(){return document.querySelector('input[name="mode"]:checked')?.value||'mp3'}
function setCompatibility(m,k=''){compatibility.textContent=m;compatibility.className=`compatibility ${k}`.trim();compatibility.classList.remove('hidden')}
async function buildConversion(track,mode,target){
  const {Output,MkvOutputFormat,Mp3OutputFormat,Conversion}=await loadEngine(),format=mode==='mka'?new MkvOutputFormat():new Mp3OutputFormat(),output=new Output({format,target}),selectedId=track.id;
  const conversion=await Conversion.init({input,output,video:{discard:true},audio:candidate=>{if(candidate.id!==selectedId)return{discard:true};if(mode==='mka')return{};return{codec:'mp3',numberOfChannels:1,sampleRate:16000,bitrate:64000,forceTranscode:true}},copy:mode==='mka'?{mode:'forced'}:false,tags:{},showWarnings:false});
  return{conversion,output};
}
async function preflight(track,mode){
  const {NullTarget}=await loadEngine();if(mode==='mp3'){await ensureDecoder(track);await ensureMp3Encoder()}
  const {conversion}=await buildConversion(track,mode,new NullTarget()),used=conversion.utilizedTracks.some(t=>t.id===track.id);
  if(!conversion.isValid||!used){const reason=conversion.discardedTracks.find(x=>x.track?.id===track.id)?.reason;if(mode==='mka')throw new Error(`Această pistă nu poate fi copiată fără recodare într-un MKA${reason?` (${reason})`:''}.`);throw new Error(`Această pistă nu poate fi convertită în MP3 pe dispozitiv${reason?` (${reason})`:''}.`)}
}
async function updateCompatibility(){
  const track=selectedTrack();if(!track||!input)return;const mode=selectedMode(),token=++compatibilityToken;extractBtn.disabled=true;setCompatibility('Verific compatibilitatea…');
  try{await preflight(track,mode);if(token!==compatibilityToken)return;setCompatibility(mode==='mka'?'Compatibil: pista poate fi extrasă în MKA fără recodare.':'Compatibil: pista poate fi convertită în MP3 compact pe acest dispozitiv.','ok');extractBtn.disabled=false}catch(err){if(token!==compatibilityToken)return;setCompatibility(readableError(err),'error');extractBtn.disabled=true}
}
function setBusy(b){pickBtn.disabled=b;changeFileBtn.disabled=b;extractBtn.disabled=b;cancelBtn.classList.toggle('hidden',!b);document.querySelectorAll('input[name="audioTrack"],input[name="mode"]').forEach(el=>el.disabled=b)}
function setProgress(v,label){const p=Math.max(0,Math.min(1,Number(v)||0));progressWrap.classList.remove('hidden');progressBar.style.width=`${Math.round(p*100)}%`;progressPct.textContent=`${Math.round(p*100)}%`;statusText.textContent=label}
async function createOutputDestination(name){
  const {StreamTarget,BufferTarget}=await loadEngine();
  if(navigator.storage?.getDirectory){try{const root=await navigator.storage.getDirectory();try{await root.removeEntry(name)}catch(_){}const handle=await root.getFileHandle(name,{create:true}),writable=await handle.createWritable();return{target:new StreamTarget(writable,{chunked:true,chunkSize:2**20}),opfs:true,root,handle,entryName:name}}catch(err){console.warn('OPFS indisponibil, folosesc memoria:',err)}}
  return{target:new BufferTarget(),opfs:false};
}
async function finalizeResult(dest,output,name,mime){
  let file;if(dest.opfs){const stored=await dest.handle.getFile();file=new File([stored],name,{type:mime,lastModified:Date.now()})}else{if(!output.target.buffer)throw new Error('Rezultatul nu a putut fi finalizat.');file=new File([output.target.buffer],name,{type:mime,lastModified:Date.now()})}
  result={file,opfs:dest.opfs,root:dest.root||null,entryName:dest.entryName||null,name,mime};resultActions.classList.remove('hidden');
}
async function extract(){
  if(!input||!sourceFile||activeConversion)return;const track=selectedTrack(),mode=selectedMode();if(!track)return showToast('Alege o pistă audio.',true);
  await cleanupResult();setBusy(true);resultActions.classList.add('hidden');setProgress(0,mode==='mka'?'Pregătesc extracția originală…':'Pregătesc conversia MP3…');
  let dest=null;const ext=mode==='mka'?'.original.mka':'.subsync.mp3',mime=mode==='mka'?'audio/x-matroska':'audio/mpeg',name=`${baseName(sourceFile.name)}${ext}`;
  try{
    await preflight(track,mode);dest=await createOutputDestination(name);if(!dest.opfs&&sourceFile.size>500*1024*1024)setCompatibility('Atenție: OPFS nu este disponibil; rezultatul va fi ținut temporar în memorie.','warn');
    const {conversion,output}=await buildConversion(track,mode,dest.target);activeConversion=conversion;conversion.onProgress=(p,t)=>setProgress(p,`${mode==='mka'?'Extrag fără recodare':'Convertesc în MP3'}${Number.isFinite(t)?' • '+formatDuration(t):''}`);
    await conversion.execute();activeConversion=null;setProgress(1,'Fișier pregătit');await finalizeResult(dest,output,name,mime);showToast(`Gata: ${name} • ${bytes(result.file.size)}`);
  }catch(err){activeConversion=null;if(dest?.opfs&&dest.root&&dest.entryName){try{await dest.root.removeEntry(dest.entryName)}catch(_){}}showToast(readableError(err),true)}finally{setBusy(false);if(!result)await updateCompatibility()}
}
async function shareResult(){if(!result?.file)return;try{const p={files:[result.file],title:result.name};if(navigator.share&&(!navigator.canShare||navigator.canShare(p))){await navigator.share(p);return}downloadResult();showToast('Share Sheet nu este disponibil; am pornit descărcarea.')}catch(err){if(err?.name!=='AbortError')showToast(readableError(err),true)}}
function downloadResult(){if(!result?.file)return;const url=URL.createObjectURL(result.file),a=document.createElement('a');a.href=url;a.download=result.name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}

pickBtn.addEventListener('click',()=>fileInput.click());changeFileBtn.addEventListener('click',()=>resetAll(true));resetBtn.addEventListener('click',()=>resetAll(true));
fileInput.addEventListener('change',()=>{const f=fileInput.files?.[0];fileInput.value='';if(f)analyze(f)});
['dragenter','dragover'].forEach(type=>pickBtn.addEventListener(type,e=>{e.preventDefault();pickBtn.classList.add('dragover')}));
['dragleave','drop'].forEach(type=>pickBtn.addEventListener(type,e=>{e.preventDefault();pickBtn.classList.remove('dragover')}));
pickBtn.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)analyze(f)});
document.querySelectorAll('input[name="mode"]').forEach(r=>r.addEventListener('change',()=>{document.querySelectorAll('.mode-card').forEach(card=>card.classList.toggle('selected',card.contains(document.querySelector('input[name="mode"]:checked'))));updateCompatibility()}));
extractBtn.addEventListener('click',extract);shareBtn.addEventListener('click',shareResult);downloadBtn.addEventListener('click',downloadResult);
cancelBtn.addEventListener('click',async()=>{if(!activeConversion)return;cancelBtn.disabled=true;statusText.textContent='Oprire…';try{await activeConversion.cancel()}catch(_){}finally{cancelBtn.disabled=false}});
window.addEventListener('beforeunload',e=>{if(!activeConversion)return;e.preventDefault();e.returnValue=''});
