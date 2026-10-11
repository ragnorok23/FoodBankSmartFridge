// A completeness percentage is a measurement of data availability, not a
// probability that food is safe. Alerts are independent, with explicit units.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const validRaw=n=>finite(n)&&n>=0&&n<=1023;
const fields={
  temperature:r=>finite(r.temperature_c)&&r.temperature_c>=-40&&r.temperature_c<=85,
  moisture:r=>validRaw(r.moisture_raw),
  air:r=>validRaw(r.air_quality_raw),
  movement:r=>r.metadata?.accelerometer_available===true&&finite(r.metadata?.motion_peak_g)&&r.metadata.motion_peak_g>=0
};
export function conditionMetrics(rows,baseline,{now=new Date(),windowSeconds=300,maxGapSeconds=15,staleSeconds=20}={}){
  const end=+new Date(now),start=end-windowSeconds*1000;
  // A duplicate timestamp cannot earn extra coverage. Conflicting readings
  // invalidate the point rather than selecting whichever arrived last.
  const grouped=new Map();
  for(const row of rows){
    const t=+new Date(row.captured_at);if(!Number.isFinite(t)||t>end)continue;
    const previous=grouped.get(t);
    const conflict=previous&&(previous.conflict||JSON.stringify(previous.row)!==JSON.stringify(row));
    grouped.set(t,{t,row,conflict:Boolean(conflict)});
  }
  const points=[...grouped.values()].sort((a,b)=>a.t-b.t);
  const valid=(p,key)=>p&&!p.conflict&&fields[key](p.row);
  function coverage(keys){
    let ms=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];
      if(b.t-a.t<=maxGapSeconds*1000&&keys.every(k=>valid(a,k)&&valid(b,k)))ms+=Math.max(0,Math.min(end,b.t)-Math.max(start,a.t));
    }
    return Math.min(100,ms/(windowSeconds*10));
  }
  const latest=points.at(-1),age=latest?(end-latest.t)/1000:null;
  const channels=Object.fromEntries(Object.keys(fields).map(key=>[key,{
    status:!latest?'no_data':age>staleSeconds?'stale':valid(latest,key)?'reporting':'invalid_or_unavailable',
    coverage_percent:coverage([key])
  }]));
  function sustained(key,predicate,seconds){
    if(channels[key].status!=='reporting')return {state:'unknown',since:null};
    if(!predicate(latest.row))return {state:'normal',since:null};
    let first=latest;
    for(let i=points.length-2;i>=0;i--){
      const p=points[i];
      if(first.t-p.t>maxGapSeconds*1000||!valid(p,key)||!predicate(p.row))break;
      first=p;
    }
    return {state:(latest.t-first.t)/1000>=seconds?'alert':'pending',since:new Date(first.t).toISOString()};
  }
  const t=baseline.thresholds;
  const limits={temperature:baseline.temperature_c+t.temperature_rise_c,moisture:baseline.moisture_raw+t.moisture_increase_raw,air:baseline.air_quality_raw+t.air_increase_raw,movement:t.motion_peak_g};
  const definitions=[
    ['temperature','Temperature rise',r=>r.temperature_c>=limits.temperature,5,latest?.row.temperature_c,limits.temperature,'°C'],
    ['moisture','Contact moisture',r=>r.moisture_raw>=limits.moisture,2,latest?.row.moisture_raw,limits.moisture,'raw ADC'],
    ['air','Air-sensor increase',r=>r.air_quality_raw>=limits.air,2,latest?.row.air_quality_raw,limits.air,'raw ADC']
  ];
  const conditions=definitions.map(([key,label,predicate,seconds,value,threshold,unit])=>({key,label,...sustained(key,predicate,seconds),value:valid(latest,key)?value:null,threshold,unit,persistence_seconds:seconds}));
  // Keep a brief movement visible even if the fridge has stopped moving.
  const motion=points.filter(p=>p.t>=end-10000&&valid(p,'movement')&&p.row.metadata.motion_peak_g>limits.movement).at(-1);
  conditions.push({key:'movement',label:'Movement detected',state:channels.movement.status!=='reporting'?'unknown':motion?'alert':'normal',since:motion?new Date(motion.t).toISOString():null,value:valid(latest,'movement')?latest.row.metadata.motion_peak_g:null,recent_peak_g:motion?.row.metadata.motion_peak_g??null,threshold:limits.movement,comparison:'>',unit:'g',hold_seconds:10});
  const alerts=conditions.filter(c=>c.state==='alert');
  return {
    evaluated_at:new Date(end).toISOString(),baseline,
    monitoring_confidence_percent:coverage(Object.keys(fields)),
    confidence_definition:'Percent of the last 5 minutes covered by consecutive valid readings from all four channels, no more than 15 seconds apart. No extrapolation; not a food safety probability.',
    window_seconds:windowSeconds,last_reading_at:latest?new Date(latest.t).toISOString():null,last_reading_age_seconds:age,
    channels,conditions,alerts,
    status:alerts.length?'attention':conditions.some(c=>c.state==='unknown')?'monitoring_incomplete':conditions.some(c=>c.state==='pending')?'checking':'within_demo_limits',
    limitations:['Contact moisture is not humidity.','Air readings indicate a sensor response, not spoilage or a measured AQI.','Accelerometer movement is not proof of theft.','Demo temperature rise threshold is not a validated food safety limit.']
  };
}
