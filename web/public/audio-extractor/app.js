const RUNTIME_VERSION='1.60.0';
const MEDIABUNNY_URL='./vendor/mediabunny.min.mjs?v='+RUNTIME_VERSION;
const MP3_ENCODER_URL='./vendor/mediabunny-mp3-encoder.min.js?v='+RUNTIME_VERSION;
const AC3_URL='./vendor/mediabunny-ac3.min.js?v='+RUNTIME_VERSION;
const DTS_URL='./vendor/mediabunny-dts.min.js?v='+RUNTIME_VERSION;

let mb=null,input=null,sourceFile=null,audioTracks=[],primaryAudio=null,activeConversion=null,result=null,toastTimer=null,compatibilityToken=0;
const loadedScripts=new Map();
const extensions={mp3:false,ac3:false,dts:false};
const IS_ANDROID_SHELL=/\bSubSync2Android\//.test(navigator.userAgent);
let pendingNativeSaveSession=null,nativeSaveBusy=false;
const $=id=>document.getElementById(id);
const fileInput=$('fileInput'),pickBtn=$('pickBtn'),changeFileBtn=$('changeFileBtn'),fileMeta=$('fileMeta'),tracksCard=$('tracksCard'),trackList=$('trackList'),modeCard=$('modeCard'),actionCard=$('actionCard'),compatibility=$('compatibility'),extractBtn=$('extractBtn'),cancelBtn=$('cancelBtn'),progressWrap=$('progressWrap'),progressBar=$('progressBar'),progressPct=$('progressPct'),statusText=$('statusText'),resultActions=$('resultActions'),shareBtn=$('shareBtn'),downloadBtn=$('downloadBtn'),resetBtn=$('resetBtn'),toast=$('toast');

