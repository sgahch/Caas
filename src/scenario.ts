import {canRentProduct,matchesProduct} from './product-catalog';
import {defaultModelRoute} from './model-usage';
import {DAY,collections,validate,type State,type Row,type Collection} from './store';
import {recordReferences} from './record-relations';
import type {Config} from './config';
export function sampleNodes(s:State,input:{business:string;productId:string;gpu:number;cpu:number;memory:number;edgeUnits:number}){
 const product=s.products.find(p=>p.id===input.productId),whole=input.business==='rental'&&product?.resourceType!=='GPU';
 if(input.business==='rental'&&(!canRentProduct(product)||product!.unitPriceCents<=0))return [];
 return s.nodes.filter(n=>{
  if(input.business==='rental'&&!matchesProduct(n,product!))return false;
  if(n.status!=='在线'||(input.business==='rental'&&n.deviceType==='edge'))return false;
  const held=s.instances.filter(v=>v.nodeId===n.id&&v.allocationHeld);
  if(whole&&held.length)return false;
  const required={gpu:n.deviceType==='edge'?0:whole?n.gpu:input.gpu,cpu:whole?n.cpu:input.cpu,memory:whole?n.memory:input.memory,edgeUnits:n.deviceType==='edge'?input.edgeUnits:0};
  return Object.entries(required).every(([key,value])=>Number.isFinite(value)&&value>=0&&held.reduce((sum,v)=>sum+(v[key]||0),0)+value<=n[key]);
 });
}
export function bundleIds(s:State,kind:string,id:string){
 if(!collections.includes(kind as Collection))throw Error('记录类型无效');
 if(kind==='policies')throw Error('四个固定策略不可删除');
 const rootKind=kind as Collection;
 if(!s[rootKind].some(r=>r.id===id))throw Error('记录不存在');
 const business:Collection[]=['orders','tasks','instances','usage','tokenMeters','bills','alerts','logs'];
 const sets:Record<string,Set<string>>=Object.fromEntries(collections.map(key=>[key,new Set<string>()]));
 sets[kind].add(id);
 if(kind==='sites'){
  sets.nodes=new Set(s.nodes.filter(n=>n.siteId===id).map(n=>n.id));
 }
 const wholeBusiness=['sites','nodes','tenants','products','orders','tasks','instances'].includes(kind);
 const owners=new Set<Collection>(['orders','tasks','instances','usage']);
 // Inventory and business roots remove complete workloads, including migrated history.
 // Leaf records only remove dependants; deleting one bill must not delete its order.
 let changed=true;
 while(changed){
  changed=false;
  const add=(key:Collection,value:string)=>{if(!sets[key].has(value)){sets[key].add(value);changed=true;}};
  for(const key of business)for(const row of s[key]){
   const refs=recordReferences(key,row);
   if(refs.some(ref=>sets[ref.kind]?.has(ref.id)))add(key,row.id);
   if(wholeBusiness&&sets[key].has(row.id)&&key!=='logs'&&key!=='alerts')
    for(const ref of refs)if(owners.has(ref.kind)&&s[ref.kind].some(r=>r.id===ref.id))add(ref.kind,ref.id);
  }
 }
 return sets;
}
export function bundleUnlinks(s:State,sets:Record<string,Set<string>>){
 const fields={edgeTenantId:'tenants',productId:'products'} as const;
 return s.nodes.filter(node=>!sets.nodes?.has(node.id)).flatMap(node=>
  (Object.keys(fields) as (keyof typeof fields)[]).filter(field=>sets[fields[field]]?.has(node[field])).map(field=>({id:node.id,field}))
 );
}
export function removeScenarioBundle(s:State,sets:Record<string,Set<string>>,validateScene=true){
 const old=structuredClone(s);
 try{
  if(sets.policies?.size)throw Error('四个固定策略不可删除');
  for(const {id,field} of bundleUnlinks(s,sets))s.nodes.find(node=>node.id===id)![field]='';
  for(const [key,ids] of Object.entries(sets))(s as any)[key]=(s as any)[key].filter((r:Row)=>!ids.has(r.id));
  const fallback=s.sites.find(site=>site.kind==='center')?.id;
  if(sets.sites?.size){
   if(!fallback)throw Error('至少保留一个中心机房');
   for(const site of s.sites)if(sets.sites.has(site.routeTo))site.routeTo=fallback;
  }
  const removed=[...Object.values(sets).flatMap(set=>[...set])];
  s.processedDemoEventIds=s.processedDemoEventIds.filter(marker=>marker.startsWith('catalog:')||!removed.some(id=>marker.includes(id)));
  if(validateScene)validate(s);
 }catch(e){Object.assign(s,old);throw e;}
}

