import express from 'express';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {makePool} from './db.js';
import {fileURLToPath} from 'node:url';
import {getThermalMetrics} from './thermal-query.js';
import {existsSync,readFileSync} from 'node:fs';
import {conditionMetrics} from './conditions.js';
const conditionBaseline=JSON.parse(readFileSync(new URL('./condition-baseline.json',import.meta.url),'utf8'));
const pool=makePool(), app=express();
// Automatic localhost dashboard sessions can read thermal metrics only.
// They never grant the browser the backend token or permission to write data.
const monitorSessions=new Map();
if(!process.env.DATA_API_TOKEN)throw new Error('DATA_API_TOKEN required');
app.disable('x-powered-by');app.use(express.json({limit:'256kb'}));
app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,database:'connected'});}catch{res.status(503).json({ok:false,database:'unavailable'});}});
app.get('/monitor',(req,res)=>{
  if(!['127.0.0.1','localhost'].includes(req.hostname))return res.sendStatus(403);
  for(const [id,expires] of monitorSessions)if(expires<Date.now())monitorSessions.delete(id);
  if(monitorSessions.size>=128)monitorSessions.delete(monitorSessions.keys().next().value);
  const session=randomUUID();monitorSessions.set(session,Date.now()+3600000);
  res.cookie('fridge_monitor',session,{httpOnly:true,sameSite:'strict',maxAge:3600000,path:'/'});
  res.set('Cache-Control','no-store');
  res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'");
  res.sendFile(fileURLToPath(new URL('./public/monitor.html',import.meta.url)));
});
app.get('/monitor.js',(_req,res)=>res.sendFile(fileURLToPath(new URL('./public/monitor.js',import.meta.url))));
app.use((req,res,next)=>{
  const session=(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('fridge_monitor='))?.slice('fridge_monitor='.length);
  if(req.method==='GET' && (/^\/fridges\/[^/]+\/(thermal|conditions)$/.test(req.path)||req.path==='/monitor/live')
    && ['127.0.0.1','localhost'].includes(req.hostname)
    && req.get('sec-fetch-site')==='same-origin'
    && (monitorSessions.get(session)||0)>Date.now())return next();
  const supplied=Buffer.from(req.get('authorization')||''),expected=Buffer.from(`Bearer ${process.env.DATA_API_TOKEN}`);
  if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return res.status(401).json({error:'unauthorized'});
  next();
});
const uuid=z.string().uuid(), timestamp=z.string().datetime({offset:true});
const fridge=z.string().min(1).max(100), json=z.record(z.string(),z.unknown());
app.get('/monitor/live',(_req,res)=>{
  res.set('Cache-Control','no-store');
  try{const reading=JSON.parse(readFileSync(new URL('.sensor-live',import.meta.url),'utf8'));
    res.json({...reading,stale:Date.now()-Date.parse(reading.captured_at)>20000,source:'local_preview_not_database'});
  }catch{res.json({stale:true,temperature_c:null,source:'local_preview_not_database'});}
});
app.get('/fridges/:id/conditions',async(req,res)=>{
  const id=fridge.parse(req.params.id);
  if(id!==conditionBaseline.fridge_id)return res.status(409).json({error:'no_condition_baseline_for_fridge'});
  const now=new Date();
  const result=await pool.query(`SELECT captured_at,temperature_c,moisture_raw,air_quality_raw,metadata
    FROM fridge.sensor_readings WHERE fridge_id=$1 AND device_id=$2
    AND captured_at BETWEEN $3 AND $4
    AND COALESCE(metadata->>'recording_phase','monitoring')<>'cooldown'
    ORDER BY captured_at ASC LIMIT 10001`,[id,conditionBaseline.device_id,new Date(+now-315000),now]);
  if(result.rowCount>10000)return res.status(422).json({error:'condition_window_too_large'});
  res.set('Cache-Control','no-store');
  res.json({fridge_id:id,device_id:conditionBaseline.device_id,...conditionMetrics(result.rows,conditionBaseline,{now})});
});
app.get('/fridges/:id/thermal',async(req,res)=>{
  const q=z.object({start:timestamp.optional(),end:timestamp.optional(),device_id:fridge.optional(),threshold_c:z.coerce.number().finite().min(-40).max(85).default(4),max_gap_seconds:z.coerce.number().finite().min(1).max(300).default(15),stale_seconds:z.coerce.number().finite().min(1).max(600).default(20)}).parse(req.query);
  const end=q.end?new Date(q.end):new Date(),start=q.start?new Date(q.start):new Date(+end-3600000);
  if(+end> Date.now()+1000 || +end<=+start || +end-+start>7*86400000)return res.status(400).json({error:'window_must_be_past_positive_and_at_most_7_days'});
  res.set('Cache-Control','no-store');
  const metrics=await getThermalMetrics(pool,{fridgeId:fridge.parse(req.params.id),deviceId:q.device_id||process.env.DEVICE_ID||'arduino-uno-r4',start,end,thresholdC:q.threshold_c,maxGapSeconds:q.max_gap_seconds,staleSeconds:q.stale_seconds});
  res.json({...metrics,collection_phase:existsSync(new URL('.sensor-waiting',import.meta.url))?'waiting_for_stability':existsSync(new URL('.sensor-paused',import.meta.url))?'paused':'collection_enabled',excluded_phase:'cooldown'});
});
const url=z.string().url().refine(s=>s.startsWith('https://'),'Use HTTPS').nullable().optional();
const product=z.object({id:uuid.optional(),canonical_name:z.string().min(1).max(200),barcode:z.string().regex(/^\d{8,14}$/).nullable().optional(),brand:z.string().max(200).nullable().optional(),variant:z.string().max(200).nullable().optional(),package_size:z.string().max(100).nullable().optional(),display_image_url:url,image_source_url:url,match_method:z.enum(['barcode','visual','manual','generic']),metadata:json.default({})});
app.post('/products',async(req,res)=>{
  const p=product.parse(req.body);
  const result=await pool.query(`INSERT INTO fridge.products(id,canonical_name,barcode,brand,variant,package_size,display_image_url,image_source_url,match_method,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(barcode) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,brand=EXCLUDED.brand,variant=EXCLUDED.variant,package_size=EXCLUDED.package_size,display_image_url=COALESCE(EXCLUDED.display_image_url,fridge.products.display_image_url),image_source_url=COALESCE(EXCLUDED.image_source_url,fridge.products.image_source_url),match_method=EXCLUDED.match_method,metadata=EXCLUDED.metadata RETURNING *`,[p.id||randomUUID(),p.canonical_name,p.barcode||null,p.brand,p.variant,p.package_size,p.display_image_url,p.image_source_url,p.match_method,p.metadata]);
  res.status(201).json(result.rows[0]);
});
app.post('/donations/propose',async(req,res)=>{
  const p=z.object({id:uuid,fridge_id:fridge,product_id:uuid,quantity:z.number().int().min(1).max(10000),identification_method:z.enum(['gemini','barcode','manual']),certainty:z.enum(['high','medium','low','unknown']),observation_image_url:url,details:json.default({})}).parse(req.body);
  const result=await pool.query(`INSERT INTO fridge.donation_proposals(id,fridge_id,product_id,quantity,identification_method,certainty,observation_image_url,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *`,[p.id,p.fridge_id,p.product_id,p.quantity,p.identification_method,p.certainty,p.observation_image_url,p.details]);
  res.status(result.rowCount?201:200).json(result.rows[0]||(await pool.query('SELECT * FROM fridge.donation_proposals WHERE id=$1',[p.id])).rows[0]);
});
app.post('/donations/confirm',async(req,res)=>{
  const {proposal_id}=z.object({proposal_id:uuid}).parse(req.body),client=await pool.connect();
  try{
    await client.query('BEGIN');
    const p=(await client.query('SELECT * FROM fridge.donation_proposals WHERE id=$1 FOR UPDATE',[proposal_id])).rows[0];
    if(!p || p.status==='cancelled'){await client.query('ROLLBACK');return res.status(409).json({error:'proposal_unavailable'});}
    await client.query(`INSERT INTO fridge.inventory_events(id,fridge_id,product_id,proposal_id,kind,quantity_delta,verification) VALUES($1,$2,$3,$4,'donation',$5,'donor_confirmed') ON CONFLICT(proposal_id) DO NOTHING`,[randomUUID(),p.fridge_id,p.product_id,p.id,p.quantity]);
    await client.query("UPDATE fridge.donation_proposals SET status='donor_confirmed',confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1",[p.id]);
    await client.query('COMMIT');res.json({proposal_id,status:'donor_confirmed',camera_verified:false});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
app.post('/inventory/audits',async(req,res)=>{
  const a=z.object({id:uuid,fridge_id:fridge,captured_at:timestamp,image_quality:z.enum(['usable','limited','unusable']),model:z.string().min(1).max(100),result:json,comparison:json.default({}),observation_image_url:url}).parse(req.body);
  const result=await pool.query(`INSERT INTO fridge.camera_audits(id,fridge_id,captured_at,image_quality,model,result,comparison,observation_image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id`,[a.id,a.fridge_id,a.captured_at,a.image_quality,a.model,a.result,a.comparison,a.observation_image_url]);
  res.status(result.rowCount?201:200).json({id:a.id,stored:true,requires_review:true,inventory_changed:false});
});
app.get('/fridges/:id/inventory',async(req,res)=>res.json((await pool.query('SELECT * FROM fridge.inventory_balances WHERE fridge_id=$1 ORDER BY canonical_name',[fridge.parse(req.params.id)])).rows));
app.get('/fridges/:id/audits',async(req,res)=>res.json((await pool.query('SELECT * FROM fridge.camera_audits WHERE fridge_id=$1 ORDER BY captured_at DESC LIMIT 100',[fridge.parse(req.params.id)])).rows));
app.get('/fridges/:id/sensors',async(req,res)=>res.json((await pool.query('SELECT * FROM fridge.sensor_readings WHERE fridge_id=$1 ORDER BY captured_at DESC LIMIT 100',[fridge.parse(req.params.id)])).rows));
app.use((error,_req,res,_next)=>{if(error instanceof z.ZodError)return res.status(400).json({error:'invalid_input',fields:error.issues.map(i=>i.path.join('.'))});if(error.code==='METRICS_WINDOW_TOO_LARGE')return res.status(422).json({error:'reduce_metrics_window'});if(error.type==='entity.too.large')return res.status(413).json({error:'payload_too_large'});res.status(500).json({error:'data_operation_failed'});});
const server=app.listen(Number(process.env.DATA_PORT||3200),'127.0.0.1',()=>console.log('Fridge data API: http://127.0.0.1:'+(process.env.DATA_PORT||3200)));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
