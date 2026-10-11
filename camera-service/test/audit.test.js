import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareAudits,nextAuditTime,HOUR_MS,retryDelay} from '../public/audit.js';
import {inventorySchema} from '../vision.js';
/** @type {import('zod').infer<typeof inventorySchema>['items'][number]} */
const apple={name:'apple',category:'produce',visible_count:2,certainty:'high',evidence:'visible',boxes:[]};
/** @param {typeof apple[]} items @param {'usable'|'limited'|'unusable'} [quality] */
const frame=(items,quality='usable')=>({items,image_quality:quality,stock_level:/** @type {const} */('unknown'),observations:[],limitations:[]});
test('hourly schedule uses a full hour, not an eight-second loop',()=>assert.equal(nextAuditTime(1000),1000+HOUR_MS));
test('demo cadence and bounded transient retries do not change the normal hourly interval',()=>{
  assert.equal(nextAuditTime(1000,30000),31000);
  assert.equal(retryDelay(1),30000);assert.equal(retryDelay(2),60000);assert.equal(retryDelay(100),300000);
  assert.equal(nextAuditTime(1000),1000+HOUR_MS);
});
test('audit distinguishes baseline, obstructed scene, and reviewable count changes',()=>{
  assert.equal(compareAudits(null,frame([apple])).comparable,false);
  assert.equal(compareAudits(frame([apple]),frame([],'limited')).differences.length,0);
  const result=compareAudits(frame([apple]),frame([{...apple,visible_count:1}]));
  assert.equal(result.differences[0].delta,-1);assert.equal(result.differences[0].requires_review,true);
});
test('uncertain and unknown counts cannot generate inventory discrepancy claims',()=>{
  assert.equal(compareAudits(frame([apple]),frame([{...apple,certainty:'low'}])).differences.length,0);
  assert.equal(compareAudits(frame([apple]),frame([{...apple,visible_count:null}])).differences.length,0);
});
