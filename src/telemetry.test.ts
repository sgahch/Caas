import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,tick,metrics,validate,clone} from './store';
import {telemetryFields,initializeTelemetry,regenerateTelemetry,nodeLoad,telemetryValue} from './telemetry';

test('dynamic telemetry is diverse, bounded, repeatable and preserves capacity, billing and token conservation',()=>{
 const s=seed(),initial=metrics(s),bills=clone(s.bills),offline=clone(s.nodes.find(n=>n.id==='CD-08')!);
 const peers=s.nodes.filter(n=>/^CD-0[1-4]$/.test(n.id));
 assert.ok(peers.every(n=>n.telemetryProfile.intervalSeconds===2));
 assert.ok(new Set(peers.map(n=>n.gpuUtil)).size>=3);
 assert.ok(new Set(peers[0].samples.map((p:any)=>p.value)).size>5);
 const copy=clone(s),before=peers.map(n=>n.gpuUtil);
 for(let i=0;i<120;i++){
  tick(s,4);
  for(const n of s.nodes.filter(n=>n.status!=='离线'))for(const key of telemetryFields){const range=n.telemetryProfile.ranges[key];assert.ok(n[key]>=range.min&&n[key]<=range.max,n.id+key);}
 }
 tick(copy,480);
 assert.deepEqual(copy.nodes.map(n=>n.gpuUtil),s.nodes.map(n=>n.gpuUtil));
 assert.notDeepEqual(peers.map(n=>n.gpuUtil),before);
 assert.deepEqual(s.nodes.find(n=>n.id==='CD-08'),offline);
 assert.equal(metrics(s).gpu,initial.gpu);assert.equal(metrics(s).allocated,initial.allocated);assert.deepEqual(s.bills,bills);
 assert.equal(metrics(s).token,initial.token+8800*480);
 assert.ok(s.instances.find(v=>v.id==='INS-TOKEN-CD-09')!.calls.length>1);
 validate(s);
});

test('fixed telemetry survives ticks and invalid ranges are rejected before publishing',()=>{
 const s=seed(),n=s.nodes.find(n=>n.id==='CD-01')!;n.telemetryMode='固定值';n.gpuUtil=42.5;
 regenerateTelemetry(n,s.demoNow,nodeLoad(n,s.instances));const frozen=telemetryFields.map(k=>n[k]);tick(s,20);
 assert.deepEqual(telemetryFields.map(k=>n[k]),frozen);assert.equal(n.samples.at(-1).value,42.5);
 n.telemetryProfile.ranges.gpuUtil.min=101;assert.throws(()=>validate(s),/范围/);
});

test('legacy default telemetry upgrades while deliberately customized fixed values remain fixed',()=>{
 const s=seed();for(const n of s.nodes){delete n.telemetryProfile;n.telemetryMode='固定值';Object.assign(n,{gpuUtil:n.gpu?66:0,cpuUtil:42,vramUtil:n.gpu?58:0,memoryUtil:46,storageUtil:32,temperature:n.deviceType==='edge'?39:53});n.samples=Array.from({length:60},(_,i)=>({time:s.demoNow-(59-i)*60000,value:n.gpuUtil,cpuValue:42,vramValue:n.vramUtil,memoryValue:46,storageValue:32}));}
 s.nodes[0].gpuUtil=40;s.nodes[0].samples.forEach((p:any)=>p.value=40);
 initializeTelemetry(s.nodes,s.instances,s.demoNow);
 assert.equal(s.nodes[0].telemetryMode,'固定值');assert.equal(s.nodes[0].gpuUtil,40);
 assert.equal(s.nodes[1].telemetryMode,'动态波动');validate(s);
});


test('resource traces have frequent uneven reversals without changing on repeated reads',()=>{
 const s=seed(),n=s.nodes.find(n=>n.id==='CD-01')!,load=nodeLoad(n,s.instances);
 const values=Array.from({length:120},(_,i)=>telemetryValue(n,'gpuUtil',s.demoNow+i*2000,load));
 const deltas=values.slice(1).map((v,i)=>v-values[i]);
 assert.ok(deltas.filter((v,i)=>i&&v*deltas[i-1]<0).length>45);
 assert.ok(new Set(deltas.map(v=>v.toFixed(1))).size>40);
 assert.equal(telemetryValue(n,'gpuUtil',s.demoNow+7000,load),telemetryValue(n,'gpuUtil',s.demoNow+7000,load));
});
