import {demoGpuModels,GPU_CATALOG_EVENT} from '../src/gpu-catalog';
import {PRODUCT_CATALOG_EVENT} from '../src/product-catalog';
import {MODEL_ROUTES_EVENT} from '../src/model-usage';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DesktopService} from './service';import {clone,metrics} from '../src/store';
function setup(){const root=mkdtempSync(join(tmpdir(),'caas-v2-'));const svc=new DesktopService(root,()=>{},false);return {svc,root,close(){svc.close();rmSync(root,{recursive:true,force:true});}};}
function cmd(s:DesktopService,command:any,requestId=crypto.randomUUID()){const snap=s.snapshot();return {requestId,runId:snap.runId,expectedBusinessRevision:snap.businessRevision,command};}

function beforeCommerce(scene:any){scene.products=scene.products.filter((p:any)=>!['PROD-STARHERO-X1','PROD-SLX-V4','PROD-TITANPOWER-X8','PROD-MOQING-X9'].includes(p.id));scene.processedDemoEventIds=scene.processedDemoEventIds.filter((x:string)=>![PRODUCT_CATALOG_EVENT,MODEL_ROUTES_EVENT].includes(x));for(const m of scene.tokenMeters){delete m.modelName;delete m.modelProvider;}return scene;}
test('rental/model catalog database upgrade backs up once and preserves hardware, contracts, draft and administrator',()=>{
 const ctx=setup();let s=ctx.svc;try{
  s.login('Commerce-upgrade-2026');s.beginMaintenance();const expected=metrics(s.state),old=beforeCommerce(clone(s.state)),draft=s.adminRead().draft!;draft.state=clone(old);
  const update=s.db.prepare('UPDATE records SET json=? WHERE key=?');update.run(JSON.stringify(old),'runtime_state');update.run(JSON.stringify(old),'scenario_baseline');update.run(JSON.stringify(draft),'cms_draft');s.close();s=new DesktopService(ctx.root,()=>{},false);
  assert.deepEqual(metrics(s.state),expected);assert.equal(s.state.products.length,7);assert.ok(s.state.tokenMeters.every(m=>m.modelName&&m.modelProvider));assert.equal(s.draft!.state!.products.length,7);assert.ok(s.meta.maintenance);assert.equal(s.meta.playing,false);assert.equal(s.backups().length,1);s.login('Commerce-upgrade-2026');
  const names=s.state.tokenMeters.map(m=>m.modelName);s.close();s=new DesktopService(ctx.root,()=>{},false);assert.equal(s.backups().length,1);assert.deepEqual(s.state.tokenMeters.map(m=>m.modelName),names);assert.deepEqual(metrics(s.state),expected);
 }finally{s.close();ctx.close();}
});
test('authentic legacy packages acquire product/model metadata after checksum verification',()=>{
 const ctx=setup();try{const original=JSON.parse(ctx.svc.exportText());beforeCommerce(original.payload.state);beforeCommerce(original.payload.baseline);original.sha256=createHash('sha256').update(JSON.stringify(original.payload)).digest('hex');const upgraded=ctx.svc.parsePackage(JSON.stringify(original));assert.equal(upgraded.state.products.length,7);assert.ok(upgraded.state.tokenMeters.every((m:any)=>m.modelName));original.payload.state.products[0].unitPriceCents++;assert.throws(()=>ctx.svc.parsePackage(JSON.stringify(original)),/SHA-256/);}finally{ctx.close();}
});

test('normal exit checkpoints active per-second output before the periodic checkpoint',async()=>{
 const root=mkdtempSync(join(tmpdir(),'caas-active-exit-'));let svc=new DesktopService(root,()=>{},true);
 try{
  const initial=metrics(svc.state).totalToken;await new Promise(resolve=>setTimeout(resolve,1250));
  const live=svc.snapshot();assert.ok(metrics(live.state).totalToken>initial);assert.ok(live.state.tokenHistory?.some(p=>!p.seeded));
  svc.close();svc=new DesktopService(root,()=>{},false);
  assert.equal(metrics(svc.state).totalToken,metrics(live.state).totalToken);assert.equal(svc.state.demoNow,live.state.demoNow);assert.deepEqual(svc.state.tokenHistory,live.state.tokenHistory);
 }finally{svc.close();rmSync(root,{recursive:true,force:true});}
});

