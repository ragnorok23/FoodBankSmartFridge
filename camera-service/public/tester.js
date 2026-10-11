import { InventoryTracker } from './tracker.js';
const $=id=>document.getElementById(id),tracker=new InventoryTracker();
let stream,photo,live=false,timer,generation=0,inFlight=false,failures=0;
let lastScan,lastCaptured=0,lastLatency=0,scans=0;
const status=text=>$('status').textContent=text;
function controls(){ $('live').disabled=!stream||live||inFlight; $('pause').disabled=!live; $('analyze').disabled=!photo||live||inFlight; }
function clearOverlay(){const c=$('overlay');c.getContext('2d').clearRect(0,0,c.width,c.height);}
function pause(){live=false;generation++;clearTimeout(timer);clearOverlay();controls();}
function stop(){pause();stream?.getTracks().forEach(t=>t.stop());stream=undefined;$('video').srcObject=null;controls();}
function resetSession(){tracker.reset();lastScan=undefined;lastCaptured=0;scans=0;for(const id of ['observed','stable','changes'])$(id).replaceChildren();for(const id of ['result','limitations','timing'])$(id).textContent='';clearOverlay();}
async function start(deviceId){
  stop();resetSession();
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:deviceId?{deviceId:{exact:deviceId},width:{ideal:1280}}:{width:{ideal:1280}},audio:false});
    $('video').srcObject=stream;await $('video').play();
    const cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    $('camera').replaceChildren(...cameras.map((d,i)=>new Option(d.label||`Camera ${i+1}`,d.deviceId)));
    $('camera').value=stream.getVideoTracks()[0].getSettings().deviceId;
    stream.getVideoTracks()[0].onended=()=>{stop();status('Camera disconnected. Reconnect and start again.');};
    status('Camera ready. Start live identification to send frames to Gemini.');controls();
  }catch{stop();status('Camera unavailable. Allow camera access or close other camera apps.');}
}
function table(id,rows){$(id).replaceChildren(...rows.map(values=>{const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}return tr;}));}
function display(scan,capturedAt,latency,track){
  lastScan=scan;lastCaptured=capturedAt;lastLatency=latency;scans++;
  const inventory=scan.inventory;
  table('observed',inventory.items.map(i=>[i.name,i.visible_count??'Unknown',i.certainty]));
  $('limitations').textContent=[`Image: ${inventory.image_quality}`,...inventory.limitations].join(' · ');
  if(track){
    const stable=tracker.update(inventory);
    table('stable',stable.items.map(i=>[i.name,i.visible_count??'Unknown',i.stale?'Not confirmed in current scan':'Confirmed']));
    for(const change of stable.changes){const li=document.createElement('li');li.textContent=`${new Date().toLocaleTimeString()} — ${change.name}: ${change.type==='added'?'Detected':change.type==='no_longer_visible'?'No longer visible':`${change.from??'?'} → ${change.to??'?'}`}`;$('changes').prepend(li);}
    while($('changes').children.length>30)$('changes').lastChild.remove();
    window.dispatchEvent(new CustomEvent('fridge-inventory',{detail:{...scan,frame_captured_at:new Date(capturedAt).toISOString(),tracking:stable}}));
  }
  $('result').textContent=JSON.stringify(scan,null,2);drawBoxes();
}
function drawBoxes(){
  clearOverlay();if(!live||!lastScan||Date.now()-lastCaptured>15000)return;
  const c=$('overlay'),v=$('video');c.width=v.videoWidth;c.height=v.videoHeight;
  const ctx=c.getContext('2d');ctx.lineWidth=Math.max(2,c.width/400);ctx.font=`${Math.max(16,c.width/65)}px system-ui`;
  for(const item of lastScan.inventory.items){
    ctx.strokeStyle=item.certainty==='high'?'#42ef90':item.certainty==='medium'?'#ffcb4a':'#f89595';ctx.fillStyle=ctx.strokeStyle;
    for(const b of item.boxes||[]){if(b.xmax<=b.xmin||b.ymax<=b.ymin)continue;const x=b.xmin*c.width/1000,y=b.ymin*c.height/1000,w=(b.xmax-b.xmin)*c.width/1000,h=(b.ymax-b.ymin)*c.height/1000;ctx.strokeRect(x,y,w,h);ctx.fillText(`${item.name} · ${item.certainty}`,x,Math.max(20,y-5));}
  }
}
async function requestScan(blob){
  const form=new FormData();form.append('image',blob,'fridge.jpg');
  const response=await fetch('/analyze',{method:'POST',body:form,signal:AbortSignal.timeout(70000)}),body=await response.json();
  if(!response.ok){const error=new Error(body.message||body.error);error.status=response.status;error.code=body.error;throw error;}return body;
}
async function capture(){
  const v=$('video');if(!v.videoWidth||v.readyState<2)throw new Error('Waiting for camera frames.');
  const c=document.createElement('canvas'),scale=Math.min(1,1280/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext('2d').drawImage(v,0,0,c.width,c.height);
  return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Could not capture frame.')),'image/jpeg',0.85));
}
async function tick(token){
  if(!live||token!==generation||inFlight)return;
  inFlight=true;controls();const capturedAt=Date.now();
  try{
    status('Live: analyzing current frame…');const scan=await requestScan(await capture());
    if(!live||token!==generation)return;
    failures=0;display(scan,capturedAt,Date.now()-capturedAt,true);status('Live: waiting for next scan.');
  }catch(error){
    if(!live||token!==generation)return;
    failures++;clearOverlay();
    if(error.status===503||error.status===402||error.code==='gemini_quota'||failures>=3){pause();status(`Identification paused: ${error.message}`);}
    else status(`Scan failed: ${error.message}. Retrying with a longer wait (${failures}/3).`);
  }finally{inFlight=false;controls();if(live&&token===generation)timer=setTimeout(()=>tick(token),Math.min(120000,Number($('interval').value)*2**failures));}
}
$('start').onclick=()=>start();$('camera').onchange=()=>start($('camera').value);
$('stop').onclick=()=>{stop();status('Camera stopped. No new frames are sent.');};
$('pause').onclick=()=>{pause();status('Identification paused. An already submitted request may finish.');};
$('live').onclick=()=>{live=true;failures=0;generation++;controls();tick(generation);};
$('file').onchange=()=>{photo=$('file').files[0];controls();};
$('analyze').onclick=async()=>{
  if(!photo||inFlight||live)return;inFlight=true;controls();const capturedAt=Date.now();
  try{status('Analyzing uploaded photo…');display(await requestScan(photo),capturedAt,Date.now()-capturedAt,false);status('Photo analyzed. Live inventory was not changed.');}
  catch(error){status(error.message);}finally{inFlight=false;controls();}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&live){pause();status('Identification paused because this tab is hidden.');}});
window.addEventListener('pagehide',stop);
setInterval(()=>{if(!lastCaptured)return;const age=Math.floor((Date.now()-lastCaptured)/1000);$('timing').textContent=`Last analyzed frame: ${age}s ago · response ${(lastLatency/1000).toFixed(1)}s · ${scans} completed scans${age>15?' · observations are stale':''}`;if(age>15)clearOverlay();},1000);
fetch('/health').then(r=>r.json()).then(h=>status(h.gemini_configured?'Backend ready. Start camera.':'Paste your Gemini key into .env and save.')).catch(()=>status('Backend unavailable. Check the Run backend terminal.'));
