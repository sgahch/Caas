import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,clone,validate,metrics} from './store';
import {defaultConfig,validateConfig} from './config';
import {bundleIds,removeScenarioBundle,cleanupRemovedConfig} from './scenario';
import {CORE_CENTERS_EVENT,retainCoreCenters} from './center-policy';
import {DesktopService} from '../electron/service';

const legacy=()=>JSON.parse(readFileSync(new URL('../resources/standard.caas.json',import.meta.url),'utf8')).payload;
const centers=(s:ReturnType<typeof seed>)=>s.sites.filter(site=>site.kind==='center').map(site=>site.id);

test('fresh inventory has only the three requested centers and retains all 31 edge regions',()=>{
 const s=seed(true);validate(s);assert.deepEqual(centers(s),['NN','CD','IM']);
 assert.equal(s.nodes.length,71);assert.equal(metrics(s).gpu,320);
 assert.equal(new Set(s.nodes.filter(node=>node.deviceType==='edge').map(node=>node.edgeRegion)).size,31);
});

test('site deletion clears devices, business and history, repairs map routes and preserves shared records',()=>{
 const s=seed(true),before=clone(s),config=defaultConfig();
 config.sites.NN={...s.sites.find(site=>site.id==='NN')!} as any;
 config.sites.IM={...s.sites.find(site=>site.id==='IM')!} as any;
 config.sites.IM.routeTo='NN';
 config.presentation={sites:{NN:{name:'南宁自定义'}},nodes:{'NN-01':{displayCode:'设备-01'}}};
 const sets=bundleIds(s,'sites','NN');assert.ok(sets.nodes.has('NN-01'));assert.ok(sets.orders.has('ORD-NN-01'));
 removeScenarioBundle(s,sets);cleanupRemovedConfig(config,s);validate(s);validateConfig(config,s);
 assert.equal(s.nodes.some(node=>node.siteId==='NN'),false);assert.equal(s.orders.some(order=>order.id==='ORD-NN-01'),false);
 assert.ok(s.nodes.some(node=>node.id==='CD-01'));assert.ok(s.sites.some(site=>site.id==='IM'));
 assert.equal(s.sites.some(site=>site.routeTo==='NN'),false);assert.equal(config.sites.IM.routeTo,'CD');
 assert.equal(config.sites.NN,undefined);assert.deepEqual(config.presentation.nodes,{});
 for(const key of ['tenants','products'] as const)assert.deepEqual(s[key],before[key]);
});

test('edge group can be deleted directly with its devices and task preferences',()=>{
 const s=seed(true);removeScenarioBundle(s,bundleIds(s,'sites','EDGE'));validate(s);
 assert.equal(s.nodes.some(node=>node.deviceType==='edge'),false);assert.deepEqual(centers(s),['NN','CD','IM']);
 assert.ok(s.orders.some(order=>order.id==='ORD-NN-01'));
});

test('the last center is protected and failed site deletion rolls back completely',()=>{
 const s=seed(true);removeScenarioBundle(s,bundleIds(s,'sites','NN'));removeScenarioBundle(s,bundleIds(s,'sites','CD'));
 const before=clone(s);assert.throws(()=>removeScenarioBundle(s,bundleIds(s,'sites','IM')),/至少保留一个中心机房/);
 assert.deepEqual(s,before);
});

test('old nationwide data reduces once, including all removed site map overrides',()=>{
 const old=legacy();assert.equal(old.state.sites.filter((site:any)=>site.kind==='center').length,13);
 const s=old.state,config=old.config;
 config.sites.BJ={...s.sites.find((site:any)=>site.id==='BJ')};config.sites.NN={...s.sites.find((site:any)=>site.id==='NN'),routeTo:'BJ'};
 retainCoreCenters(s);cleanupRemovedConfig(config,s);validate(s);validateConfig(config,s);
 assert.deepEqual(centers(s),['NN','CD','IM']);assert.equal(s.nodes.length,71);assert.equal(config.sites.BJ,undefined);
 assert.equal(config.sites.NN.routeTo,'NN');assert.ok(s.processedDemoEventIds.includes(CORE_CENTERS_EVENT));
 const before=clone(s);assert.equal(retainCoreCenters(s),false);assert.deepEqual(s,before);
});

test('old SQLite runtime, baseline and unfinished draft upgrade with backup and retain local login',()=>{
 const root=mkdtempSync(join(tmpdir(),'caas-sites-'));let service=new DesktopService(root,()=>{},false);
 try{
  service.login('Site-Upgrade-2026');service.beginMaintenance();const old=legacy(),draft=clone(service.draft!);
  draft.state=clone(old.state);draft.state!.nodes[0].gpu=-1;draft.state!.sites[0].name='草稿南宁名称';
  draft.config=clone(old.config);old.config.sites.NN={...old.state.sites[0],routeTo:'BJ'};
  draft.config.sites.BJ={...old.state.sites.find((site:any)=>site.id==='BJ')};
  const put=service.db.prepare('UPDATE records SET json=? WHERE key=?');
  for(const [key,value] of [['runtime_state',old.state],['scenario_baseline',old.baseline],['published_config',old.config],['cms_draft',draft]])put.run(JSON.stringify(value),key as string);
  service.close();service=new DesktopService(root,()=>{},false);service.login('Site-Upgrade-2026');
  assert.deepEqual(centers(service.state),['NN','CD','IM']);assert.deepEqual(centers(service.baseline),['NN','CD','IM']);
  assert.deepEqual(centers(service.draft!.state!),['NN','CD','IM']);assert.equal(service.draft!.state!.nodes[0].gpu,-1);
  assert.equal(service.draft!.state!.sites[0].name,'草稿南宁名称');assert.equal(service.draft!.config.sites.BJ,undefined);
  assert.equal(service.config.sites.NN.routeTo,'NN');assert.equal(service.backups().length,1);
  const backup=JSON.parse(readFileSync(join(root,'backups',service.backups()[0]),'utf8'));
  assert.equal(backup.payload.state.sites.filter((site:any)=>site.kind==='center').length,13);
  service.draft!.state!.nodes[0].gpu=8;
  const saved=service.saveDraft(clone(service.draft!));service.applyDraft({draftRevision:saved.draftRevision,confirm:true});
  service.close();service=new DesktopService(root,()=>{},false);service.login('Site-Upgrade-2026');
  assert.deepEqual(centers(service.state),['NN','CD','IM']);assert.equal(service.state.sites[0].name,'草稿南宁名称');
  assert.equal(service.backups().length,2);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});

test('importing an old content package applies the same center policy before validating map settings',()=>{
 const root=mkdtempSync(join(tmpdir(),'caas-site-import-')),service=new DesktopService(root,()=>{},false);
 try{
  const parsed=service.parsePackage(readFileSync(new URL('../resources/standard.caas.json',import.meta.url),'utf8'));
  service.restore(parsed);assert.deepEqual(centers(service.state),['NN','CD','IM']);validate(service.state);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});
