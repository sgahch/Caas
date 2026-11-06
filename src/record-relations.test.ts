import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,clone,validate,migrate,collections} from './store';
import {defaultConfig,validateConfig} from './config';
import {incomingReferences} from './record-relations';
import {bundleIds,bundleUnlinks,removeScenarioBundle,cleanupRemovedConfig} from './scenario';
import {DesktopService} from '../electron/service';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('single deletion ignores identity and descriptive text, but detects typed links and logs',()=>{
 const s=seed(),id='NN-16';
 assert.deepEqual(incomingReferences(s,'nodes',id),[]);
 s.tenants[0].description=id;s.products[0].name=id;
 assert.deepEqual(incomingReferences(s,'nodes',id),[]);
 s.tasks[0].preferredNodeId=id;
 assert.deepEqual(incomingReferences(s,'nodes',id),[{kind:'tasks',id:s.tasks[0].id}]);
 s.logs.push({id:'QA-LOG',entityType:'nodes',entityId:id});
 assert.equal(incomingReferences(s,'nodes',id).length,2);
 assert.ok(incomingReferences(s,'nodes','NN-02').some(ref=>ref.kind==='orders'));
});

test('unreferenced device can be removed and the remaining scene validates',()=>{
 const s=seed();s.nodes=s.nodes.filter(n=>n.id!=='NN-16');validate(s);
});

for(const id of ['NN-01','NN-02','EDGE-01'])test('device bundle removes complete business history and only the selected inventory: '+id,()=>{
 const s=seed();assert.ok(s.nodes.some(n=>n.id===id));const before=clone(s),sets=bundleIds(s,'nodes',id);
 assert.deepEqual([...sets.nodes],[id]);assert.ok(sets.tasks.size);assert.ok(sets.instances.size);
 removeScenarioBundle(s,sets);validate(s);
 assert.deepEqual(s.nodes,before.nodes.filter(n=>n.id!==id));
 for(const key of ['sites','tenants','products'] as const)assert.deepEqual(s[key],before[key]);
 assert.deepEqual(incomingReferences(s,'nodes',id),[]);
 assert.ok(s.orders.some(o=>o.id==='ORD-CD-01'));
});

test('migrated token workload removes its complete history without deleting the destination device',()=>{
 const s=seed(),v=s.instances.find(v=>v.nodeId==='NN-11'&&v.allocationHeld)!;
 s.nodes.find(n=>n.id==='NN-16')!.model=s.nodes.find(n=>n.id==='NN-11')!.model;
 migrate(s,v.id,'NN-16');validate(s);
 const before=clone(s);const sets=bundleIds(s,'nodes','NN-11');
 assert.ok(sets.instances.has(v.id));removeScenarioBundle(s,sets);validate(s);
 const inventory=(nodes:typeof s.nodes)=>nodes.map(({allocated,...node})=>node);
 assert.deepEqual(inventory(s.nodes),inventory(before.nodes.filter(n=>n.id!=='NN-11')));
 assert.equal(s.instances.some(row=>row.id===v.id),false);
 assert.equal(s.tokenMeters.some(row=>row.instanceId===v.id),false);
});

test('business bundle keeps device and draft rollback is atomic for incomplete deletion',()=>{
 const s=seed(),before=clone(s);removeScenarioBundle(s,bundleIds(s,'orders','ORD-NN-02'));
 validate(s);assert.deepEqual(s.nodes.map(({allocated,...n})=>n),before.nodes.map(({allocated,...n})=>n));assert.deepEqual(s.tenants,before.tenants);
 const unchanged=clone(s);assert.throws(()=>removeScenarioBundle(s,{nodes:new Set(['NN-01'])}));assert.deepEqual(s,unchanged);
});

