import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seed,clone,metrics,validate} from './store';
import {enrichNationwide,NATIONWIDE_EVENT} from './nationwide';
import {edgeSummary} from './edge';
import {DesktopService} from '../electron/service';

test('national inventory covers 31 mainland provincial regions without inventing leases or changing existing nodes',()=>{
 const s=seed(),before=clone(s),m=metrics(s);enrichNationwide(s);validate(s);
 assert.equal(s.sites.filter(v=>v.kind==='center').length,3);
 assert.equal(s.nodes.length,71);assert.equal(metrics(s).gpu,320);
 assert.equal(edgeSummary(s).regions,31);assert.equal(edgeSummary(s).located,31);
 assert.deepEqual(s.nodes.slice(0,before.nodes.length),before.nodes);
 for(const key of ['orders','tasks','instances','usage','tokenMeters','bills'] as const)assert.deepEqual(s[key],before[key]);
 assert.equal(metrics(s).monthlyCents,m.monthlyCents);assert.equal(metrics(s).allocated,m.allocated);
 const snapshot=clone(s);assert.equal(enrichNationwide(s),false);assert.deepEqual(s,snapshot);
 assert.deepEqual(s.sites.filter(site=>site.kind==='center').map(site=>site.id),['NN','CD','IM']);
});

test('SQLite upgrade preserves customized records, unfinished draft, admin and subsequent edits across restarts',()=>{
 const root=mkdtempSync(join(tmpdir(),'caas-nationwide-'));let svc=new DesktopService(root,()=>{},false);
 try{
  svc.login('Nationwide-upgrade-2026');const old=seed();old.sites[0].name='自定义南宁';old.nodes.find(n=>n.id==='NN-16')!.cpu=512;
  svc.beginMaintenance();const draft=clone(svc.draft!);draft.state=clone(old);
  const update=svc.db.prepare('UPDATE records SET json=? WHERE key=?');
  update.run(JSON.stringify(old),'runtime_state');update.run(JSON.stringify(old),'scenario_baseline');update.run(JSON.stringify(draft),'cms_draft');svc.close();
  svc=new DesktopService(root,()=>{},false);assert.equal(svc.state.nodes.length,71);assert.equal(svc.state.sites[0].name,'自定义南宁');assert.equal(svc.state.nodes.find(n=>n.id==='NN-16')!.cpu,512);assert.equal(svc.draft!.state!.nodes.length,71);assert.equal(svc.backups().length,1);svc.login('Nationwide-upgrade-2026');
  const edited=clone(svc.draft!);edited.state!.sites.find(v=>v.id==='NN')!.name='南宁自定义中心';edited.state!.nodes=edited.state!.nodes.filter(n=>n.id!=='EDGE-N-23');
  edited.state!.sites.push({id:'QA-SITE',name:'测试新站点',kind:'center',longitude:118.8,latitude:32.06,offsetX:0,offsetY:0,routeTo:'NN',description:'后台新增'});
  const saved=svc.saveDraft(edited);svc.applyDraft({draftRevision:saved.draftRevision,confirm:true});svc.close();
  svc=new DesktopService(root,()=>{},false);assert.equal(svc.state.nodes.length,70);assert.ok(svc.state.processedDemoEventIds.includes(NATIONWIDE_EVENT));assert.equal(svc.state.sites.find(v=>v.id==='NN')!.name,'南宁自定义中心');assert.ok(svc.state.sites.some(v=>v.id==='QA-SITE'));assert.equal(svc.backups().length,2);validate(svc.state);
  const row=svc.db.prepare("SELECT json FROM records WHERE key='runtime_state'").get() as {json:string};assert.equal(JSON.parse(row.json).nodes.length,70);
 }finally{svc.close();rmSync(root,{recursive:true,force:true});}
});