test('published refresh defaults persist, preview is frozen, and maintenance stops telemetry',()=>{
 const ctx=setup();let s=ctx.svc;try{
  const config=clone(s.config);config.refreshSeconds=5;const draft=s.saveDraft({config,draftRevision:0});
  assert.equal(s.preview().snapshot.playing,false);s.applyDraft({draftRevision:draft.draftRevision});
  assert.equal((s.snapshot() as any).refreshSeconds,5);
  s.beginMaintenance();const before=clone(s.state.nodes);assert.throws(()=>s.dispatch(cmd(s,{type:'play',playing:true})));assert.deepEqual(s.state.nodes,before);
  s.discard();s.close();s=new DesktopService(ctx.root,()=>{},false);assert.equal((s.snapshot() as any).refreshSeconds,5);
 }finally{s.close();ctx.close();}
});

test('legacy database telemetry upgrade is backed up and preserves custom fixed nodes and brand',()=>{
 const ctx=setup();let s=ctx.svc;try{
  const old=clone(s.state);for(const n of old.nodes){delete n.telemetryProfile;n.telemetryMode='固定值';Object.assign(n,{gpuUtil:n.gpu?66:0,cpuUtil:42,vramUtil:n.gpu?58:0,memoryUtil:46,storageUtil:32,temperature:n.deviceType==='edge'?39:53});n.samples=Array.from({length:60},(_,i)=>({time:old.demoNow-(59-i)*60000,value:n.gpuUtil,cpuValue:42,vramValue:n.vramUtil,memoryValue:46,storageValue:32}));}
  old.nodes[0].gpuUtil=40;old.nodes[0].samples.forEach((p:any)=>p.value=40);
  const update=s.db.prepare('UPDATE records SET json=? WHERE key=?');update.run(JSON.stringify(old),'runtime_state');update.run(JSON.stringify(old),'scenario_baseline');
  update.run(JSON.stringify({...s.config,refreshSeconds:30,platformName:'升级保留品牌'}),'published_config');update.run(JSON.stringify({...s.meta,refreshSeconds:60}),'app_meta');
  s.close();s=new DesktopService(ctx.root,()=>{},false);
  assert.equal(s.config.platformName,'升级保留品牌');assert.equal((s.snapshot() as any).refreshSeconds,3);assert.equal(s.backups().length,1);
  assert.equal(s.state.nodes[0].telemetryMode,'固定值');assert.equal(s.state.nodes[0].gpuUtil,40);assert.equal(s.state.nodes[1].telemetryMode,'动态波动');
  const expected=clone(s.state.nodes);s.close();s=new DesktopService(ctx.root,()=>{},false);assert.deepEqual(s.state.nodes,expected);assert.equal(s.backups().length,1);
 }finally{s.close();ctx.close();}
});
test('SQLite restart, credentials excluded, custom brand survives reset',()=>{const ctx=setup();let s=ctx.svc;try{s.login('secret-test-password');const config=clone(s.config);config.platformName='自定义平台';const d=s.saveDraft({config,draftRevision:0});s.dispatch(cmd(s,{type:'terminateOrder',id:'ORD-CD-01'}));s.applyDraft({draftRevision:d.draftRevision});assert.equal(metrics(s.state).allocated,204);assert.ok(!s.exportText().includes('secret-test-password'));assert.ok(!s.exportText().includes('local_admin'));s.close();s=new DesktopService(ctx.root,()=>{},false);assert.equal(s.config.platformName,'自定义平台');assert.equal(metrics(s.state).allocated,204);assert.ok(s.hasAdmin());s.dispatch(cmd(s,{type:'reset'}));assert.equal(s.config.platformName,'自定义平台');assert.equal(metrics(s.state).allocated,212);}finally{s.close();ctx.close();}});
test('idempotency before CAS and stale generation rejection',()=>{const {svc:s,close}=setup();try{const input=cmd(s,{type:'terminateOrder',id:'ORD-CD-01'});s.dispatch(input);s.dispatch(input);assert.equal(s.state.bills.length,25);assert.throws(()=>s.dispatch({...input,command:{type:'fill'}}));const old=cmd(s,{type:'fill'});s.dispatch(cmd(s,{type:'reset'}));assert.throws(()=>s.dispatch(old));}finally{close();}});
test('maintenance locks business and discard preserves live progress',()=>{const {svc:s,close}=setup();try{s.dispatch(cmd(s,{type:'terminateOrder',id:'ORD-CD-01'}));s.beginMaintenance();assert.throws(()=>s.dispatch(cmd(s,{type:'reset'})));s.discard();assert.equal(metrics(s.state).allocated,204);assert.equal(s.meta.playing,true);}finally{close();}});
test('damaged import and database failure preserve state',()=>{const {svc:s,close}=setup();try{s.dispatch(cmd(s,{type:'play',playing:false}));const old=s.snapshot();assert.throws(()=>s.parsePackage(s.exportText().replace('Atlas AI','corrupted')));assert.deepEqual(s.snapshot(),old);s.db.exec('PRAGMA query_only=ON');assert.throws(()=>s.dispatch(cmd(s,{type:'terminateOrder',id:'ORD-CD-01'})));assert.deepEqual(s.snapshot(),old);s.db.exec('PRAGMA query_only=OFF');}finally{close();}});
test('scene replacement, backup restore retain local admin and monotonic revisions',()=>{const {svc:s,close}=setup();try{s.login('local-password-123');const exported=s.parsePackage(s.exportText());s.beginMaintenance();const d=clone(s.draft!);d.state!.nodes.find(n=>n.id==='NN-16')!.gpu=16;const saved=s.saveDraft(d);s.applyDraft({draftRevision:saved.draftRevision,confirm:true});assert.equal(metrics(s.state).gpu,328);assert.equal(s.backups().length,1);const rev=s.meta.runtimeRevision;s.restore(exported);assert.ok(s.meta.runtimeRevision>rev);assert.equal(metrics(s.state).gpu,320);assert.equal(s.meta.playing,false);assert.ok(s.hasAdmin());s.factory();assert.ok(s.hasAdmin());assert.equal(s.backups().length,3);}finally{close();}});
test('queries and previews never meter; stale drafts conflict',()=>{const {svc:s,close}=setup();try{const d=s.saveDraft({config:clone(s.config),draftRevision:0}),before=metrics(s.state).token;for(let i=0;i<5;i++){s.snapshot();s.preview();}assert.equal(metrics(s.state).token,before);s.advanceBy(10);assert.equal(metrics(s.state).token-before,s.state.tokenHistory!.filter(p=>!p.seeded).reduce((sum,p)=>sum+p.tokens,0));assert.ok(metrics(s.state).token>before);assert.throws(()=>s.saveDraft({...d,draftRevision:0}));}finally{close();}});
test('schema-1 upgrade makes consistent backup; newer schema is refused without reset',()=>{const ctx=setup();let s=ctx.svc;try{s.config.platformName='升级保留';s.saveDraft({config:clone(s.config),draftRevision:0});s.db.exec('DROP TABLE schema_migrations; PRAGMA user_version=1');s.close();s=new DesktopService(ctx.root,()=>{},false);assert.equal(s.config.platformName,'升级保留');assert.equal((s.db.prepare('PRAGMA user_version').get() as any).user_version,2);s.db.exec('PRAGMA user_version=99');s.close();assert.throws(()=>new DesktopService(ctx.root,()=>{},false),/更高版本/);}finally{s.close();ctx.close();}});
test('unfinished structural draft survives export and restart but cannot publish',()=>{const {svc:s,close}=setup();try{s.beginMaintenance();const d=clone(s.draft!);d.state!.orders[0].tenantId='unresolved';s.saveDraft(d);const parsed=s.parsePackage(s.exportText());assert.equal(parsed.draft.state.orders[0].tenantId,'unresolved');assert.throws(()=>s.preview());assert.equal(s.state.orders[0].tenantId,'TEN-1');}finally{close();}});

