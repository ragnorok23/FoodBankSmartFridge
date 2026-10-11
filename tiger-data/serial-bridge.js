import {SerialPort} from 'serialport';
import {randomUUID} from 'node:crypto';
import {makePool} from './db.js';
import {parseSensorLine} from './sensor-parser.js';
import {existsSync,writeFileSync,rmSync} from 'node:fs';
import {StabilityGate} from './stability.js';
const pauseFile=new URL('.sensor-paused',import.meta.url);
const waitingFile=new URL('.sensor-waiting',import.meta.url);
const liveFile=new URL('.sensor-live',import.meta.url);
if (process.argv.includes('--list')) {
  console.log(JSON.stringify((await SerialPort.list()).map(({path,manufacturer})=>({path,manufacturer})),null,2));
} else {
  if (existsSync(pauseFile)) { console.log('Sensor collection is paused. Wait until the fridge is ready before resuming.'); process.exit(0); }
  if (!process.env.SERIAL_PORT) { console.error('Set SERIAL_PORT in private .env after npm run ports. Close Arduino Serial Monitor first.'); process.exit(1); }
  const pool=makePool();
  const waitForStable=process.argv.includes('--wait-stable'),gate=new StabilityGate();
  let baselineStartedAt=null,lastStabilityLog=0;
  if(waitForStable)writeFileSync(waitingFile,JSON.stringify({started_at:new Date().toISOString(),window_seconds:300,max_range_c:0.5,max_slope_c_per_minute:0.1}));
  let port, buffer='', writing=false,lastSaved=0,stopping=false,reconnect,lastDiagnostic=0;
  const interval=Number(process.env.SENSOR_INTERVAL_MS || 5000);
  let pendingMotionPeak=0,pendingMovement=false;
  if (!Number.isFinite(interval) || interval<1000) throw new Error('SENSOR_INTERVAL_MS must be at least 1000');
  async function line(text) {
    const reading=parseSensorLine(text.trim());
    if(!reading&&Date.now()-lastDiagnostic>15000){console.log('Arduino diagnostic (not saved):',text.trim().slice(0,250));lastDiagnostic=Date.now();}
    if (existsSync(pauseFile) || !reading) return;
    const sampledAt=new Date();
    writeFileSync(liveFile,JSON.stringify({captured_at:new Date().toISOString(),...reading}));
    if(waitForStable&&!baselineStartedAt){
      const status=gate.add(Date.now(),reading.temperature_c);
      if(Date.now()-lastStabilityLog>=15000){console.log('Waiting for stable temperature; no database writes',status);lastStabilityLog=Date.now();}
      if(!status.stable)return;
      baselineStartedAt=new Date().toISOString();rmSync(waitingFile,{force:true});
      console.log('Five-minute stability check passed; starting baseline recording',baselineStartedAt,status);
      pendingMotionPeak=0;pendingMovement=false;
    }
    pendingMotionPeak=Math.max(pendingMotionPeak,reading.motion_peak_g||0);
    pendingMovement ||= !!reading.movement_detected;
    if (writing || Date.now()-lastSaved<interval) return;
    const motionMetadata={accelerometer_available:reading.accelerometer_available??false,
      acceleration_g:reading.acceleration_g??null,motion_peak_g:pendingMotionPeak,
      movement_detected:pendingMovement,motion_threshold_g:0.2,motion_status:'unvalidated_movement_only'};
    pendingMotionPeak=0;pendingMovement=false;
    writing=true;
    try {
      await pool.query(`INSERT INTO fridge.sensor_readings(captured_at,event_id,fridge_id,device_id,temperature_c,moisture_raw,air_quality_raw,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sampledAt,randomUUID(),process.env.FRIDGE_ID||'orion-fridge-01',process.env.DEVICE_ID||'arduino-uno-r4',reading.temperature_c,reading.moisture_raw,reading.air_quality_raw,{source:'usb_serial',calibration:'raw_unvalidated',recording_phase:waitForStable?'stable_baseline':'monitoring',baseline_started_at:baselineStartedAt,...motionMetadata}]);
      lastSaved=sampledAt.getTime(); console.log('Saved real sensor reading',reading);
    } catch { console.error('Database write failed; readings are not buffered. Will retry on a later fresh reading.'); lastSaved=sampledAt.getTime(); }
    finally { writing=false; }
  }
  function connect() {
    if (stopping) return;
    port=new SerialPort({path:process.env.SERIAL_PORT,baudRate:Number(process.env.SERIAL_BAUD||115200),autoOpen:false});
    buffer='';
    port.on('open',()=>{
      port.set({dtr:true,rts:true},error=>{if(error)console.error('USB serial readiness error:',error.code||error.message);});
      console.log(waitForStable?'Arduino connected; waiting for initial temperature stability before saving.':'Arduino connected; saving at most one reading per interval.');
    });
    port.on('data',chunk=>{ buffer+=chunk.toString(); const lines=buffer.split('\n'); buffer=lines.pop(); if(buffer.length>4096)buffer=''; for(const text of lines)void line(text); });
    const retry=()=>{if(!stopping&&!reconnect)reconnect=setTimeout(()=>{reconnect=undefined;connect();},5000);};
    port.on('error',error=>console.error('Serial error:',error.code||error.message));
    port.on('close',retry);
    port.open(error=>{if(error){console.error('Serial device unavailable:',error.code||error.message);retry();}});
  }
  connect();
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{stopping=true;clearTimeout(reconnect);if(port?.isOpen)port.close();rmSync(waitingFile,{force:true});await pool.end();process.exit(0);});
}
