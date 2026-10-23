import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}

// Isolate the actual, unmodified executable before its first application statement.
// No QA data-directory switch or authentication bypass is shipped in the product.
export async function launchPackaged(executable,profile,{secondary=false}={}){
 const base=resolve('.qa'),root=resolve(profile),rel=relative(base,root);
 assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Packaged QA must stay inside the workspace .qa directory');
 mkdirSync(root,{recursive:true});const inspectorPort=await freePort(),browserPort=await freePort();
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(resolve(executable),[`--inspect-brk=${inspectorPort}`,`--remote-debugging-port=${browserPort}`,'--host-resolver-rules=MAP * ~NOTFOUND'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='',ws,browser,sequence=0;const pending=new Map(),listeners=new Map();
 child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.on('error',e=>logs+=e.message);
 const event=(method,timeout=30000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(method);reject(Error('Inspector event timed out: '+method));},timeout);listeners.set(method,v=>{clearTimeout(timer);resolve(v);});});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Inspector command timed out: '+method));},30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id,method,params}));});
 try{
  let endpoint;const deadline=Date.now()+60000;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Executable exited before inspector: '+logs);try{const items=await fetch(`http://127.0.0.1:${inspectorPort}/json/list`).then(r=>r.json());endpoint=items[0]?.webSocketDebuggerUrl;if(endpoint)break;}catch{}await delay(200);}
  if(!endpoint)throw Error('Inspector unavailable: '+logs);
  ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(listeners.has(m.method)){const fn=listeners.get(m.method);listeners.delete(m.method);fn(m.params);}});
  await command('Runtime.enable');await command('Debugger.enable');const paused=event('Debugger.paused');await command('Runtime.runIfWaitingForDebugger');const frame=(await paused).callFrames[0];
  const expression=`globalThis.__caasQaElectron=require('electron');__caasQaElectron.app.setPath('appData',${JSON.stringify(root)});__caasQaElectron.app.getPath('appData')`;
  const injected=await command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression,returnByValue:true});
  if(injected.exceptionDetails)throw Error('QA isolation failed: '+JSON.stringify(injected.exceptionDetails));
  assert.equal(injected.result.value,root);await command('Debugger.resume');
  if(secondary){ws.close();if(child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),delay(15000)]);assert.equal(child.exitCode,0,'Secondary executable should activate the existing instance and exit');return {exitCode:child.exitCode};}
  const evaluate=async(fn,arg)=>{const result=await command('Runtime.evaluate',{expression:`(${fn.toString()})(globalThis.__caasQaElectron,${JSON.stringify(arg)??'undefined'})`,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Executable exited before renderer: '+logs);try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`);break;}catch{}await delay(200);}
  if(!browser)throw Error('Renderer unavailable: '+logs);
  const context=browser.contexts()[0];let page=context.pages()[0];if(!page)page=await context.waitForEvent('page');
  await page.waitForSelector('#map canvas',{timeout:30000});
  const info=await evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),data:app.getPath('userData')}));assert.equal(info.packaged,true);assert.equal(info.data,join(root,'CaaSDesktop'));
  return {child,browser,context,page,info,evaluate,logs:()=>logs,async close(){await evaluate(({app})=>{setTimeout(()=>app.quit(),50);return true;}).catch(()=>{});await browser.close().catch(()=>{});ws.close();if(child.exitCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),delay(5000)]);if(child.exitCode===null)child.kill();}}};
 }catch(e){await browser?.close().catch(()=>{});ws?.close();child.kill();throw e;}
}
