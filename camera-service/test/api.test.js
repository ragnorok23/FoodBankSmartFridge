import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app.js';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('uploaded image reaches analyzer with validated type and returns integration envelope', async () => {
  let called = false;
  const app = createApp({ configured: () => true, analyze: async (data,type) => {
    assert.deepEqual(data,image); assert.equal(type,'image/png'); called = true;
    return { model: 'test-model', inventory: {image_quality:'usable',stock_level:'unknown',items:[],observations:[],limitations:[]}, usage: {input_tokens:0,output_tokens:0,total_tokens:0} };
  }});
  const response = await request(app).post('/analyze').attach('image',image,{filename:'fridge.png',contentType:'image/png'});
  assert.equal(response.status,200); assert.equal(called,true);
  assert.equal(response.body.schema_version,'1.1'); assert.ok(response.body.scan_id);
  assert.equal(response.body.inventory.stock_level,'unknown');
});
test('invalid upload is rejected without invoking Gemini', async () => {
  const app = createApp({configured:()=>true,analyze:async()=>{throw Error('should not call');}});
  assert.equal((await request(app).post('/analyze')).status,400);
  assert.equal((await request(app).post('/analyze').attach('image',Buffer.from('not an image'),{filename:'fake.png',contentType:'image/png'})).status,415);
});
test('missing key and provider failures have useful errors without secret leakage', async () => {
  const missing = await request(createApp({configured:()=>false})).post('/analyze').attach('image',image,{filename:'a.png',contentType:'image/png'});
  assert.equal(missing.status,503);
  const failed = await request(createApp({configured:()=>true,analyze:async()=>{throw Error('private-key-example');}})).post('/analyze').attach('image',image,{filename:'a.png',contentType:'image/png'});
  assert.equal(failed.status,502); assert.ok(!JSON.stringify(failed.body).includes('private-key-example'));
});
test('rejects oversized files and unapproved browser origins', async () => {
  const app = createApp();
  assert.equal((await request(app).post('/analyze').attach('image',Buffer.alloc(8*1024*1024+1),{filename:'huge.png',contentType:'image/png'})).status,413);
  assert.equal((await request(app).get('/health').set('Origin','https://unapproved.example')).status,403);
});
test('provider quota, access and billing errors are classified without leaking provider details',async()=>{
  for(const [statusCode,expected] of [[429,'gemini_quota'],[402,'gemini_billing_required'],[403,'gemini_access_denied'],[404,'gemini_model_unavailable']]){
    const app=createApp({configured:()=>true,analyze:async()=>{throw Object.assign(new Error('secret-provider-details'),{statusCode});}});
    const response=await request(app).post('/analyze').attach('image',image,{filename:'a.png',contentType:'image/png'});
    assert.equal(response.body.error,expected);
    assert.ok(!JSON.stringify(response.body).includes('secret-provider-details'));
  }
});
test('donation endpoint routes language and image to identification, not inventory analysis',async()=>{
  let calls=0;
  const app=createApp({configured:()=>true,analyze:async()=>{throw Error('wrong camera role');},identify:async(data,type,language)=>{
    assert.deepEqual(data,image);assert.equal(type,'image/png');assert.equal(language,'Spanish');calls++;
    return {model:'test',language,identification:{food_detected:true,items:[{name:'apple',translated_name:'manzana',visible_count:1,certainty:'high',evidence:'visible'}],message:'Una manzana',limitations:[]},usage:{input_tokens:0,output_tokens:0,total_tokens:0}};
  }});
  const response=await request(app).post('/identify').field('language','Spanish').attach('image',image,{filename:'a.png',contentType:'image/png'});
  assert.equal(response.status,200);assert.equal(calls,1);assert.equal(response.body.identification.items[0].translated_name,'manzana');assert.equal(response.body.inventory,undefined);
  assert.equal((await request(app).post('/identify').field('language','unexpected-prompt').attach('image',image,{filename:'a.png',contentType:'image/png'})).status,400);
  assert.equal(calls,1);
});