test('device deletion applies to SQLite, survives restart and does not regenerate nationwide inventory',()=>{
 const root=mkdtempSync(join(tmpdir(),'caas-deletion-'));let service=new DesktopService(root,()=>{},false);
 try{
  service.login('Deletion-Regression-2026');service.beginMaintenance();const draft=clone(service.draft!);
  removeScenarioBundle(draft.state!,bundleIds(draft.state!,'nodes','NN-02'));
  draft.state!.nodes=draft.state!.nodes.filter(n=>n.id!=='EDGE-N-23');
  const saved=service.saveDraft(draft);service.applyDraft({draftRevision:saved.draftRevision,confirm:true});
  const expected=clone(service.state);service.close();service=new DesktopService(root,()=>{},false);
  assert.deepEqual(service.state,expected);validate(service.state);
  assert.equal(service.state.nodes.some(n=>['NN-02','EDGE-N-23'].includes(n.id)),false);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});

for(const kind of collections.filter(kind=>kind!=='policies'))test('direct deletion validates for every seeded '+kind+' record without dangling links',()=>{
 const before=seed();
 for(const row of before[kind]){
  const s=clone(before),sets=bundleIds(s,kind,row.id),unlinks=bundleUnlinks(s,sets);
  assert.deepEqual(s,before,'preview must not mutate the scene');
  removeScenarioBundle(s,sets);validate(s);
  assert.equal(s[kind].some(r=>r.id===row.id),false);
  assert.deepEqual(incomingReferences(s,kind,row.id),[],kind+'/'+row.id);
  for(const [key,ids] of Object.entries(sets))for(const id of ids)
   assert.deepEqual(incomingReferences(s,key as typeof kind,id),[],key+'/'+id);
  for(const {id,field} of unlinks)assert.equal(s.nodes.find(node=>node.id===id)![field],'');
  assert.deepEqual(s.processedDemoEventIds.filter(marker=>marker.startsWith('catalog:')),before.processedDemoEventIds);
 }
});

test('tenant deletion clears business and device ownership without removing shared inventory or other tenants',()=>{
 const s=seed(),before=clone(s),id='TEN-1',sets=bundleIds(s,'tenants',id);
 const owned=s.nodes.filter(node=>node.edgeTenantId===id).map(node=>node.id);
 assert.ok(owned.length);assert.equal(sets.nodes.size,0);assert.ok(sets.orders.size);assert.ok(sets.tasks.size);
 removeScenarioBundle(s,sets);validate(s);
 assert.deepEqual(s.nodes.map(node=>node.id),before.nodes.map(node=>node.id));
 assert.ok(owned.every(id=>s.nodes.find(node=>node.id===id)!.edgeTenantId===''));
 assert.deepEqual(s.tenants,before.tenants.filter(tenant=>tenant.id!==id));
 assert.deepEqual(s.products,before.products);assert.deepEqual(s.sites,before.sites);
 assert.ok(s.orders.some(order=>order.id==='ORD-NN-02'));
});

test('product deletion clears its orders but only unlinks inventory product assignments',()=>{
 const s=seed(),id='PROD-BARE';s.nodes[0].productId=id;const before=clone(s);
 removeScenarioBundle(s,bundleIds(s,'products',id));validate(s);
 assert.equal(s.nodes[0].productId,'');assert.equal(s.orders.some(order=>order.productId===id),false);
 assert.deepEqual(s.nodes.map(node=>node.id),before.nodes.map(node=>node.id));
 assert.deepEqual(s.tenants,before.tenants);assert.deepEqual(s.sites,before.sites);
 assert.ok(s.orders.some(order=>order.productId==='PROD-WHOLE'));
});

for(const kind of ['usage','tokenMeters','bills','alerts','logs'] as const)test('leaf deletion retains its owners and unrelated history: '+kind,()=>{
 const s=seed(),id=s[kind][0].id;
 s.logs.push({id:'QA-DEPENDENT-LOG',entityType:kind,entityId:id});
 s.logs.push({id:'QA-NESTED-LOG',entityType:'logs',entityId:'QA-DEPENDENT-LOG'});
 const before=clone(s),sets=bundleIds(s,kind,id);removeScenarioBundle(s,sets);validate(s);
 for(const key of ['sites','nodes','tenants','products','orders','tasks','instances'] as const)assert.deepEqual(s[key],before[key]);
 assert.equal(s.logs.some(log=>['QA-DEPENDENT-LOG','QA-NESTED-LOG'].includes(log.id)),false);
 if(kind==='usage')assert.equal(s.tokenMeters.some(meter=>meter.usageRecordId===id),false);
 if(kind==='bills')assert.deepEqual(s.usage,before.usage);
});

test('deletion cleans display metadata without changing unrelated configuration',()=>{
 const s=seed(),config=defaultConfig(),sets=bundleIds(s,'tenants','TEN-1');
 for(const [kind,ids] of Object.entries(sets))config.presentation[kind]=Object.fromEntries([...ids].map(id=>[id,{displayCode:'自定义-'+id}]));
 config.presentation.tenants['TEN-2']={name:'保留客户'};
 removeScenarioBundle(s,sets);cleanupRemovedConfig(config,s);validateConfig(config,s);
 assert.deepEqual(config.presentation.tenants,{'TEN-2':{name:'保留客户'}});
 for(const [kind,ids] of Object.entries(sets))for(const id of ids)assert.equal(config.presentation[kind][id],undefined);
});

test('invalid roots and fixed policies cannot be removed and a failed unlink operation rolls back',()=>{
 const s=seed(),before=clone(s);
 assert.throws(()=>bundleIds(s,'unknown','NN'),/记录类型无效/);
 assert.throws(()=>bundleIds(s,'tenants','missing'),/记录不存在/);
 assert.throws(()=>bundleIds(s,'policies','POLICY-1'),/固定策略不可删除/);
 assert.throws(()=>removeScenarioBundle(s,{policies:new Set(['POLICY-1'])}),/固定策略不可删除/);
 assert.throws(()=>removeScenarioBundle(s,{tenants:new Set(['TEN-1'])}),/关联不存在/);
 assert.deepEqual(s,before);
});

test('deleting a custom record cannot clear catalog migration markers',()=>{
 const s=seed(),markers=clone(s.processedDemoEventIds);
 s.logs.push({id:'catalog',entityType:'system',entityId:'qa'});
 removeScenarioBundle(s,bundleIds(s,'logs','catalog'));assert.deepEqual(s.processedDemoEventIds,markers);
});

test('all tenant and product data can be removed, applied, exported and restarted without regeneration',()=>{
 const root=mkdtempSync(join(tmpdir(),'caas-unified-delete-'));let service=new DesktopService(root,()=>{},false);
 try{
  service.login('Unified-Deletion-2026');const before=clone(service.state);
  service.beginMaintenance();const draft=clone(service.draft!),s=draft.state!;
  for(const kind of ['tenants','products'] as const)for(const row of [...s[kind]])removeScenarioBundle(s,bundleIds(s,kind,row.id));
  cleanupRemovedConfig(draft.config,s);validate(s);validateConfig(draft.config,s);
  assert.equal(s.tenants.length,0);assert.equal(s.products.length,0);assert.equal(s.tasks.length,0);
  assert.equal(s.instances.length,0);assert.equal(s.bills.length,0);
  assert.deepEqual(s.nodes.map(node=>node.id),before.nodes.map(node=>node.id));
  const saved=service.saveDraft(draft);assert.deepEqual(service.state,before);
  service.applyDraft({draftRevision:saved.draftRevision,confirm:true});
  const expected=clone(service.state);assert.deepEqual(service.baseline,expected);
  const backup=service.readBackup(service.backups()[0]);assert.deepEqual(backup.state,before);
  assert.deepEqual(service.parsePackage(service.exportText()).state,expected);
  service.close();service=new DesktopService(root,()=>{},false);
  assert.deepEqual(service.state,expected);assert.deepEqual(service.baseline,expected);
  service.login('Unified-Deletion-2026');
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});
