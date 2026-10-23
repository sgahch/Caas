import {_electron as electron} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import assert from 'node:assert/strict';
mkdirSync('output/playwright/v2.4.3',{recursive:true});const errors=[],requests=[];
const env={...process.env,CAAS_TEST_PROFILE:resolve('.qa/d0-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;
let ea=await electron.launch({args:['.'],env,timeout:45000});
try{
 let w=await ea.firstWindow();w.on('pageerror',e=>errors.push(e.message));w.on('request',r=>requests.push(r.url()));await w.waitForSelector('#map canvas',{timeout:30000});
 if(!await w.locator('#play').count())await w.keyboard.press('Control+Shift+D');await w.locator('#play').click();await w.waitForTimeout(500);
 if(!await w.locator('#admin').count())await w.keyboard.press('Control+Shift+D');await w.getByRole('button',{name:'管理',exact:true}).click();let aw=await ea.waitForEvent('window');await aw.waitForSelector('#password');await aw.locator('#password').fill('CaaS-Test-2026');await aw.locator('#login button').click();await aw.waitForSelector('.admin-shell');await aw.locator('[data-section="brand"]').click();await aw.waitForSelector('#platformName');await aw.locator('#platformName').fill('CaaS SQLite 重启验证');await aw.getByRole('button',{name:'保存并应用',exact:true}).click();await w.waitForFunction(()=>document.title==='CaaS SQLite 重启验证');
 const before=await w.evaluate(()=>window.caas.snapshot());assert.equal(before.config.platformName,'CaaS SQLite 重启验证');await w.screenshot({path:'output/playwright/v2.4.3/d0-display.png'});await aw.screenshot({path:'output/playwright/v2.4.3/d0-admin.png'});await ea.close();
 ea=await electron.launch({args:['.'],env,timeout:45000});w=await ea.firstWindow();await w.waitForSelector('#map canvas');const after=await w.evaluate(()=>window.caas.snapshot());assert.equal(after.config.platformName,'CaaS SQLite 重启验证');assert.equal(after.state.demoNow,before.state.demoNow);
 const security=await w.evaluate(()=>({node:typeof window.require,bridge:Object.keys(window.caas)}));assert.equal(security.node,'undefined');let denied=false;try{await w.evaluate(()=>window.caas.adminRead());}catch{denied=true;}assert.ok(denied);
 writeFileSync('output/playwright/v2.4.3/d0-result.json',JSON.stringify({test:'D0 development Electron Windows smoke',at:new Date().toISOString(),before:{platformName:before.config.platformName,demoNow:before.state.demoNow},after:{platformName:after.config.platformName,demoNow:after.state.demoNow},security,unauthorizedAdminRejected:denied,errors,requests,offlinePhysicalTest:'待验证：当前仅本地协议，不等同断网干净机测试'},null,2));assert.deepEqual(errors,[]);console.log('D0 SQLite edit, synchronized display, restart persistence and IPC isolation passed');
}finally{await ea.close();}