export function cleanupRemovedConfig(config:Config,s:State){
 for(const [kind,rows] of Object.entries(config.presentation)){
  const ids=new Set(s[kind as Collection].map(row=>row.id));
  for(const id of Object.keys(rows))if(!ids.has(id))delete rows[id];
 }
 const fallback=s.sites.find(site=>site.kind==='center')?.id;
 for(const [id,site] of Object.entries(config.sites)){
  if(!s.sites.some(row=>row.id===id))delete config.sites[id];
  else if(!s.sites.some(row=>row.id===site.routeTo)&&fallback)site.routeTo=fallback;
 }
}
export function createRentalSample(s:State,input:any){const n=s.nodes.find(n=>n.id===input.nodeId),tenant=s.tenants.find(t=>t.id===input.tenantId),p=s.products.find(p=>p.id===input.productId);if(!n||!tenant||!p)throw Error('节点、租户或产品不存在');if(input.business==='rental'){if(!canRentProduct(p)||n.deviceType==='edge')throw Error('X1 不能出租');if(p.unitPriceCents<=0)throw Error('请先在产品目录填写有效租赁报价');if(!matchesProduct(n,p))throw Error('设备规格与租赁产品不匹配');}const old=structuredClone(s);try{const prefix=crypto.randomUUID().slice(0,12),now=s.demoNow,rental=input.business==='rental',whole=rental&&p.resourceType!=='GPU',gpu=n.deviceType==='edge'?0:whole?n.gpu:input.gpu,cpu=whole?n.cpu:input.cpu,memory=whole?n.memory:input.memory,edgeUnits=n.deviceType==='edge'?input.edgeUnits:0,orderId=rental?'ORD-'+prefix:'',taskId='TASK-'+prefix,instanceId='INS-'+prefix,usageId='USE-'+prefix;
 if(rental)s.orders.push({id:orderId,name:p.name,tenantId:tenant.id,productId:p.id,resourceType:p.resourceType,quantity:whole?1:gpu,unitPriceCents:p.unitPriceCents,gpu,cpu,memory,model:n.model,preferredSiteId:n.siteId,nodeId:n.id,billingMode:p.resourceType==='GPU'?'按天':'按月',start:now,end:now+DAY*30,activatedAt:now,actualEndedAt:0,status:'运行中',contractPeriods:[{start:now,end:now+DAY*30,unitPriceCents:p.unitPriceCents,quantity:whole?1:gpu,amountCents:p.unitPriceCents*(whole?1:gpu)}],description:'后台成套编排'});
 const businessType=rental?'rental':'token';s.tasks.push({id:taskId,name:rental?p.name:'系统Token推理',tenantId:tenant.id,type:rental?'租赁实例':n.deviceType==='edge'?'边缘算力':'Token 推理',businessType,source:rental?'租户订单':'系统任务',orderId,gpu,cpu,memory,edgeUnits,model:n.model,preferredSiteId:n.siteId,preferredNodeId:n.deviceType==='edge'?n.id:'',priority:rental?'P1':'P3',status:'运行中',nodeId:n.id,instanceId,created:now,failureReason:'',description:'后台成套编排'});
 s.instances.push({id:instanceId,name:rental?p.name:'系统Token推理',taskId,orderId,tenantId:tenant.id,nodeId:n.id,instanceType:n.deviceType==='edge'?'边缘实例':'裸金属',businessType,resourceType:rental?p.resourceType:n.deviceType==='edge'?'边缘算力':'裸金属',gpu,cpu,memory,edgeUnits,allocationHeld:true,status:'运行中',startedAt:now,endedAt:0,endReason:'',image:'标准镜像',calls:[],description:'后台成套编排'});
 s.usage.push({id:usageId,instanceId,tenantId:tenant.id,orderId,nodeId:n.id,businessType,resourceType:rental?p.resourceType:n.deviceType==='edge'?'边缘算力':'裸金属',startedAt:now,endedAt:0,phase:'运行',gpu,cpu,memory,edgeUnits});if(!rental)s.tokenMeters.push({...defaultModelRoute(s.tokenMeters.length),id:'METER-'+prefix,instanceId,usageRecordId:usageId,tenantId:tenant.id,nodeId:n.id,outputBeforeDemoDay:0,inputBeforeDemoDay:0,dailyCounters:[],rate:1000});validate(s);
 }catch(e){Object.assign(s,old);throw e;}}
