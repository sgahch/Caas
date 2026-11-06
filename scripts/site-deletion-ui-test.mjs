import {launchPackaged} from './qa-packaged.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const manifest=JSON.parse(readFileSync('package.json','utf8')),version=manifest.version;
const target=resolve(process.argv[2]||join(manifest.build.directories.output,'win-unpacked/CaaSDesktop.exe'));
const label=process.argv[3]||'centers-unpacked',profile=resolve(`.qa/${label}-${version}-${Date.now()}`);
const evidence=resolve(`output/playwright/v${version}/${label}`);mkdirSync(evidence,{recursive:true});
const report={version,target,checks:[],errors:[],dialogs:[]};let app,w,aw;
const snap=()=>w.evaluate(()=>window.caas.snapshot()),section=key=>aw.locator(`[data-section="${key}"]`).click();
const draft=()=>aw.evaluate(async()=>(await window.caas.adminRead()).draft.state);
async function start(){app=await launchPackaged(target,profile);w=app.page;w.on('pageerror',e=>report.errors.push(e.message));}
async function apply(){await aw.locator('#apply').click();await w.waitForFunction(async()=>!(await window.caas.snapshot()).maintenance);}
async function maintain(){await section('workbench');await aw.locator('#maintain').click();await aw.waitForSelector('.maintenance-banner');}
try{
 await start();const before=(await snap()).state;
 assert.deepEqual(before.sites.filter(site=>site.kind==='center').map(site=>site.id),['NN','CD','IM']);
 assert.equal(before.nodes.length,71);assert.equal(new Set(before.nodes.filter(n=>n.deviceType==='edge').map(n=>n.edgeRegion)).size,31);
 await w.screenshot({path:join(evidence,'three-centers-overview.png')});
 report.checks.push('default inventory and map retain NN/CD/IM and 31 edge regions without other centers');
 const opened=app.context.waitForEvent('page');await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items[0].click());aw=await opened;
 aw.on('pageerror',e=>report.errors.push(e.message));
 aw.on('dialog',async dialog=>{report.dialogs.push({type:dialog.type(),message:dialog.message()});await dialog.accept();});
 await aw.locator('#password').fill('Site-Deletion-QA-2026');await aw.locator('#login button').click();await aw.waitForSelector('.admin-shell');
 await section('sites');assert.equal(await aw.locator('[data-delete]').count(),0);
 await maintain();await section('sites');await aw.screenshot({path:join(evidence,'three-centers-admin.png')});
 await aw.locator('#new-record').click();await aw.locator('[data-field="name"]').fill('待删除测试中心');
 const siteId=await aw.locator('[data-field="id"]').inputValue();await aw.locator('#am-confirm').click();await aw.waitForSelector('#am-confirm',{state:'detached'});
 await section('nodes');await aw.locator('#new-record').click();await aw.locator('[data-field="siteId"]').selectOption(siteId);
 const nodeId=await aw.locator('[data-field="id"]').inputValue();await aw.locator('#am-confirm').click();await aw.waitForSelector('#am-confirm',{state:'detached'});
 await aw.locator('#wizard').click();await aw.locator('#w-business').selectOption('token');await aw.locator('#w-node').selectOption(nodeId);
 await aw.locator('#am-confirm').click();await aw.waitForSelector('#am-confirm',{state:'detached'});
 const scene=await draft(),task=scene.tasks.find(task=>task.nodeId===nodeId);assert.ok(task);
 const instanceId=task.instanceId;assert.ok(scene.tokenMeters.some(m=>m.instanceId===instanceId));
 await apply();await w.waitForFunction(async id=>(await window.caas.snapshot()).state.sites.some(site=>site.id===id),siteId);
 report.checks.push('administrator can add a site, device and linked token task/instance/meter through forms');
 await maintain();await section('map');await aw.locator('[data-site="NN"][data-key="routeTo"]').selectOption(siteId);
 await section('sites');await aw.locator(`[data-delete="${siteId}"]`).click();await aw.waitForSelector('#am-confirm');
 assert.ok((await aw.locator('#admin-modal-root').innerText()).includes('将同时清理'));
 await aw.locator('#am-cancel').click();
 assert.equal(await aw.locator(`[data-edit="${siteId}"]`).count(),1);assert.ok((await draft()).nodes.some(node=>node.id===nodeId));
 report.checks.push('site Delete uses one confirmation without reference-blocking; cancellation keeps related records');
 await aw.locator(`[data-delete="${siteId}"]`).click();await aw.locator('#am-confirm').click();
 await aw.waitForSelector(`[data-edit="${siteId}"]`,{state:'detached'});
 const cleaned=await draft();assert.equal(cleaned.nodes.some(n=>n.id===nodeId),false);
 assert.equal(cleaned.tasks.some(t=>t.id===task.id),false);assert.equal(cleaned.instances.some(v=>v.id===instanceId),false);
 assert.equal(cleaned.usage.some(u=>u.instanceId===instanceId),false);assert.equal(cleaned.tokenMeters.some(m=>m.instanceId===instanceId),false);
 assert.ok((await snap()).state.sites.some(site=>site.id===siteId),'draft must not publish early');
 report.checks.push('one Delete clears the site, devices, tasks, instances, usage and token meters within draft');
 await apply();await w.waitForFunction(async id=>!(await window.caas.snapshot()).state.sites.some(site=>site.id===id),siteId);
 let result=await snap();assert.equal(result.config.sites.NN.routeTo,'NN');
 assert.deepEqual(result.state.sites.filter(site=>site.kind==='center').map(site=>site.id),['NN','CD','IM']);
 assert.equal(result.state.nodes.length,71);for(const key of ['tenants','products'])assert.deepEqual(result.state[key],before[key]);
 assert.equal(await w.locator('#map .map-label').count(),3);
 await w.screenshot({path:join(evidence,'after-direct-site-delete.png')});report.checks.push('apply repairs map configuration/links and retains shared data and exactly three map center labels');
 await app.close();app=undefined;await start();const restored=await snap();
 assert.deepEqual(restored.state,result.state);assert.equal(restored.config.sites.NN.routeTo,'NN');
 report.checks.push('SQLite restart preserves site removal and does not regenerate removed inventory');
 assert.deepEqual(report.errors,[]);assert.equal(report.dialogs.some(d=>d.type==='alert'),false);
 report.at=new Date().toISOString();writeFileSync(join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({label,checks:report.checks,errors:report.errors}));
}catch(e){await aw?.screenshot({path:join(evidence,'failure-admin.png')}).catch(()=>{});throw e;}
finally{await app?.close();}
