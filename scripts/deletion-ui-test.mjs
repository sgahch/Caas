import {launchPackaged} from './qa-packaged.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const manifest=JSON.parse(readFileSync('package.json','utf8'));
const target=resolve(process.argv[2]||join(manifest.build.directories.output,'win-unpacked/CaaSDesktop.exe'));
const label=process.argv[3]||'deletion-unpacked',profile=resolve(`.qa/${label}-${manifest.version}-${Date.now()}`);
const evidence=resolve(`output/playwright/v${manifest.version}/${label}`);mkdirSync(evidence,{recursive:true});
const report={version:manifest.version,target,profile,checks:[],errors:[],dialogs:[]};
let app,w,aw;
const snapshot=()=>w.evaluate(()=>window.caas.snapshot());
const section=key=>aw.locator(`[data-section="${key}"]`).click();
const draft=()=>aw.evaluate(async()=>(await window.caas.adminRead()).draft.state);
async function start(){
 app=await launchPackaged(target,profile);w=app.page;w.on('pageerror',e=>report.errors.push(e.message));
 assert.equal((await snapshot()).appVersion,manifest.version);
}
try{
 await start();const before=(await snapshot()).state;
 const opened=app.context.waitForEvent('page');await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items[0].click());aw=await opened;
 aw.on('pageerror',e=>report.errors.push(e.message));
 aw.on('dialog',async d=>{report.dialogs.push({type:d.type(),message:d.message()});await d.accept();});
 await aw.locator('#password').fill('Deletion-Packaged-QA-2026');await aw.locator('#login button').click();await aw.waitForSelector('.admin-shell');
 await section('nodes');assert.equal(await aw.locator('[data-delete]').count(),0);assert.equal(await aw.locator('[data-bundle]').count(),0);
 await section('workbench');await aw.locator('#maintain').click();await aw.waitForSelector('.maintenance-banner');await section('nodes');
 report.checks.push('deletion actions available only in maintenance mode');

 await aw.locator('[data-delete="NN-02"]').click();await aw.waitForSelector('#am-confirm');
 assert.ok((await aw.locator('#admin-modal-root').innerText()).includes('租赁订单（1 条）'));
 await aw.locator('#am-cancel').click();
 assert.equal(await aw.locator('[data-edit="NN-02"]').count(),1);
 report.checks.push('referenced device Delete directly offers cascade confirmation; cancel preserves all data');

 await aw.locator('[data-delete="NN-16"]').click();await aw.locator('#am-cancel').click();
 assert.equal(await aw.locator('[data-edit="NN-16"]').count(),1);
 await aw.locator('[data-delete="NN-16"]').click();await aw.locator('#am-confirm').click();await aw.waitForSelector('[data-edit="NN-16"]',{state:'detached'});
 report.checks.push('idle device deletes directly; cancelling the confirmation preserves it');

 await aw.locator('[data-delete="NN-02"]').click();await aw.waitForSelector('#am-confirm');
 let text=await aw.locator('#admin-modal-root').innerText();
 for(const id of ['NN-02','ORD-NN-02','TASK-NN-02','INS-NN-02','USE-INS-NN-02-1'])assert.ok(text.includes(id),id+' missing from confirmation');
 assert.ok(text.includes('其他设备、机房、租户及产品保留'));
 await aw.screenshot({path:join(evidence,'device-deletion-scope.png')});
 await aw.locator('#am-cancel').click();assert.equal(await aw.locator('[data-edit="NN-02"]').count(),1);
 await aw.locator('[data-delete="NN-02"]').click();await aw.locator('#am-confirm').click();
 await aw.waitForSelector('[data-edit="NN-02"]',{state:'detached'});
 let pending=await draft();assert.ok(!pending.orders.some(r=>r.id==='ORD-NN-02'));assert.ok(!pending.instances.some(r=>r.id==='INS-NN-02'));
 assert.ok((await snapshot()).state.nodes.some(n=>n.id==='NN-02'),'draft deletion must not publish early');
 report.checks.push('device deletion previews complete IDs, supports cancel and removes device/business only in draft');

 await section('orders');await aw.locator('[data-delete="ORD-NN-01"]').click();await aw.waitForSelector('#am-confirm');
 assert.ok((await aw.locator('#admin-modal-root').innerText()).includes('设备、机房、租户及产品保留'));
 await aw.locator('#am-confirm').click();await aw.waitForSelector('[data-edit="ORD-NN-01"]',{state:'detached'});
 await section('nodes');assert.equal(await aw.locator('[data-edit="NN-01"]').count(),1);
 await aw.locator('[data-delete="NN-01"]').click();await aw.locator('#am-confirm').click();await aw.waitForSelector('[data-edit="NN-01"]',{state:'detached'});
 report.checks.push('business bundle retains the node; the now unreferenced node can then be deleted');

 for(const kind of ['usage','tokenMeters','bills','alerts','logs']){
  await section(kind);
  if(!(await draft())[kind].length){
   await aw.locator('#new-record').click();await aw.locator('#am-confirm').click();await aw.waitForSelector('#am-confirm',{state:'detached'});
  }
  const prior=await draft(),id=prior[kind][0].id;
  await aw.locator(`[data-delete="${id}"]`).click();await aw.locator('#am-cancel').click();
  assert.deepEqual(await draft(),prior);
  await aw.locator(`[data-delete="${id}"]`).click();await aw.locator('#am-confirm').click();await aw.waitForSelector(`[data-edit="${id}"]`,{state:'detached'});
  const next=await draft();assert.equal(next[kind].some(row=>row.id===id),false);
  for(const key of ['orders','tasks','instances','nodes','tenants','products'])assert.deepEqual(next[key],prior[key]);
  if(kind==='usage')assert.equal(next.tokenMeters.some(row=>row.usageRecordId===id),false);
  report.checks.push(kind+' direct deletion supports cancel and retains business owners');
 }
 for(const kind of ['tenants','products','tasks','instances']){
  if(kind==='tenants'){
   await section('codes');await aw.locator('#code-type').selectOption('tenants');
   await aw.locator('[data-code="TEN-1"]').fill('QA-'+ 'C'.repeat(157));
  }
  await section(kind);const prior=await draft(),id=prior[kind][0].id;
  await aw.locator(`[data-delete="${id}"]`).click();await aw.waitForSelector('#am-confirm');
  const scope=await aw.locator('#admin-modal-root').innerText();assert.ok(scope.includes(id));
  if(kind==='tenants'){
   assert.ok(scope.includes('解除设备关联'));
   await aw.setViewportSize({width:900,height:640});
   const layout=await aw.locator('.modal-body').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
   assert.ok(layout.scroll<=layout.width+1,'Long display codes must wrap inside the confirmation');
   await aw.screenshot({path:join(evidence,'tenant-deletion-scope.png')});
   await aw.setViewportSize({width:1264,height:935});
  }
  await aw.locator('#am-cancel').click();assert.deepEqual(await draft(),prior);
  await aw.locator(`[data-delete="${id}"]`).click();await aw.locator('#am-confirm').click();await aw.waitForSelector(`[data-edit="${id}"]`,{state:'detached'});
  const next=await draft();assert.equal(next[kind].some(row=>row.id===id),false);
  assert.deepEqual(next.nodes.map(node=>node.id),prior.nodes.map(node=>node.id));
  if(kind==='tenants'){
   assert.equal(next.nodes.some(node=>node.edgeTenantId===id),false);
   for(const key of ['orders','tasks','instances','usage','tokenMeters','bills'])assert.equal(next[key].some(row=>row.tenantId===id),false);
  }
  if(kind==='products')assert.equal(next.orders.some(row=>row.productId===id),false);
  report.checks.push(kind+' direct deletion clears associated business while retaining hardware; cancel is nonmutating');
 }
 const expected=await draft();
 await aw.getByRole('button',{name:'保存并应用',exact:true}).click();
 await w.waitForFunction(async()=>{const s=await window.caas.snapshot();return !s.maintenance&&!s.state.nodes.some(n=>['NN-01','NN-02','NN-16'].includes(n.id));});
 const saved=(await snapshot()).state;
 assert.deepEqual(saved,expected);assert.equal(saved.nodes.length,before.nodes.length-3);
 assert.deepEqual(saved.sites,before.sites);
 assert.deepEqual(saved.nodes.map(n=>n.id),before.nodes.filter(n=>!['NN-01','NN-02','NN-16'].includes(n.id)).map(n=>n.id));
 await w.screenshot({path:join(evidence,'published-device-deletion.png')});
 await app.close();app=undefined;await start();const restored=(await snapshot()).state;
 assert.deepEqual(restored,saved);report.checks.push('publish persists to SQLite and restart retains deletions without regenerating inventory');
 assert.deepEqual(report.errors,[]);assert.equal(report.dialogs.some(dialog=>dialog.type==='alert'),false);report.at=new Date().toISOString();writeFileSync(join(evidence,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({version:manifest.version,label,checks:report.checks,errors:report.errors}));
}catch(e){await aw?.screenshot({path:join(evidence,'failure-admin.png')}).catch(()=>{});throw e;}
finally{await app?.close();}
