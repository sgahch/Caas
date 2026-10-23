import {demoGpuModels,enrichDemoGpuModels,GPU_CATALOG_EVENT} from './gpu-catalog';
import {test} from 'node:test';import assert from 'node:assert/strict';import {seed,metrics,schedule,terminateOrder,fillIdle,taskAction,migrate,renew,handleAlert,tick,validate,billAmount,DAY,clone} from './store';import {usageRows} from './ui';
import {createRentalSample,bundleIds,removeScenarioBundle} from './scenario';
import {makeCsv,columns} from './ui';import {defaultConfig} from './config';
test('standard seed exact conservation',()=>{const s=seed();assert.deepEqual(metrics(s),{gpu:320,allocated:212,cpu:8192,cpuAllocated:5120,memory:32000,storage:512000,online:44,nodes:48,monthlyCents:28640000,token:128600000,totalToken:8420000000});assert.equal(s.orders.filter(o=>o.activatedAt).length,24);assert.equal(s.bills.filter(b=>b.status==='已支付').length,18);validate(s);});
test('preemption only affects NN-11 and matches exact CPU/rent',()=>{const s=seed(),other=clone(s.instances.find(v=>v.nodeId==='CD-09'));schedule(s,'TASK-DEMO-LEASE');assert.equal(metrics(s).allocated,212);assert.equal(metrics(s).cpuAllocated,5248);assert.equal(metrics(s).monthlyCents,29920000);assert.deepEqual(s.instances.find(v=>v.id===other!.id),other);assert.equal(s.orders.find(o=>o.id==='ORD-DEMO-LEASE')!.nodeId,'NN-11');validate(s);});
test('edge fallback preserves old edge instance and creates no rent',()=>{const s=seed(),count=s.orders.length;schedule(s,'TASK-DEMO-EDGE');assert.equal(metrics(s).allocated,216);assert.equal(metrics(s).cpuAllocated,5184);assert.equal(metrics(s).monthlyCents,28640000);assert.equal(s.tasks.find(t=>t.id==='TASK-DEMO-EDGE')!.nodeId,'IM-08');assert.equal(s.orders.length,count);validate(s);});
test('termination idempotency and paid history snapshots',()=>{const s=seed(),past=clone(s.bills);terminateOrder(s,'ORD-CD-01');terminateOrder(s,'ORD-CD-01');assert.equal(metrics(s).allocated,204);assert.equal(metrics(s).cpuAllocated,4928);assert.equal(metrics(s).monthlyCents,27320000);assert.equal(s.bills.at(-1)!.amountCents,836000);assert.deepEqual(s.bills.slice(0,-1),past);validate(s);const r=JSON.parse(JSON.stringify(s));tick(r);tick(r);assert.equal(metrics(r).allocated,204);assert.equal(r.bills.length,25);});
test('fill event never resurrects after termination or reload',()=>{const s=seed();assert.throws(()=>fillIdle(s));terminateOrder(s,'ORD-CD-01');fillIdle(s);fillIdle(s);assert.equal(metrics(s).allocated,212);assert.equal(metrics(s).cpuAllocated,4992);taskAction(s,'TASK-FILL-CD-01','终止');const r=JSON.parse(JSON.stringify(s));fillIdle(r);assert.equal(metrics(r).allocated,204);validate(r);});
test('pause holds resources, meter stops then resumes once',()=>{const s=seed(),id='TASK-TOKEN-NN-11';taskAction(s,id,'暂停');tick(s,10);assert.equal(metrics(s).allocated,212);assert.equal(s.tokenMeters.find(m=>m.nodeId==='NN-11')!.dailyCounters[0].outputTokens,32000000);taskAction(s,id,'恢复');tick(s,10);assert.equal(s.tokenMeters.filter(m=>m.nodeId==='NN-11').reduce((a,m)=>a+m.dailyCounters[0].outputTokens,0),32024000);validate(s);});
test('migration preserves identity and historical meter node',()=>{const s=seed(),id='INS-TOKEN-CD-09';tick(s,10);migrate(s,id,'CD-10');assert.equal(s.instances.find(v=>v.id===id)!.nodeId,'CD-10');assert.equal(s.tokenMeters.filter(m=>m.instanceId===id)[0].nodeId,'CD-09');tick(s,10);assert.equal(metrics(s).allocated,212);validate(s);assert.throws(()=>migrate(s,id,'EDGE-01'));});
test('fixed 30-day renewal and pending cancellation',()=>{const s=seed(),past=clone(s.bills),end=s.orders[0].end;renew(s,s.orders[0].id);assert.equal(s.orders[0].end,end+30*DAY);assert.equal(metrics(s).monthlyCents,28640000);assert.deepEqual(s.bills,past);terminateOrder(s,'ORD-DEMO-LEASE');assert.equal(s.bills.length,24);handleAlert(s,'ALT-NN-10','已确认');assert.equal(s.nodes.find(n=>n.id==='NN-10')!.status,'离线');validate(s);});
test('billing boundaries and contract expiry',()=>{assert.equal(billAmount(1320000,1,0,0),0);assert.equal(billAmount(1320000,1,0,DAY),44000);assert.equal(billAmount(1320000,1,0,DAY+1),88000);assert.equal(billAmount(1320000,1,0,30*DAY),1320000);const s=seed();tick(s,50*86400);assert.equal(s.orders.filter(o=>o.activatedAt&&o.status!=='已结束').length,0);validate(s);});
test('invalid references, capacity, X1 rental, duplicate IDs refused',()=>{for(const bad of [(s:any)=>s.instances[0].gpu=100,(s:any)=>s.orders[0].nodeId='EDGE-01',(s:any)=>s.tasks[0].tenantId='missing',(s:any)=>s.nodes.push(clone(s.nodes[0]))]){const s=seed();bad(s);assert.throws(()=>validate(s));}});
test('usage aggregates token separately and edge rent is zero',()=>{const s=seed(),rows=usageRows(s);assert.equal(rows.filter(r=>r.resourceType==='边缘算力').reduce((a,r)=>a+r.dueCents,0),0);assert.equal(rows.reduce((a,r)=>a+r.todayToken,0),128600000);});
test('admin scenario wizard and explicit bundle removal keep relationships valid',()=>{const s=seed(),before=metrics(s);createRentalSample(s,{business:'rental',nodeId:'IM-08',tenantId:'TEN-1',productId:'PROD-GPU',gpu:4,cpu:64,memory:128,edgeUnits:0});const order=s.orders.at(-1)!;assert.equal(metrics(s).allocated,before.allocated+4);removeScenarioBundle(s,bundleIds(s,'orders',order.id));assert.deepEqual(metrics(s),before);removeScenarioBundle(s,bundleIds(s,'orders','ORD-CD-01'));assert.equal(metrics(s).allocated,204);validate(s);});
test('CSV includes all filtered rows, plain decimal amounts, UTF8 BOM and quote/newline escaping',()=>{const s=seed(),c=defaultConfig();s.tenants[0].name='客户,"测试"\n第二行';const csv=makeCsv(columns('bills',s,c),s.bills,c);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"13200.00"'));assert.ok(!csv.includes('"13,200.00"'));assert.ok(csv.includes('客户,""测试""\n第二行'));assert.equal((csv.match(/"BILL-/g)||[]).length,24);});


test('eight-model demo migration preserves capacity, referenced and customized nodes and is idempotent',()=>{
 const s=seed();assert.equal(new Set(s.nodes.filter(n=>n.gpu).map(n=>n.model)).size,8);assert.equal(metrics(s).gpu,320);
 s.processedDemoEventIds=s.processedDemoEventIds.filter(id=>id!==GPU_CATALOG_EVENT);
 for(const [id,spec] of Object.entries(demoGpuModels))s.nodes.find(n=>n.id===id)!.model=spec.before;
 s.nodes.find(n=>n.id==='NN-13')!.model='客户自定义';
 s.tasks.push({...s.tasks[0],id:'CUSTOM-REFERENCE',preferredNodeId:'NN-14'});
 const capacity=metrics(s).gpu,allocated=metrics(s).allocated;
 assert.equal(enrichDemoGpuModels(s),true);assert.equal(s.nodes.find(n=>n.id==='NN-13')!.model,'客户自定义');assert.equal(s.nodes.find(n=>n.id==='NN-14')!.model,'A100');
 assert.equal(s.nodes.find(n=>n.id==='CD-10')!.model,'A100');assert.equal(s.nodes.find(n=>n.id==='IM-08')!.model,'H800');
 assert.equal(metrics(s).gpu,capacity);assert.equal(metrics(s).allocated,allocated);assert.equal(enrichDemoGpuModels(s),false);
});


test('customer regions accept arbitrary countries and flow through related views and CSV',()=>{
 const s=seed(),before=metrics(s),countries=['美国','日本','新加坡','Canada / 加拿大','德国，Berlin','Côte d’Ivoire','海外客户','国内客户'];
 s.tenants.forEach((tenant,i)=>tenant.region=countries[i]);validate(s);assert.deepEqual(metrics(s),before);
 for(const view of ['queue','instances','orders','billing','usage']){
  const data=view==='queue'?s.tasks:view==='instances'?s.instances:view==='orders'?s.orders:view==='billing'?s.bills:usageRows(s);
  const cols=columns(view,s,defaultConfig()),region=cols.find(c=>c.key==='region')!;
  for(const row of data)assert.equal(region.value(row),s.tenants.find(t=>t.id===row.tenantId)!.region);
  const csv=makeCsv(cols,data,defaultConfig());assert.ok(csv.includes('美国'));assert.ok(csv.includes('日本'));assert.ok(csv.includes('新加坡'));
 }
 for(const value of ['', '   ',null,123,'国'.repeat(101)]){const invalid=clone(s);invalid.tenants[0].region=value;assert.throws(()=>validate(invalid),/客户地区/);}
});
