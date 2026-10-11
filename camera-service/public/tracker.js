// Temporal confirmation of visible inventory, not physical-object tracking.
/** @typedef {import('zod').infer<typeof import('../vision.js').inventorySchema>} Inventory */
/** @typedef {Inventory['items'][number]} Item */
/** @typedef {{stable: Item|null, candidate:number|null|undefined, hits:number, misses:number, stale:boolean}} Entry */
export class InventoryTracker {
  constructor() { /** @type {Map<string,Entry>} */ this.entries = new Map(); }
  reset() { this.entries.clear(); }
  /** @param {Inventory} inventory */
  update(inventory) {
    if (inventory.image_quality === 'unusable') { for (const e of this.entries.values()) { e.hits=0; e.misses=0; e.stale=true; } return {items:this.snapshot(),changes:[]}; }
    const changes=[], seen=new Set();
    /** @param {Item} i */
    const keyOf=i=>`${i.category}:${i.name.trim().toLowerCase()}`;
    for(const item of inventory.items){
      if(item.certainty==='low' || inventory.items.filter(i=>keyOf(i)===keyOf(item)).length!==1)continue;
      const key=keyOf(item);seen.add(key);
      const e=this.entries.get(key)||{stable:null,candidate:undefined,hits:0,misses:0,stale:false};
      e.misses=0;e.stale=false;
      if(e.candidate===item.visible_count)e.hits++;
      else{e.candidate=item.visible_count;e.hits=1;}
      if(e.hits>=2){
        if(!e.stable)changes.push({type:'added',name:item.name,from:null,to:item.visible_count});
        else if(e.stable.visible_count!==item.visible_count)changes.push({type:'count_changed',name:item.name,from:e.stable.visible_count,to:item.visible_count});
        e.stable={...item};
      }
      this.entries.set(key,e);
    }
    for(const [key,e] of this.entries){
      if(seen.has(key))continue;
      e.hits=0;e.candidate=undefined;e.stale=true;
      const uncertain=inventory.items.some(i=>keyOf(i)===key);
      if(inventory.image_quality==='usable'&&!uncertain)e.misses++;
      else e.misses=0;
      if(e.misses>=3){
        if(e.stable)changes.push({type:'no_longer_visible',name:e.stable.name,from:e.stable.visible_count,to:null});
        this.entries.delete(key);
      }
    }
    return {items:this.snapshot(),changes};
  }
  snapshot(){return [...this.entries.values()].filter(e=>e.stable).map(e=>({...e.stable,stale:e.stale}));}
}