function legacyPackage(s:DesktopService){
 const p=JSON.parse(s.exportText());
 for(const state of [p.payload.state,p.payload.baseline,p.payload.draft?.state].filter(Boolean)){
  for(const policy of state.policies)policy.enabled='手动演示生效';
  for(const node of state.nodes)if(node.telemetryMode==='动态波动')node.telemetryMode='模拟波动';
 }
 for(const config of [p.payload.config,p.payload.draft?.config].filter(Boolean)){config.tenantLabel='演示租户';config.environment='离线演示环境';}
 p.appVersion='2.4.1';p.sha256=createHash('sha256').update(JSON.stringify(p.payload)).digest('hex');return p;
}

test('legacy content and backup restore migrate runtime, baseline and unfinished draft without changing credentials',()=>{
 const {svc:s,close}=setup();try{
  s.login('local-compat-password');s.beginMaintenance();const d=clone(s.draft!);d.state!.orders[0].tenantId='unresolved';s.saveDraft(d);
  const p=legacyPackage(s),text=JSON.stringify(p),before=s.snapshot();
  const payload=s.parsePackage(text);assert.deepEqual(s.snapshot(),before);
  for(const state of [payload.state,payload.baseline,payload.draft.state]){
   assert.equal(state.policies[0].enabled,'手动触发生效');assert.ok(state.nodes.some((n:any)=>n.telemetryMode==='动态波动'));assert.ok(!state.nodes.some((n:any)=>n.telemetryMode==='模拟波动'));
  }
  assert.equal(payload.config.environment,'离线环境');assert.equal(payload.draft.config.tenantLabel,'租户');assert.equal(payload.draft.state.orders[0].tenantId,'unresolved');
  writeFileSync(join(s.root,'backups','legacy.caas.json'),text);const restored=s.readBackup('legacy.caas.json');s.restore(restored);
  assert.equal(s.meta.maintenance,true);assert.equal(s.meta.playing,false);assert.ok(s.hasAdmin());assert.equal(s.draft!.state!.orders[0].tenantId,'unresolved');assert.throws(()=>s.preview());s.login('local-compat-password');
  s.discard();s.advanceBy(4);assert.ok(s.state.nodes.some(n=>n.telemetryMode==='动态波动'));
 }finally{close();}
});

