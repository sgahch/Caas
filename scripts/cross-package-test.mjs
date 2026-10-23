import {launchPackaged} from './qa-packaged.mjs';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const p=JSON.parse(readFileSync('package.json','utf8'));
const installed=process.argv[2]||join(p.build.directories.output,'win-unpacked/CaaSDesktop.exe'),portable=process.argv[3]||join(p.build.directories.output,'CaaS-Portable-x64.exe');
const root=resolve(`.qa/cross-package-${p.version}-${Date.now()}`),checks=[];let ea;
try{
 for(const [first,second] of [[installed,portable],[portable,installed]]){
  ea=await launchPackaged(first,root);let before=await ea.page.evaluate(()=>window.caas.snapshot());
  if(before.playing)await ea.page.evaluate(s=>window.caas.dispatch({requestId:crypto.randomUUID(),runId:s.runId,expectedBusinessRevision:s.businessRevision,command:{type:'play',playing:false}}),before);
  before=await ea.page.evaluate(()=>window.caas.snapshot());await launchPackaged(second,root,{secondary:true});
  const after=await ea.page.evaluate(()=>window.caas.snapshot());assert.equal(after.runId,before.runId);assert.equal(after.state.demoNow,before.state.demoNow);assert.equal(await ea.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  checks.push({first,second,sharedData:ea.info.data,singleInstance:true,pausedClockPreserved:true});await ea.close();ea=undefined;
 }
 const report={version:p.version,at:new Date().toISOString(),checks};mkdirSync(`output/playwright/v${p.version}`,{recursive:true});writeFileSync(`output/playwright/v${p.version}/cross-package.json`,JSON.stringify(report,null,2));console.log('Cross-package single-instance verification passed');
}finally{await ea?.close();}
