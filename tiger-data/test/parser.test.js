import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSensorLine} from '../sensor-parser.js';
test('parses actual Arduino firmware line',()=>assert.deepEqual(parseSensorLine('Temperature: 22.50 C / 72.50 F | Moisture raw: 0 | Air raw: 20'),{temperature_c:22.5,moisture_raw:0,air_quality_raw:20}));
test('parses signed motion axes and movement flag',()=>{
  const reading=parseSensorLine('Temperature: 22.50 C / 72.50 F | Moisture raw: 0 | Air raw: 20 | Accel g: -0.048,0.000,1.000 | Motion peak g: 0.350 | Motion: 1');
  assert.deepEqual(reading.acceleration_g,{x:-0.048,y:0,z:1});
  assert.equal(reading.movement_detected,true);
  assert.equal(reading.motion_peak_g,0.35);
});
test('missing accelerometer does not erase valid temperature and invalid axes are rejected',()=>{
  const base='Temperature: 22.50 C / 72.50 F | Moisture raw: 0 | Air raw: 20';
  assert.equal(parseSensorLine(base+' | Accel: unavailable').accelerometer_available,false);
  assert.equal(parseSensorLine(base+' | Accel g: 99,0,1 | Motion peak g: 0 | Motion: 0'),null);
});
test('skips bus/initialization diagnostics and invalid measurements',()=>{for(const line of ['Sensor ID: 0x11','Temperature: 99 C / 210 F | Moisture raw: 0 | Air raw: 20','Temperature: 22 C / 72 F | Moisture raw: 1024 | Air raw: 20'])assert.equal(parseSensorLine(line),null);});
