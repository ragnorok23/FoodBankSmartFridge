const $=id=>document.getElementById(id);
let busy=false;
let conditionsBusy=false;
async function refreshConditions(){
  if(conditionsBusy)return;conditionsBusy=true;
  try{
    const response=await fetch(`/fridges/${encodeURIComponent($('fridge').value)}/conditions`,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Condition data unavailable; refresh this page to reconnect.');
    const m=await response.json();$('condition-error').textContent='';
    $('confidence').textContent=`${m.monitoring_confidence_percent.toFixed(1)}%`;
    $('condition-status').textContent=m.alerts.length?`Attention: ${m.alerts.map(c=>c.label).join(', ')}.`:m.status==='monitoring_incomplete'?'Monitoring incomplete: one or more sensors are unavailable.':m.status==='checking'?'Checking a sensor change…':'All readings are within the configured demo limits.';
    const container=$('conditions');container.replaceChildren();
    for(const c of m.conditions){
      const card=document.createElement('div');card.className='card';
      if(c.state==='alert')card.style.borderColor='#b34530';
      const title=document.createElement('div');title.textContent=c.label;
      const state=document.createElement('strong');state.style.fontSize='22px';state.textContent={alert:'ALERT',normal:'Within limits',pending:'Checking…',unknown:'Unknown'}[c.state];
      const detail=document.createElement('p');detail.textContent=`${c.value===null?'Unavailable':c.value.toFixed(2)+' '+c.unit} · trigger ${c.comparison||'≥'} ${c.threshold.toFixed(2)} ${c.unit}`;
      const quality=document.createElement('small');quality.textContent=`Data coverage: ${m.channels[c.key].coverage_percent.toFixed(1)}%${c.key==='movement'&&c.recent_peak_g!==null?' · recent peak '+c.recent_peak_g.toFixed(3)+' g':''}`;
      card.append(title,state,detail,quality);container.append(card);
    }
    $('condition-baseline').textContent=`Pre-demo reference: ${m.baseline.temperature_c} °C, moisture ${m.baseline.moisture_raw}, air ${m.baseline.air_quality_raw}. ${m.baseline.sample_count} saved readings. Physical trigger tests still needed.`;
  }catch(error){
    $('condition-error').textContent=error.message;$('condition-status').textContent='Condition updates unavailable. Displayed readings are from the last successful update.';$('confidence').textContent='Unavailable';
  }finally{conditionsBusy=false;}
}
let liveBusy=false,livePoints=[];
async function refreshLive(){
  if(liveBusy)return;liveBusy=true;
  try{
    const response=await fetch('/monitor/live',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('unavailable');
    const reading=await response.json();
    $('live-temp').textContent=reading.temperature_c===null?'Waiting…':`${reading.temperature_c.toFixed(2)} °C`;
    $('live-note').textContent=reading.stale?'Live readings unavailable or stale.':`Updated ${new Date(reading.captured_at).toLocaleTimeString()} · Local preview, separate from database recording.`;
    if(!reading.stale&&livePoints.at(-1)?.captured_at!==reading.captured_at)livePoints.push(reading);
    livePoints=livePoints.slice(-300);const svg=$('live-chart');svg.replaceChildren();
    if(livePoints.length>1){
      const low=Math.min(...livePoints.map(p=>p.temperature_c))-0.2,high=Math.max(...livePoints.map(p=>p.temperature_c))+0.2;
      const start=Date.parse(livePoints[0].captured_at),end=Date.parse(livePoints.at(-1).captured_at);
      const x=p=>55+800*(Date.parse(p.captured_at)-start)/(end-start),y=p=>220-190*(p.temperature_c-low)/(high-low);
      for(let i=1;i<livePoints.length;i++)if(Date.parse(livePoints[i].captured_at)-Date.parse(livePoints[i-1].captured_at)<=15000)svg.append(svgNode('line',{x1:x(livePoints[i-1]),y1:y(livePoints[i-1]),x2:x(livePoints[i]),y2:y(livePoints[i]),stroke:'#246847','stroke-width':3}));
      svg.append(svgNode('text',{x:0,y:30,fill:'#506356','font-size':13},`${high.toFixed(1)} °C`));
      svg.append(svgNode('text',{x:0,y:220,fill:'#506356','font-size':13},`${low.toFixed(1)} °C`));
    }
  }catch{$('live-note').textContent='Live preview unavailable; refresh this page to reconnect.';}
  finally{liveBusy=false;}
}
const format=n=>n.toLocaleString(undefined,{maximumFractionDigits:2});
function svgNode(tag,attributes,text){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;}
function chart(m){
  const svg=$('chart');svg.replaceChildren();
  if(!m.segments.length){$('chart-note').textContent='No covered intervals yet. Collection may be paused; no temperature history is invented.';return;}
  const temps=m.segments.flatMap(s=>[s.temperature_start_c,s.temperature_end_c]);
  const low=Math.min(m.threshold_c,...temps)-1,high=Math.max(m.threshold_c,...temps)+1;
  const start=Date.parse(m.window_start),end=Date.parse(m.window_end);
  const x=t=>55+800*(Date.parse(t)-start)/(end-start),y=t=>220-190*(t-low)/(high-low);
  svg.append(svgNode('line',{x1:55,x2:855,y1:y(m.threshold_c),y2:y(m.threshold_c),stroke:'#a66538','stroke-dasharray':'5 5'}));
  svg.append(svgNode('text',{x:60,y:y(m.threshold_c)-8,fill:'#865128','font-size':13},`Threshold ${m.threshold_c} °C`));
  for(const s of m.segments)svg.append(svgNode('line',{x1:x(s.start),y1:y(s.temperature_start_c),x2:x(s.end),y2:y(s.temperature_end_c),stroke:'#246847','stroke-width':2}));
  for(const t of [low,high])svg.append(svgNode('text',{x:0,y:y(t),fill:'#506356','font-size':13},`${format(t)} °C`));
  svg.append(svgNode('text',{x:55,y:248,fill:'#506356','font-size':13},new Date(start).toLocaleTimeString()));
  svg.append(svgNode('text',{x:855,y:248,'text-anchor':'end',fill:'#506356','font-size':13},new Date(end).toLocaleTimeString()));
  $('chart-note').textContent='Green segments are covered intervals. Blank stretches are unknown; they are not bridged.';
}
async function refresh(){
  if(busy)return;busy=true;
  try{
    const end=new Date(),start=new Date(+end-Number($('window').value)*60000);
    const q=new URLSearchParams({start:start.toISOString(),end:end.toISOString(),threshold_c:$('threshold').value});
    const response=await fetch(`/fridges/${encodeURIComponent($('fridge').value)}/thermal?${q}`,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error(response.status===401?'Refresh this page to reconnect.':`Metrics request failed (${response.status}); check the API/database connection.`);
    const m=await response.json();$('error').textContent='';
    $('exposure').textContent=m.covered_minutes?format(m.observed_exposure_c_minutes):'Unknown';
    $('above').textContent=m.covered_minutes?format(m.observed_minutes_above_threshold):'Unknown';
    $('coverage').textContent=`${format(m.coverage_fraction*100)}%`;$('coverage-meter').value=m.coverage_fraction;
    $('unknown').textContent=`${format(m.unmonitored_minutes)} minutes unmonitored`;$('gap').textContent=format(m.longest_missing_interval_minutes);
    $('status').textContent=m.collection_phase==='waiting_for_stability'?'Waiting for five minutes of stable temperature. Database recording has not started; cooldown readings are excluded.':m.collection_phase==='paused'?'Collection is paused.':m.sensor_status==='reporting'?'Sensor is reporting.':m.sensor_status==='stale'?'Sensor is stale: readings have stopped arriving.':m.sensor_status==='invalid_latest'?'Latest temperature is invalid; monitoring is interrupted.':'No sensor data. Collection may be paused.';
    $('average').textContent=`Time-weighted mean over covered intervals: ${m.time_weighted_temperature_c===null?'unknown':format(m.time_weighted_temperature_c)+' °C'}. Valid samples: ${m.valid_sample_count}; invalid samples: ${m.invalid_sample_count}.`;
    $('updated').textContent=`Updated ${new Date().toLocaleTimeString()} · ${m.device_id} · last valid sample: ${m.last_valid_reading_at?new Date(m.last_valid_reading_at).toLocaleString():'none'}`;
    chart(m);
  }catch(error){$('error').textContent=error.message;if(!$('dashboard').hidden)$('status').textContent='Refresh failed. Displayed values are from the last successful update.';}
  finally{busy=false;}
}
$('refresh').addEventListener('click',refresh);
for(const id of ['window','threshold','fridge'])$(id).addEventListener('change',refresh);
$('fridge').addEventListener('change',refreshConditions);
void refreshConditions();setInterval(refreshConditions,2000);
void refresh();
setInterval(refresh,10000);
void refreshLive();setInterval(refreshLive,2000);
