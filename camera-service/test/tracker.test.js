import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InventoryTracker} from '../public/tracker.js';
import {inventorySchema} from '../vision.js';
/** @type {import('zod').infer<typeof inventorySchema>['items'][number]} */
const apple={name:'apple',category:'produce',visible_count:2,certainty:'high',evidence:'visible',boxes:[]};
/** @param {typeof apple[]} items @param {'usable'|'limited'|'unusable'} [quality] */
const frame=(items,quality='usable')=>({items,image_quality:quality,stock_level:/** @type {const} */('unknown'),observations:[],limitations:[]});
test('two scans confirm counts; one contradictory frame does not flicker',()=>{
  const t=new InventoryTracker();assert.equal(t.update(frame([apple])).items.length,0);
  assert.equal(t.update(frame([apple])).items[0].visible_count,2);
  assert.equal(t.update(frame([{...apple,visible_count:1}])).changes.length,0);
  assert.equal(t.update(frame([apple])).items[0].visible_count,2);
  t.update(frame([{...apple,visible_count:1}]));
  assert.equal(t.update(frame([{...apple,visible_count:1}])).changes[0].type,'count_changed');
});
test('occlusion, unusable images and low certainty do not establish disappearance',()=>{
  const t=new InventoryTracker();t.update(frame([apple]));t.update(frame([apple]));
  for(let i=0;i<5;i++)t.update(frame([],'limited'));
  assert.equal(t.snapshot().length,1);
  t.update(frame([]));t.update(frame([]));t.update(frame([],'unusable'));
  assert.equal(t.update(frame([])).changes.length,0);
  for(let i=0;i<4;i++)t.update(frame([{...apple,certainty:'low'}]));
  assert.equal(t.snapshot().length,1);
  t.update(frame([]));t.update(frame([]));
  assert.equal(t.update(frame([])).changes[0].type,'no_longer_visible');
});
test('low certainty and duplicate labels cannot confirm stock; reset clears session',()=>{
  const t=new InventoryTracker();for(let i=0;i<3;i++)t.update(frame([{...apple,certainty:'low'}]));
  assert.equal(t.snapshot().length,0);
  t.update(frame([apple,apple]));t.update(frame([apple,apple]));assert.equal(t.snapshot().length,0);
  t.update(frame([apple]));t.update(frame([apple]));t.reset();assert.equal(t.snapshot().length,0);
});
test('output schema rejects non-food categories and out-of-image boxes',()=>{
  assert.equal(inventorySchema.safeParse(frame([{...apple,category:/** @type {any} */('person')}])).success,false);
  assert.equal(inventorySchema.safeParse(frame([{...apple,boxes:[{xmin:-1,ymin:0,xmax:100,ymax:100}]}])).success,false);
});
