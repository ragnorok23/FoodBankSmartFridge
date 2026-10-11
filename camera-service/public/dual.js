import {compareAudits,nextAuditTime,retryDelay} from './audit.js';
const $=id=>document.getElementById(id),streams={front:null,rear:null},versions={front:0,rear:0};
let busy=false,starting=false;
const storageKey='fridge-dual-camera-v1';
let state={enabled:false,nextDue:0,interval:3600000,failures:0,latest:null,baseline:null};
try{
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(saved && Number.isFinite(saved.nextDue))state={...state,enabled:saved.enabled===true,interval:saved.interval===30000?30000:3600000,nextDue:saved.nextDue,latest:Array.isArray(saved.latest?.inventory?.items)?saved.latest:null,baseline:Array.isArray(saved.baseline?.items)?saved.baseline:null};
}catch{}
function save(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{$('status').textContent='Browser storage unavailable. Results will last only for this page session.';}}
function controls(){
  $('start').disabled=starting||busy;
  $('identify').disabled=!streams.front||busy;
  $('enable').disabled=!streams.rear||state.enabled;
  $('audit').disabled=!streams.rear||busy;
}
$('cadence').value=String(state.interval);
function stopCamera(side){versions[side]++;streams[side]?.getTracks().forEach(t=>t.stop());streams[side]=null;$(side).srcObject=null;controls();}
function pauseAudits(){state.enabled=false;save();renderSchedule();controls();}
function stopAll(){pauseAudits();stopCamera('front');stopCamera('rear');$('status').textContent='Cameras stopped. An already submitted analysis request may finish.';}
async function openCamera(side,deviceId){
  stopCamera(side);
  const token=versions[side];
  const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:deviceId},width:{ideal:1280}},audio:false});
  if(token!==versions[side]){stream.getTracks().forEach(t=>t.stop());return;}
  streams[side]=stream;$(side).srcObject=stream;await $(side).play();
  stream.getVideoTracks()[0].onended=()=>{stopCamera(side);if(side==='rear')pauseAudits();$(side+'-status').textContent='Camera disconnected. Reconnect and restart.';};
  controls();
}
async function startBoth(){
  if(starting)return;const resume=state.enabled;starting=true;stopAll();controls();
  try{
    // One permission request unlocks device labels; this frame is never sent.
    const permission=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');permission.getTracks().forEach(t=>t.stop());
    if(cameras.length<2)throw new Error('Connect the Logitech camera. Two distinct cameras are required.');
    for(const side of ['front','rear'])$(side+'-device').replaceChildren(...cameras.map((d,i)=>new Option(d.label||`Camera ${i+1}`,d.deviceId)));
    const front=cameras.find(d=>/FaceTime|built.in/i.test(d.label))||cameras[0];
    const rear=cameras.find(d=>/Brio|Logitech/i.test(d.label)&&d.deviceId!==front.deviceId)||cameras.find(d=>d.deviceId!==front.deviceId);
    $('front-device').value=front.deviceId;$('rear-device').value=rear.deviceId;
    await openCamera('front',front.deviceId);await openCamera('rear',rear.deviceId);
    state.enabled=resume;save();controls();
    $('status').textContent='Both cameras ready. Front identification is on demand. Enable audits to run the rear-camera loop.';
  }catch(error){stopAll();$('status').textContent=error.message||'Could not start cameras.';}
  finally{starting=false;controls();}
}
async function changeCamera(side){
  const other=side==='front'?'rear':'front',deviceId=$(side+'-device').value;
  if(deviceId===$(other+'-device').value){$('status').textContent='Choose different cameras for donation and inventory.';$(side+'-device').value=streams[side]?.getVideoTracks()[0].getSettings().deviceId||'';return;}
  if(side==='rear'){pauseAudits();state.latest=null;state.baseline=null;state.nextDue=0;save();renderInventory();}
  try{await openCamera(side,deviceId);$('status').textContent='Camera changed. Check its preview before using it.';}catch{stopCamera(side);$('status').textContent='Could not open selected camera.';}
}
async function capture(side){
  const v=$(side);if(!streams[side]||!v.videoWidth||v.readyState<2)throw new Error('Start the camera and wait for its preview.');
  const canvas=document.createElement('canvas'),scale=Math.min(1,1280/v.videoWidth);canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Camera capture failed.')),'image/jpeg',0.85));
}
async function send(side,path,language){
  if(busy)throw new Error('Another camera request is running. Please wait.');
  const token=versions[side];busy=true;controls();
  try{
    const capturedAt=new Date().toISOString(),form=new FormData();form.append('image',await capture(side),'camera.jpg');if(language)form.append('language',language);
    const response=await fetch(path,{method:'POST',body:form,signal:AbortSignal.timeout(70000)}),body=await response.json();
    if(!response.ok){const error=new Error(body.message||body.error);error.status=response.status;error.code=body.error;throw error;}
    if(token!==versions[side])throw new Error('Camera changed while analyzing. This result was discarded.');
    return {...body,frame_captured_at:capturedAt,camera_role:side};
  }finally{busy=false;controls();}
}
async function identifyDonation(language=$('language').value){
  if(busy)throw new Error('Another camera request is running. Retry the voice tool after it finishes.');
  $('front-status').textContent='Identifying food…';
  try{
    const result=await send('front','/identify',language);
    $('identified').replaceChildren();
    for(const item of result.identification.items){const p=document.createElement('p');p.textContent=`${item.translated_name} (${item.name}) · ${item.visible_count??'?'} · ${item.certainty}`;p.dir='auto';$('identified').append(p);}
    const p=document.createElement('p');p.textContent=result.identification.message;p.dir='auto';$('identified').append(p);
    $('front-status').textContent='Identification complete. Fridge inventory was not changed.';$('result').textContent=JSON.stringify(result,null,2);
    window.dispatchEvent(new CustomEvent('donation-identified',{detail:result}));return result;
  }catch(error){$('front-status').textContent=error.message;throw error;}
}
function renderInventory(){
  $('inventory').replaceChildren();
  for(const item of state.latest?.inventory?.items||[]){const tr=document.createElement('tr');for(const value of [item.name,item.visible_count??'Unknown',item.certainty]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}$('inventory').append(tr);}
  $('differences').replaceChildren();
  for(const d of state.latest?.comparison?.differences||[]){const li=document.createElement('li');li.textContent=`${d.name}: ${d.previous_count} → ${d.current_count} (review required)`;$('differences').append(li);}
  if(state.latest)$('rear-status').textContent=`Last audit ${new Date(state.latest.analyzed_at).toLocaleString()} · image ${state.latest.inventory.image_quality}. ${state.latest.comparison.reason}`;
}
function renderSchedule(){
  if(!state.enabled){$('schedule').textContent='Automatic audits paused.';return;}
  const seconds=Math.max(0,Math.ceil((state.nextDue-Date.now())/1000));
  const mode=state.interval===30000?'DEMO: every 30 seconds':'Hourly';
  $('schedule').textContent=seconds?`${mode} · ${state.failures?'Retry':'Next audit'} in ${Math.floor(seconds/60)}m ${seconds%60}s`:`${mode} · audit due. Waiting for a visible page, camera, and available backend.`;
}
async function auditNow(){
  if(busy)throw new Error('Another camera request is running. Audit queued until it finishes.');
  $('rear-status').textContent='Auditing fridge inventory…';
  try{
    const scan=await send('rear','/analyze');
    const comparison=compareAudits(state.baseline,scan.inventory);
    state.latest={...scan,comparison};
    if(scan.inventory.image_quality==='usable')state.baseline=scan.inventory;
    state.failures=0;state.nextDue=nextAuditTime(Date.now(),state.interval);save();renderInventory();renderSchedule();
    $('result').textContent=JSON.stringify(state.latest,null,2);window.dispatchEvent(new CustomEvent('fridge-audit',{detail:state.latest}));return state.latest;
  }catch(error){
    const fatal=error.status===402||error.status===503||error.code==='gemini_quota'||error.status===400||error.status===415;
    if(fatal){pauseAudits();$('rear-status').textContent=`Audit paused: ${error.message}. Resolve before enabling again.`;}
    else{state.failures++;state.nextDue=Date.now()+retryDelay(state.failures);save();renderSchedule();$('rear-status').textContent=`Audit failed: ${error.message}. Automatic retry in ${retryDelay(state.failures)/1000}s when audits are enabled.`;}
    throw error;
  }
}
// ElevenLabs client tool calls this hook to capture the current donation frame.
window.fridgeVision={identifyDonation,auditNow,getInventory:()=>state.latest,startCameras:startBoth,pauseAudits,enableAudits:()=>{state.enabled=true;save();controls();renderSchedule();}};
$('start').onclick=startBoth;$('stop').onclick=stopAll;
for(const side of ['front','rear'])$(side+'-device').onchange=()=>changeCamera(side);
$('identify').onclick=()=>identifyDonation().catch(()=>{});
$('audit').onclick=()=>auditNow().catch(()=>{});
$('enable').onclick=()=>{state.enabled=true;save();controls();renderSchedule();};
$('disable').onclick=()=>{pauseAudits();controls();};
$('cadence').onchange=()=>{state.interval=Number($('cadence').value);state.failures=0;state.nextDue=state.latest?nextAuditTime(Date.now(),state.interval):0;save();renderSchedule();};
setInterval(()=>{
  renderSchedule();
  if(state.enabled&&!document.hidden&&streams.rear&&!busy&&Date.now()>=state.nextDue) auditNow().catch(()=>{});
},1000);
window.addEventListener('pagehide',()=>{for(const side of ['front','rear'])stopCamera(side);save();});
renderInventory();renderSchedule();controls();
fetch('/health').then(r=>r.json()).then(h=>$('status').textContent=h.gemini_configured?'Backend ready. Start both cameras.':'Set GEMINI_API_KEY in .env and save.').catch(()=>$('status').textContent='Backend unavailable. Start Run backend in Cursor.');
