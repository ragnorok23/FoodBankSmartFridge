import test from 'node:test';import assert from 'node:assert/strict';import {StabilityGate} from '../stability.js';
test('constant temperature needs five full minutes before baseline recording',()=>{
  const gate=new StabilityGate();for(let t=0;t<300;t++)assert.equal(gate.add(t*1000,3).stable,false);assert.equal(gate.add(300000,3).stable,true);
});
test('cooldown trend and excess range fail stability',()=>{
  for(const step of [0.01,0.002]){const gate=new StabilityGate();let state;for(let t=0;t<=300;t++)state=gate.add(t*1000,10-step*t);assert.equal(state.stable,false);}
});
test('missing measurements restart the settling window',()=>{
  const gate=new StabilityGate();for(let t=0;t<=300;t++)gate.add(t*1000,3);const state=gate.add(320000,3);assert.equal(state.stable,false);assert.equal(state.duration_seconds,0);
});
