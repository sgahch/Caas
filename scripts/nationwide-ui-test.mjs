import {_electron as electron} from '@playwright/test';
import {resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {launchPackaged} from './qa-packaged.mjs';
const version=JSON.parse(readFileSync('package.json','utf8')).version,target=process.argv[2];
const evidence=resolve(`output/playwright/v${version}/nationwide${target?'-portable':''}`),profile=resolve(`.qa/nationwide-ui-${Date.now()}`);
mkdirSync(evidence,{recursive:true});const errors=[],checks=[];let app,w,aw;
const env={...process.env,CAAS_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
async function launch(){if(!target)return electron.launch({args:['.'],env,timeout:45000});const run=await launchPackaged(target,profile);return {firstWindow:async()=>run.page,evaluate:run.evaluate,waitForEvent:()=>run.context.waitForEvent('page'),close:()=>run.close()};}
const snapshot=()=>w.evaluate(()=>window.caas.snapshot());
async function section(id){await aw.locator(`[data-section="${id}"]`).click();}
try{
 app=await launch();w=await app.firstWindow();w.on('pageerror',e=>errors.push(e.message));w.on('dialog',d=>d.accept());await w.waitForSelector('#map canvas');
 const first=await snapshot();assert.equal(first.state.nodes.length,111);assert.equal(first.state.sites.filter(s=>s.kind==='center').length,13);assert.equal(new Set(first.state.nodes.filter(n=>n.deviceType==='edge').map(n=>n.edgeRegion)).size,31);
 await w.evaluate(s=>window.caas.dispatch({requestId:crypto.randomUUID(),runId:s.runId,expectedBusinessRevision:s.businessRevision,command:{type:'play',playing:false}}),first);
 for(const [width,height] of [[1920,1080],[1440,1000],[1366,768]]){
  await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});await w.waitForTimeout(300);
  assert.equal(await w.locator('#map .map-label').count(),13);assert.equal(await w.locator('#map [data-edge-node]').count(),31);
  assert.ok(await w.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const boxes=await w.locator('#map .map-label').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}));
  for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)assert.ok(Math.min(boxes[a].right,boxes[b].right)-Math.max(boxes[a].left,boxes[b].left)<=1||Math.min(boxes[a].bottom,boxes[b].bottom)-Math.max(boxes[a].top,boxes[b].top)<=1,'center labels overlap');
  await w.locator('.map-panel').screenshot({path:join(evidence,`map-${width}.png`)});
 }
 checks.push('13 center labels and 31 edge markers, non-overlapping at 1920/1440/1366');
 await w.locator('[data-view="nodes"]').first().click();await w.waitForTimeout(500);await w.screenshot({path:join(evidence,'resources.png')});await w.locator('[data-view="overview"]').first().click();
 const adminPromise=app.waitForEvent('window');await w.keyboard.press('Control+Shift+M');aw=await adminPromise;aw.on('dialog',d=>d.accept());aw.on('pageerror',e=>errors.push(e.message));await aw.locator('#password').fill('Nationwide-UI-QA-2026');await aw.locator('#login button').click();await aw.waitForSelector('.admin-shell');
 await section('workbench');await aw.locator('#maintain').click();await aw.waitForSelector('.maintenance-banner');
 await section('map');await aw.locator('[data-site="UQ"][data-key="name"]').fill('新疆区域智算中心');await aw.locator('[data-site="UQ"][data-key="longitude"]').fill('87.63');
 await section('sites');await aw.locator('#new-record').click();await aw.locator('[data-field="name"]').fill('南京新增中心');await aw.locator('[data-field="longitude"]').fill('118.8');await aw.locator('[data-field="latitude"]').fill('32.06');const addedSiteId=await aw.locator('[data-field="id"]').inputValue();await aw.locator('#am-confirm').click();
 await section('nodes');await aw.locator('[data-edit="BJ-04"]').click();await aw.locator('[data-field="cpu"]').fill('96');await aw.locator('#am-confirm').click();
 await aw.locator('#new-record').click();await aw.locator('[data-field="siteId"]').selectOption(addedSiteId);await aw.locator('[data-field="name"]').fill('南京新增节点');const addedNodeId=await aw.locator('[data-field="id"]').inputValue();await aw.locator('#am-confirm').click();
 await aw.getByRole('button',{name:'保存并应用',exact:true}).click();await w.waitForFunction(async()=>!(await window.caas.snapshot()).maintenance);
 const edited=await snapshot();assert.equal(edited.state.nodes.length,112);assert.equal(edited.state.nodes.find(n=>n.id===addedNodeId).siteId,addedSiteId);assert.equal(edited.state.nodes.find(n=>n.id==='BJ-04').cpu,96);assert.equal(edited.config.sites.UQ.name,'新疆区域智算中心');assert.equal(await w.locator('#map .map-label').count(),14);
 checks.push('admin edits national site name/location and node specs, adds a site and its node, publishes to map');
 await app.close();app=undefined;
 const dbPath=target?join(profile,'CaaSDesktop/data/caas.sqlite'):join(profile,'data/caas.sqlite');const db=new DatabaseSync(dbPath,{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');const state=JSON.parse(db.prepare("SELECT json FROM records WHERE key='runtime_state'").get().json);assert.equal(state.nodes.length,112);}finally{db.close();}
 app=await launch();w=await app.firstWindow();await w.waitForSelector('#map canvas');const restored=await snapshot();assert.equal(restored.state.nodes.length,112);assert.equal(restored.config.sites.UQ.name,'新疆区域智算中心');assert.equal(restored.state.nodes.find(n=>n.id==='BJ-04').cpu,96);assert.equal(await w.locator('#map .map-label').count(),14);
 checks.push('SQLite integrity ok and national edits/additions survive real application restart');assert.deepEqual(errors,[]);
 writeFileSync(join(evidence,'result.json'),JSON.stringify({version,profile,at:new Date().toISOString(),checks,errors},null,2));console.log('Nationwide UI passed',checks);
}catch(e){await w?.screenshot({path:join(evidence,'failure-display.png')}).catch(()=>{});await aw?.screenshot({path:join(evidence,'failure-admin.png')}).catch(()=>{});throw e;}finally{await app?.close();}