function bytes(n){if(!Number.isFinite(n))return'—';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return n.toFixed(i<2?1:2)+' '+u[i]}
function formatDuration(s){if(!Number.isFinite(s)||s<0)return null;const t=Math.round(s),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),x=t%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`}
function safeName(n){return String(n||'audio').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').trim()||'audio'}
function baseName(n){return safeName(n).replace(/\.[^/.]+$/,'')}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showToast(m,e=false){clearTimeout(toastTimer);toast.textContent=m;toast.classList.remove('hidden','error');if(e)toast.classList.add('error');toastTimer=setTimeout(()=>toast.classList.add('hidden'),6000)}
function readableError(err){if(err?.name==='ConversionCanceledError'||err?.name==='AbortError')return'Procesarea a fost oprită.';const m=err?.message||String(err||'Eroare necunoscută');return /memory|allocation|out of memory/i.test(m)?'Dispozitivul nu mai are suficientă memorie disponibilă. Închide aplicațiile grele și încearcă din nou.':m}
async function safeCall(fn,fallback=null){try{return await fn()}catch(_){return fallback}}
function loadClassicRuntime(url,globalName){
  if(globalThis[globalName])return Promise.resolve(globalThis[globalName]);
  if(loadedScripts.has(url))return loadedScripts.get(url);
  const pending=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=url;
    script.async=true;
    script.onload=()=>globalThis[globalName]?resolve(globalThis[globalName]):reject(new Error('Runtime '+globalName+' did not initialize.'));
    script.onerror=()=>reject(new Error('Nu am putut încărca runtime-ul local '+globalName+'.'));
    document.head.appendChild(script);
  });
  loadedScripts.set(url,pending);
  return pending;
}
async function loadEngine(){
  if(!mb){
    mb=await import(MEDIABUNNY_URL);
    // Official extension bundles use the documented global-script integration.
    // Expose this exact module instance so every extension registers against it.
    globalThis.Mediabunny=mb;
  }
  return mb;
}
async function ensureMp3Encoder(){
  if(extensions.mp3)return;
  await loadEngine();
  const ext=await loadClassicRuntime(MP3_ENCODER_URL,'MediabunnyMp3Encoder');
  ext.registerMp3Encoder();
  extensions.mp3=true;
}
async function ensureDecoder(track){
  const codec=String(await safeCall(()=>track.getCodec(),'')||'').toLowerCase();
  const internal=String(await safeCall(()=>track.getInternalCodecId(),'')||'').toLowerCase();
  const key=`${codec} ${internal}`;
  if((key.includes('ac3')||key.includes('eac3')||key.includes('e-ac-3'))&&!extensions.ac3){await loadEngine();const ext=await loadClassicRuntime(AC3_URL,'MediabunnyAc3');ext.registerAc3Decoder();extensions.ac3=true}
  if(key.includes('dts')&&!extensions.dts){await loadEngine();const ext=await loadClassicRuntime(DTS_URL,'MediabunnyDts');ext.registerDtsDecoder();extensions.dts=true}
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
    cards.push(`<label class="track-option"${IS_ANDROID_SHELL?' tabindex="0"':''}><input type="radio" name="audioTrack" value="${i}" ${checked?'checked':''}><div class="track-body"><div class="track-title">${escapeHtml(title)} ${isPrimary?'<span class="primary-tag">principală</span>':''}</div><div class="track-detail">${escapeHtml(detail)}</div></div></label>`);
  }
  trackList.innerHTML=cards.join('');trackList.querySelectorAll('input[name="audioTrack"]').forEach(el=>el.addEventListener('change',updateCompatibility));prepareAndroidTvControls();
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
function hasNativeAndroidSave(){return IS_ANDROID_SHELL&&typeof globalThis.SubSyncAndroid?.requestSave==='function'&&typeof globalThis.SubSyncAndroid?.writeSaveChunk==='function'&&typeof globalThis.SubSyncAndroid?.finishSave==='function'}
function setNativeSaveBusy(b){nativeSaveBusy=b;shareBtn.disabled=b;downloadBtn.disabled=b;resetBtn.disabled=b;changeFileBtn.disabled=b;pickBtn.disabled=b}
function blobToBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const s=String(reader.result||''),i=s.indexOf(',');resolve(i>=0?s.slice(i+1):s)};reader.onerror=()=>reject(reader.error||new Error('Nu am putut citi rezultatul pentru salvare.'));reader.readAsDataURL(blob)})}
async function streamResultToAndroid(sessionId){
  if(!result?.file||!hasNativeAndroidSave())return;
  const file=result.file,chunkSize=256*1024,total=file.size;
  try{
    setNativeSaveBusy(true);setProgress(0,'Salvez pe Android…');
    for(let offset=0;offset<total;offset+=chunkSize){
      const end=Math.min(total,offset+chunkSize),encoded=await blobToBase64(file.slice(offset,end));
      if(!globalThis.SubSyncAndroid.writeSaveChunk(sessionId,encoded))throw new Error('Android nu a putut scrie rezultatul.');
      setProgress(total?end/total:1,`Salvez pe Android • ${Math.round((total?end/total:1)*100)}%`);
    }
    if(!globalThis.SubSyncAndroid.finishSave(sessionId))throw new Error('Android nu a putut finaliza fișierul.');
    pendingNativeSaveSession=null;setProgress(1,'Fișier salvat');showToast(`Salvat: ${result.name}`);
  }catch(err){
    try{globalThis.SubSyncAndroid.abortSave?.(sessionId)}catch(_){}
    pendingNativeSaveSession=null;showToast(readableError(err),true);
  }finally{setNativeSaveBusy(false)}
}
function requestNativeSave(){
  if(!result?.file||nativeSaveBusy||!hasNativeAndroidSave())return false;
  try{
    setNativeSaveBusy(true);
    pendingNativeSaveSession=globalThis.SubSyncAndroid.requestSave(result.name,result.mime);
    if(!pendingNativeSaveSession)throw new Error('Android nu a pornit selectorul de salvare.');
    statusText.textContent='Alege unde salvezi fișierul…';
    return true;
  }catch(err){
    pendingNativeSaveSession=null;setNativeSaveBusy(false);showToast(readableError(err),true);return false;
  }
}
async function shareResult(){if(!result?.file)return;if(hasNativeAndroidSave()){requestNativeSave();return}try{const p={files:[result.file],title:result.name};if(navigator.share&&(!navigator.canShare||navigator.canShare(p))){await navigator.share(p);return}downloadResult();showToast('Share Sheet nu este disponibil; am pornit descărcarea.')}catch(err){if(err?.name!=='AbortError')showToast(readableError(err),true)}}
function downloadResult(){if(!result?.file)return;if(hasNativeAndroidSave()){requestNativeSave();return}const url=URL.createObjectURL(result.file),a=document.createElement('a');a.href=url;a.download=result.name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}

window.addEventListener('message',event=>{
  if(event.origin!==window.location.origin)return;
  const data=event.data;
  if(!data||data.sessionId!==pendingNativeSaveSession)return;
  if(data.type==='subsync2-native-save-ready'){streamResultToAndroid(data.sessionId);return}
  if(data.type==='subsync2-native-save-cancelled'){pendingNativeSaveSession=null;setNativeSaveBusy(false);showToast('Salvarea a fost anulată.');return}
  if(data.type==='subsync2-native-save-error'){pendingNativeSaveSession=null;setNativeSaveBusy(false);showToast(data.message||'Salvarea Android a eșuat.',true)}
});

function prepareAndroidTvControls(){
  if(!IS_ANDROID_SHELL)return;
  document.body.classList.add('android-tv');
  document.querySelectorAll('.mode-card,.track-option').forEach(el=>{el.tabIndex=0});
  shareBtn.textContent='Salvează fișierul';
  downloadBtn.classList.add('hidden');
}
function ensureAndroidTvFocus(){
  if(!IS_ANDROID_SHELL)return;
  const active=document.activeElement;
  if(active&&active!==document.body&&active!==document.documentElement)return;
  const first=tvFocusableElements()[0];
  if(first){first.focus();first.scrollIntoView({block:'nearest',inline:'nearest'})}
}
function tvFocusableElements(){
  return Array.from(document.querySelectorAll('button,.mode-card[tabindex],.track-option[tabindex]')).filter(el=>{
    if(el.classList.contains('hidden')||el.closest('.hidden'))return false;
    if(el.matches('button')&&el.disabled)return false;
    const radio=el.matches('.mode-card,.track-option')?el.querySelector('input[type="radio"]'):null;
    if(radio?.disabled)return false;
    return el.getClientRects().length>0;
  });
}
function moveAndroidTvFocus(key){
  const items=tvFocusableElements();if(!items.length)return;
  const active=document.activeElement;
  if(!items.includes(active)){items[0].focus();items[0].scrollIntoView({block:'nearest',inline:'nearest'});return}
  const a=active.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2;
  let best=null,bestScore=Infinity;
  for(const el of items){
    if(el===active)continue;
    const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,dx=x-ax,dy=y-ay;
    let primary,cross;
    if(key==='ArrowRight'){if(dx<=4)continue;primary=dx;cross=Math.abs(dy)}
    else if(key==='ArrowLeft'){if(dx>=-4)continue;primary=-dx;cross=Math.abs(dy)}
    else if(key==='ArrowDown'){if(dy<=4)continue;primary=dy;cross=Math.abs(dx)}
    else{if(dy>=-4)continue;primary=-dy;cross=Math.abs(dx)}
    const score=primary+cross*2.25;
    if(score<bestScore){bestScore=score;best=el}
  }
  if(best){best.focus();best.scrollIntoView({block:'nearest',inline:'nearest'})}
}
document.addEventListener('keydown',event=>{
  if(!IS_ANDROID_SHELL)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();moveAndroidTvFocus(event.key);return}
  if((event.key==='Enter'||event.key===' ')&&document.activeElement?.matches('.mode-card,.track-option')){event.preventDefault();document.activeElement.click()}
});

pickBtn.addEventListener('click',()=>fileInput.click());changeFileBtn.addEventListener('click',()=>resetAll(true));resetBtn.addEventListener('click',()=>resetAll(true));
fileInput.addEventListener('change',()=>{const f=fileInput.files?.[0];fileInput.value='';if(f)analyze(f)});
['dragenter','dragover'].forEach(type=>pickBtn.addEventListener(type,e=>{e.preventDefault();pickBtn.classList.add('dragover')}));
['dragleave','drop'].forEach(type=>pickBtn.addEventListener(type,e=>{e.preventDefault();pickBtn.classList.remove('dragover')}));
pickBtn.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)analyze(f)});
document.querySelectorAll('input[name="mode"]').forEach(r=>r.addEventListener('change',()=>{document.querySelectorAll('.mode-card').forEach(card=>card.classList.toggle('selected',card.contains(document.querySelector('input[name="mode"]:checked'))));updateCompatibility()}));
extractBtn.addEventListener('click',extract);shareBtn.addEventListener('click',shareResult);downloadBtn.addEventListener('click',downloadResult);
cancelBtn.addEventListener('click',async()=>{if(!activeConversion)return;cancelBtn.disabled=true;statusText.textContent='Oprire…';try{await activeConversion.cancel()}catch(_){}finally{cancelBtn.disabled=false}});
window.addEventListener('beforeunload',e=>{if(!activeConversion)return;e.preventDefault();e.returnValue=''});


function publishEmbeddedHeight() {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: 'subsync2-audio-extractor-height',
    height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
  }, window.location.origin);
}
if ('ResizeObserver' in window) {
  new ResizeObserver(() => publishEmbeddedHeight()).observe(document.body);
}
window.addEventListener('load', publishEmbeddedHeight);

prepareAndroidTvControls();
window.addEventListener('focus',()=>setTimeout(ensureAndroidTvFocus,0));
if(document.hasFocus())setTimeout(ensureAndroidTvFocus,0);
