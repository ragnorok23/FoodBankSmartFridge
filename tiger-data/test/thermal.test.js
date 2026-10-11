import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalMetrics} from '../thermal-math.js';
const origin=Date.parse('2026-01-01T00:00:00Z');
const date=s=>new Date(origin+s*1000).toISOString();
const row=(s,t)=>({captured_at:date(s),temperature_c:t});
const calc=(rows,end=120,extra={})=>thermalMetrics(rows,{start:date(0),end:date(end),thresholdC:4,maxGapSeconds:120,...extra});
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-9,`${x} != ${y}`);
test('constant 6C for two minutes: 4 C-min exposure and full coverage',()=>{
  const m=calc([row(0,6),row(120,6)]);near(m.observed_exposure_c_minutes,4);near(m.observed_minutes_above_threshold,2);near(m.coverage_fraction,1);near(m.time_weighted_temperature_c,6);
});
test('threshold crossings integrate triangles, including descent',()=>{
  for(const temps of [[2,6],[6,2]]){const m=calc([row(0,temps[0]),row(120,temps[1])]);near(m.observed_exposure_c_minutes,1);near(m.observed_minutes_above_threshold,1);}
});
test('at or below threshold contributes zero',()=>{const m=calc([row(0,4),row(120,2)]);near(m.observed_exposure_c_minutes,0);near(m.observed_minutes_above_threshold,0);});
test('irregular intervals use time weighting rather than sample averages',()=>{
  const m=calc([row(0,4),row(30,6),row(120,6)]);near(m.observed_exposure_c_minutes,3.5);near(m.time_weighted_temperature_c,5.75);
});
test('long gaps and unbracketed edges remain unknown',()=>{
  const m=calc([row(10,6),row(20,6),row(100,6),row(110,6)],120,{maxGapSeconds:15});
  near(m.coverage_fraction,1/6);near(m.longest_missing_interval_minutes,80/60);near(m.unmonitored_minutes,100/60);near(m.observed_exposure_c_minutes,2/3);
});
test('clip a crossing at the requested window boundaries',()=>{
  const m=calc([row(-60,0),row(60,6)],60,{maxGapSeconds:120});near(m.coverage_fraction,1);near(m.observed_exposure_c_minutes,2/3);near(m.observed_minutes_above_threshold,2/3);
});
test('invalid or conflicting duplicate points break coverage',()=>{
  for(const middle of [null,NaN,90]){const m=calc([row(0,6),row(60,middle),row(120,6)]);near(m.coverage_fraction,0);assert.equal(m.invalid_sample_count,1);}
  const m=calc([row(0,6),row(60,6),row(60,8),row(120,6)]);near(m.coverage_fraction,0);
});
test('sorted inputs and identical duplicates give the same answer',()=>{near(calc([row(120,6),row(0,6),row(0,6)]).observed_exposure_c_minutes,4);});
test('no data is unknown, and stale reporting is distinct from coverage',()=>{
  const empty=calc([]);assert.equal(empty.sensor_status,'no_data');assert.equal(empty.time_weighted_temperature_c,null);near(empty.coverage_fraction,0);near(empty.longest_missing_interval_minutes,2);
  assert.equal(calc([row(0,6),row(10,6)]).sensor_status,'stale');
  assert.equal(calc([row(115,6),row(120,null)]).sensor_status,'invalid_latest');
});
test('invalid windows and thresholds are rejected',()=>{assert.throws(()=>calc([],0),RangeError);assert.throws(()=>calc([],120,{thresholdC:NaN}),RangeError);});
