import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionMetrics} from '../conditions.js';
const baseline={temperature_c:-17.2,moisture_raw:0,air_quality_raw:51,thresholds:{temperature_rise_c:2,moisture_increase_raw:10,air_increase_raw:30,motion_peak_g:0.2}};
const end=Date.parse('2026-10-11T04:00:00Z');
const row=(seconds,overrides={})=>({captured_at:new Date(end+seconds*1000).toISOString(),temperature_c:-17.2,moisture_raw:0,air_quality_raw:51,metadata:{accelerometer_available:true,motion_peak_g:0.1},...overrides});
const metrics=rows=>conditionMetrics(rows,baseline,{now:new Date(end)});
const state=(m,key)=>m.conditions.find(c=>c.key===key).state;
test('complete baseline produces no alerts and full coverage',()=>{
  const m=metrics(Array.from({length:301},(_,i)=>row(i-300)));
  assert.equal(m.monitoring_confidence_percent,100);assert.equal(m.status,'within_demo_limits');assert.equal(m.alerts.length,0);
});
test('long gaps and unobserved tails reduce confidence without filling gaps',()=>{
  const m=metrics([row(-300),row(-299),row(-10),row(-9)]);
  assert.equal(m.monitoring_confidence_percent,2/3);
});
test('missing movement invalidates combined coverage but temperature remains covered',()=>{
  const m=metrics([row(-1,{metadata:{accelerometer_available:false}}),row(0,{metadata:{accelerometer_available:false}})]);
  assert.equal(m.monitoring_confidence_percent,0);assert.equal(state(m,'movement'),'unknown');assert.ok(m.channels.temperature.coverage_percent>0);
});
test('single warm point is pending; five sustained seconds alert',()=>{
  assert.equal(state(metrics([row(-1),row(0,{temperature_c:-14})]),'temperature'),'pending');
  assert.equal(state(metrics(Array.from({length:6},(_,i)=>row(i-5,{temperature_c:-14}))),'temperature'),'alert');
});
test('moisture and vapor alert independently; low air does not imply worse quality',()=>{
  const m=metrics([row(-2,{moisture_raw:20,air_quality_raw:150}),row(-1,{moisture_raw:20,air_quality_raw:150}),row(0,{moisture_raw:20,air_quality_raw:150})]);
  assert.equal(state(m,'moisture'),'alert');assert.equal(state(m,'air'),'alert');assert.equal(state(m,'temperature'),'normal');
  assert.equal(state(metrics([row(0,{air_quality_raw:10})]),'air'),'normal');
});
test('stale data never returns reassuring normal conditions',()=>{
  const m=metrics([row(-30),row(-29)]);assert.ok(m.conditions.every(c=>c.state==='unknown'));assert.equal(m.status,'monitoring_incomplete');
});
test('a gap resets temperature persistence',()=>{
  assert.equal(state(metrics([row(-100,{temperature_c:-14}),row(0,{temperature_c:-14})]),'temperature'),'pending');
});
test('movement is held briefly then clears; 0.20g boundary is excluded and 0.208g triggers',()=>{
  assert.equal(state(metrics([row(-5,{metadata:{accelerometer_available:true,motion_peak_g:0.3}}),row(0)]),'movement'),'alert');
  assert.equal(state(metrics([row(-11,{metadata:{accelerometer_available:true,motion_peak_g:0.3}}),row(0)]),'movement'),'normal');
  assert.equal(state(metrics([row(0,{metadata:{accelerometer_available:true,motion_peak_g:0.2}})]),'movement'),'normal');
  assert.equal(state(metrics([row(0,{metadata:{accelerometer_available:true,motion_peak_g:0.208}})]),'movement'),'alert');
});
test('conflicting duplicate timestamp invalidates that instant',()=>{
  const m=metrics([row(-1),row(0),row(0,{temperature_c:10})]);assert.equal(m.monitoring_confidence_percent,0);assert.equal(state(m,'temperature'),'unknown');
});
