import {launchPackaged} from './qa-packaged.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const manifest=JSON.parse(readFileSync('package.json','utf8'));
const target=resolve(process.argv[2]||join(manifest.build.directories.output,'win-unpacked/CaaSDesktop.exe'));
const label=process.argv[3]||'unpacked',profile=resolve(`.qa/release-${manifest.version}-${label}-${Date.now()}`);
const evidence=resolve(`output/playwright/v${manifest.version}/${label}`);mkdirSync(evidence,{recursive:true});
const report={target,version:manifest.version,at:new Date().toISOString(),checks:[],errors:[],network:[],profile,physicalOffline:'本机开发环境、DNS阻断；物理断网干净机未执行'};
let ea,w,aw;
const snap=()=>w.evaluate(()=>window.caas.snapshot());
const dispatch=async command=>{const sn=await snap();return w.evaluate(input=>window.caas.dispatch(input),{requestId:crypto.randomUUID(),runId:sn.runId,expectedBusinessRevision:sn.businessRevision,command});};
async function start(){ea=await launchPackaged(target,profile);w=ea.page;w.on('pageerror',e=>report.errors.push(e.message));w.on('request',r=>{if(/^https?:/.test(r.url()))report.network.push(r.url());});w.on('dialog',d=>d.accept());assert.equal((await snap()).appVersion,manifest.version);assert.equal(ea.info.version,manifest.version);}
async function openAdmin(password){const opened=ea.context.waitForEvent('page');await ea.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items[0].click());aw=await opened;aw.on('dialog',d=>d.accept());aw.on('pageerror',e=>report.errors.push(e.message));await aw.locator('#password').fill(password);await aw.locator('#login button').click();await aw.waitForSelector('.admin-shell');}
try{
 await start();report.info=ea.info;
 const security=await ea.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});assert.deepEqual(security,{sandbox:true,contextIsolation:true,nodeIntegration:false});
 await assert.rejects(()=>w.evaluate(()=>window.caas.adminRead()));await dispatch({type:'play',playing:false});report.checks.push('actual packaged executable, bundled map, current version and restricted IPC');
 await openAdmin('CaaS-Release-QA-2026');const file=join(profile,'export.caas.json');
 await ea.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
 await aw.evaluate(()=>window.caas.exportPackage());const original=JSON.parse(readFileSync(file,'utf8'));assert.ok(!JSON.stringify(original).includes('CaaS-Release-QA-2026'));
 await aw.locator('[data-section="brand"]').click();await aw.locator('#platformName').fill('CaaS 交付保存验证');await aw.getByRole('button',{name:'保存并应用',exact:true}).click();await w.waitForFunction(()=>document.title==='CaaS 交付保存验证');report.checks.push('administrator setup, configuration publish, SQLite and display synchronization');
 await dispatch({type:'reset'});await dispatch({type:'task',id:'TASK-DEMO-LEASE',action:'调度'});assert.equal((await snap()).state.orders.find(o=>o.id==='ORD-DEMO-LEASE').nodeId,'NN-11');
 await dispatch({type:'reset'});await dispatch({type:'task',id:'TASK-DEMO-EDGE',action:'调度'});assert.equal((await snap()).state.tasks.find(t=>t.id==='TASK-DEMO-EDGE').nodeId,'IM-08');
 await dispatch({type:'reset'});await dispatch({type:'terminateOrder',id:'ORD-CD-01'});assert.equal((await snap()).state.bills.at(-1).amountCents,836000);report.checks.push('rental preemption, edge fallback and exact final bill in packaged runtime');
 for(const key of ['overview','queue','policies','instances','nodes','orders','billing','alerts']){await w.locator(`[data-view="${key}"]`).click();await w.waitForSelector('tbody tr');await w.screenshot({path:join(evidence,key+'.png')});}
 await w.locator('[data-view="rental"]').first().click();assert.equal(await w.locator('.rental-kpi').count(),4);assert.equal(await w.locator('[data-viz]').count(),8);assert.equal(await w.locator('.product-card').count(),4);await w.screenshot({path:join(evidence,'rental.png')});await w.locator('[data-rental-period="year"]').click();assert.equal(await w.locator('[data-rental-period="year"]').getAttribute('aria-pressed'),'true');await w.locator('[data-view="overview"]').first().click();assert.equal(await w.locator('#model-rank-rows tr').count(),8);await w.locator('.model-ranking').screenshot({path:join(evidence,'model-ranking.png')});report.checks.push('packaged rental period analytics, eight rental charts, product catalog and model usage ranking');
 await w.locator('[data-view="billing"]').click();await w.locator('[data-tab="usage"]').click();assert.equal(await w.locator('th').count(),9);report.checks.push('nine packaged views and usage table render');
 await launchPackaged(target,profile,{secondary:true});assert.equal(await ea.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),2);report.checks.push('duplicate executable activates existing display/admin pair');
 const before=await snap();await ea.close();await start();let state=await snap();assert.equal(state.config.platformName,before.config.platformName);assert.equal(state.state.demoNow,before.state.demoNow);assert.equal(state.state.bills.length,before.state.bills.length);report.checks.push('restart preserves configuration, business state and paused clock');
 await openAdmin('CaaS-Release-QA-2026');await ea.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);const preview=await aw.evaluate(()=>window.caas.chooseImport());await aw.evaluate(id=>window.caas.confirmImport(id),preview.id);assert.equal((await snap()).config.platformName,original.payload.config.platformName);report.checks.push('native IPC export, preview and restore without transferring credentials');
 const legacyFile=process.env.CAAS_LEGACY_PACKAGE;
 if(legacyFile){
  await ea.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(legacyFile));const legacyPreview=await aw.evaluate(()=>window.caas.chooseImport());await aw.evaluate(id=>window.caas.confirmImport(id),legacyPreview.id);state=await snap();assert.equal(state.state.policies[0].enabled,'手动触发生效');assert.equal(state.playing,false);report.checks.push('actual legacy content package imports through packaged file IPC');
  await ea.close();
  const legacy=JSON.parse(readFileSync(legacyFile,'utf8')).payload;legacy.config.platformName='旧库客户平台';const db=new DatabaseSync(join(profile,'CaaSDesktop/data/caas.sqlite'));const put=db.prepare('UPDATE records SET json=? WHERE key=?');for(const [key,value] of [['runtime_state',legacy.state],['scenario_baseline',legacy.baseline],['published_config',legacy.config],['cms_draft',null]])put.run(JSON.stringify(value),key);db.close();
  await start();state=await snap();assert.equal(state.config.platformName,'旧库客户平台');assert.equal(state.state.policies[0].enabled,'手动触发生效');assert.equal(state.playing,false);await openAdmin('CaaS-Release-QA-2026');report.checks.push('actual legacy SQLite upgrades while preserving brand, pause and local password');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[]);writeFileSync(join(evidence,'result.json'),JSON.stringify(report,null,2));console.log('Packaged verification passed:',label,report.checks);
}catch(e){report.failure=e.stack||e.message;await w?.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});writeFileSync(join(evidence,'failure.json'),JSON.stringify(report,null,2));throw e;}finally{await ea?.close();}