test('legacy compatibility cannot bypass original checksum or current business validation',()=>{
 const {svc:s,close}=setup();try{
  const p=legacyPackage(s),before=s.snapshot();p.payload.config.environment='tampered';assert.throws(()=>s.parsePackage(JSON.stringify(p)),/SHA-256/);
  const invalid=legacyPackage(s);invalid.payload.state.instances[0].gpu=1000000;invalid.sha256=createHash('sha256').update(JSON.stringify(invalid.payload)).digest('hex');
  assert.throws(()=>s.parsePackage(JSON.stringify(invalid)));assert.deepEqual(s.snapshot(),before);
 }finally{close();}
});

test('legacy database starts with current labels while preserving brand, password and paused progress',()=>{
 const ctx=setup();let s=ctx.svc;try{
  s.login('upgrade-compat-password');s.dispatch(cmd(s,{type:'play',playing:false}));const p=legacyPackage(s);p.payload.config.platformName='客户自定义平台';
  const put=s.db.prepare('UPDATE records SET json=? WHERE key=?');for(const [key,value] of [['runtime_state',p.payload.state],['scenario_baseline',p.payload.baseline],['published_config',p.payload.config]])put.run(JSON.stringify(value),key as string);
  const now=s.state.demoNow;s.close();s=new DesktopService(ctx.root,()=>{},false);
  assert.equal(s.config.platformName,'客户自定义平台');assert.equal(s.state.policies[0].enabled,'手动触发生效');assert.equal(s.meta.playing,false);assert.equal(s.state.demoNow,now);s.login('upgrade-compat-password');
  s.close();s=new DesktopService(ctx.root,()=>{},false);assert.equal(s.state.demoNow,now);assert.equal(s.state.policies[0].enabled,'手动触发生效');
 }finally{s.close();ctx.close();}
});


test('legacy model catalog upgrades once with backup and survives restart',()=>{
 const ctx=setup();let s=ctx.svc;try{
  const old=clone(s.state);old.processedDemoEventIds=old.processedDemoEventIds.filter(id=>id!==GPU_CATALOG_EVENT);
  for(const [id,spec] of Object.entries(demoGpuModels))old.nodes.find(n=>n.id===id)!.model=spec.before;
  old.nodes.find(n=>n.id==='NN-13')!.model='用户型号';
  const update=s.db.prepare('UPDATE records SET json=? WHERE key=?');for(const key of ['runtime_state','scenario_baseline'])update.run(JSON.stringify(old),key);
  s.close();s=new DesktopService(ctx.root,()=>{},false);
  assert.equal(s.backups().length,1);assert.equal(s.state.nodes.find(n=>n.id==='NN-13')!.model,'用户型号');assert.equal(s.state.nodes.find(n=>n.id==='NN-14')!.model,'H200');assert.equal(metrics(s.state).gpu,320);
  const nodes=clone(s.state.nodes);s.close();s=new DesktopService(ctx.root,()=>{},false);assert.deepEqual(s.state.nodes,nodes);assert.equal(s.backups().length,1);
 }finally{s.close();ctx.close();}
});


test('freeform customer regions publish, export, restore and restart without changing identity',()=>{
 const ctx=setup();let s=ctx.svc;try{
  const original=metrics(s.state);s.beginMaintenance();const d=clone(s.draft!);
  ['美国','日本','新加坡','United Kingdom / 英国'].forEach((region,i)=>d.state!.tenants[i].region=region);
  const saved=s.saveDraft(d);s.applyDraft({draftRevision:saved.draftRevision,confirm:true});
  assert.deepEqual(metrics(s.state),original);const tenants=clone(s.state.tenants),payload=s.parsePackage(s.exportText());s.restore(payload);assert.deepEqual(s.state.tenants,tenants);
  s.close();s=new DesktopService(ctx.root,()=>{},false);assert.deepEqual(s.state.tenants,tenants);assert.equal(s.state.tenants[0].id,'TEN-1');
 }finally{s.close();ctx.close();}
});
