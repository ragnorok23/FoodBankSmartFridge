// Integrate only short, bracketed intervals. Never fill a long gap or extrapolate.
export function thermalMetrics(rows,{start,end,thresholdC,maxGapSeconds=15,staleSeconds=20}) {
  const a=+new Date(start),b=+new Date(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw new RangeError('Invalid observation window');
  if(!Number.isFinite(thresholdC)||!Number.isFinite(maxGapSeconds)||maxGapSeconds<=0||!Number.isFinite(staleSeconds)||staleSeconds<=0)throw new RangeError('Invalid monitoring parameters');
  const grouped=new Map();
  for(const row of rows){
    const t=+new Date(row.captured_at),v=row.temperature_c;
    if(!Number.isFinite(t))continue;
    const valid=typeof v==='number'&&Number.isFinite(v)&&v>=-40&&v<=85;
    const old=grouped.get(t);
    // Conflicting duplicate timestamps invalidate that point; don't choose arbitrarily.
    grouped.set(t,{t,v,valid:valid&&(!old||(old.valid&&old.v===v))});
  }
  const points=[...grouped.values()].sort((x,y)=>x.t-y.t);
  let covered=0,degreeSeconds=0,above=0,weighted=0,longestGap=0,cursor=a;
  const segments=[];
  for(let i=1;i<points.length;i++){
    const p=points[i-1],q=points[i],dt=q.t-p.t;
    if(!p.valid||!q.valid||dt>maxGapSeconds*1000)continue;
    const lo=Math.max(a,p.t),hi=Math.min(b,q.t);
    if(hi<=lo)continue;
    const x=p.v+(q.v-p.v)*(lo-p.t)/dt,y=p.v+(q.v-p.v)*(hi-p.t)/dt;
    const seconds=(hi-lo)/1000,u=x-thresholdC,v=y-thresholdC;
    longestGap=Math.max(longestGap,(lo-cursor)/1000);cursor=hi;
    covered+=seconds;weighted+=seconds*(x+y)/2;
    if(u>0&&v>0){degreeSeconds+=seconds*(u+v)/2;above+=seconds;}
    else if(u>0||v>0){
      // Exact triangular integral of the positive part of a linear crossing.
      const positive=Math.max(u,v),fraction=positive/Math.abs(v-u);
      above+=seconds*fraction;degreeSeconds+=seconds*fraction*positive/2;
    }
    segments.push({start:new Date(lo).toISOString(),end:new Date(hi).toISOString(),temperature_start_c:x,temperature_end_c:y});
  }
  longestGap=Math.max(longestGap,(b-cursor)/1000);
  const duration=(b-a)/1000;
  const latest=points.filter(p=>p.t<=b).at(-1);
  const latestValid=points.filter(p=>p.valid&&p.t<=b).at(-1);
  const age=latestValid?(b-latestValid.t)/1000:null;
  const within=points.filter(p=>p.t>=a&&p.t<=b);
  return {
    window_start:new Date(a).toISOString(),window_end:new Date(b).toISOString(),threshold_c:thresholdC,
    max_gap_seconds:maxGapSeconds,stale_after_seconds:staleSeconds,
    observed_exposure_c_minutes:degreeSeconds/60,observed_minutes_above_threshold:above/60,
    covered_minutes:covered/60,unmonitored_minutes:Math.max(0,duration-covered)/60,
    coverage_fraction:Math.min(1,covered/duration),longest_missing_interval_minutes:longestGap/60,
    time_weighted_temperature_c:covered?weighted/covered:null,
    valid_sample_count:within.filter(p=>p.valid).length,invalid_sample_count:within.filter(p=>!p.valid).length,
    last_valid_reading_at:latestValid?new Date(latestValid.t).toISOString():null,last_valid_age_seconds:age,
    sensor_status:!latestValid?'no_data':age>staleSeconds?'stale':latest&&!latest.valid?'invalid_latest':'reporting',
    assumptions:'Piecewise-linear temperature between valid consecutive readings no more than max_gap_seconds apart; no extrapolation. Exposure is observed only, not a food-safety score.',
    segments
  };
}
