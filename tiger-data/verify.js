import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {makePool} from './db.js';
const pool=makePool(),client=await pool.connect();
try{
  await client.query('BEGIN');
  const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='fridge' ORDER BY table_name")).rows.map(r=>r.table_name);
  const hypertables=(await client.query("SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema='fridge'")).rows;
  assert.ok(hypertables.some(r=>r.hypertable_name==='sensor_readings'));
  const pid=randomUUID(),proposal=randomUUID(),audit=randomUUID(),time=new Date(),sensor=randomUUID();
  await client.query("INSERT INTO fridge.sensor_readings(captured_at,event_id,fridge_id,device_id,temperature_c,moisture_raw,air_quality_raw,metadata) VALUES($1,$2,'orion-fridge-01','verification-only',4,0,20,'{\"test_only\":true}')",[time,sensor]);
  await client.query("INSERT INTO fridge.products(id,canonical_name,match_method) VALUES($1,'verification-only','manual')",[pid]);
  await client.query("INSERT INTO fridge.donation_proposals(id,fridge_id,product_id,quantity,identification_method,certainty) VALUES($1,'orion-fridge-01',$2,2,'manual','unknown')",[proposal,pid]);
  for(let i=0;i<2;i++)await client.query("INSERT INTO fridge.inventory_events(id,fridge_id,product_id,proposal_id,kind,quantity_delta,verification) VALUES($1,'orion-fridge-01',$2,$3,'donation',2,'donor_confirmed') ON CONFLICT(proposal_id) DO NOTHING",[randomUUID(),pid,proposal]);
  assert.equal((await client.query('SELECT recorded_quantity FROM fridge.inventory_balances WHERE product_id=$1',[pid])).rows[0].recorded_quantity,2);
  await client.query("INSERT INTO fridge.camera_audits(id,fridge_id,captured_at,image_quality,model,result) VALUES($1,'orion-fridge-01',now(),'unusable','verification-only','{}')",[audit]);
  assert.equal((await client.query('SELECT recorded_quantity FROM fridge.inventory_balances WHERE product_id=$1',[pid])).rows[0].recorded_quantity,2);
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ok:true,tables,hypertable:'sensor_readings',checks:['sensor write','product and donation write','duplicate donation prevented','unusable audit preserves inventory'],test_data:'rolled back'},null,2));
}catch{await client.query('ROLLBACK');console.error('Database verification failed; credentials were not printed.');process.exitCode=1;}finally{client.release();await pool.end();}
