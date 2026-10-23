import {test} from 'node:test';import assert from 'node:assert/strict';
import {seed,metrics,tick,taskAction,migrate,validate} from './store';
import {modelUsage} from './model-usage';import {defaultTokenSimulation} from './token-engine';
test('model ranking conserves all input/output counters, with domestic and overseas routes',()=>{
 const s=seed(),today=modelUsage(s),total=modelUsage(s,'total');assert.equal(today.length,8);assert.equal(today.reduce((sum,r)=>sum+r.output,0),metrics(s).token);assert.equal(total.reduce((sum,r)=>sum+r.output,0),metrics(s).totalToken);assert.equal(total.reduce((sum,r)=>sum+r.total,0),metrics(s).totalToken*1.25);assert.ok(Math.abs(today.reduce((sum,r)=>sum+r.share,0)-100)<1e-10);assert.ok(today.some(r=>r.provider==='OpenAI'));assert.ok(today.some(r=>r.provider==='DeepSeek'));assert.ok(today.every((r,i)=>!i||today[i-1].total>=r.total));
});
test('ranking grows by actual minted counters, and paused output has zero rate',()=>{
 const s=seed(),before=modelUsage(s).reduce((sum,r)=>sum+r.total,0),settings=defaultTokenSimulation();tick(s,12);assert.ok(modelUsage(s).reduce((sum,r)=>sum+r.total,0)>before);
 assert.ok(modelUsage(s,'day',settings,true).some(r=>r.rate>0));assert.ok(modelUsage(s,'day',settings,false).every(r=>r.rate===0));
 const m=s.tokenMeters.find(m=>m.nodeId==='NN-11')!,name=m.modelName;taskAction(s,'TASK-TOKEN-NN-11','暂停');taskAction(s,'TASK-TOKEN-NN-11','恢复');assert.equal(s.tokenMeters.filter(m=>m.instanceId==='INS-TOKEN-NN-11').at(-1)!.modelName,name);validate(s);
});
test('moving an instance preserves the model route and historical attribution',()=>{
 const s=seed(),before=modelUsage(s,'total').map(r=>[r.id,r.total]),route=s.tokenMeters.find(m=>m.instanceId==='INS-TOKEN-CD-09')!.modelName;migrate(s,'INS-TOKEN-CD-09','CD-10');assert.equal(s.tokenMeters.at(-1)!.modelName,route);assert.deepEqual(modelUsage(s,'total').map(r=>[r.id,r.total]),before);validate(s);
});
