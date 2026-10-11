/** @typedef {import('zod').infer<typeof import('../vision.js').inventorySchema>} Inventory */
/** @param {Inventory|null} previous @param {Inventory} current */
export function compareAudits(previous,current){
  if(!previous)return {comparable:false,reason:'First audit establishes a baseline.',differences:[]};
  if(previous.image_quality!=='usable'||current.image_quality!=='usable')return {comparable:false,reason:'Clear usable images are required to compare inventory.',differences:[]};
  /** @param {Inventory['items'][number]} i */
  const key=i=>`${i.category}:${i.name.trim().toLowerCase()}`;
  const before=new Map(previous.items.map(i=>[key(i),i])),after=new Map(current.items.map(i=>[key(i),i]));
  const differences=[];
  for(const k of new Set([...before.keys(),...after.keys()])){
    const a=before.get(k),b=after.get(k);
    if(a?.certainty==='low'||b?.certainty==='low')continue;
    if(previous.items.filter(i=>key(i)===k).length>1||current.items.filter(i=>key(i)===k).length>1)continue;
    const from=a?a.visible_count:0,to=b?b.visible_count:0;
    if(from===null||to===null)continue;
    if(from!==to)differences.push({name:(b||a)?.name,previous_count:from,current_count:to,delta:to-from,requires_review:true});
  }
  return {comparable:true,reason:'Visible counts differ; this does not establish theft or physical removal.',differences};
}
export const HOUR_MS=60*60*1000;
/** @param {number} now @param {number} [interval] */
export function nextAuditTime(now,interval=HOUR_MS){return now+interval;}
/** @param {number} failures */
export function retryDelay(failures){return Math.min(300000,30000*2**Math.max(0,failures-1));}
