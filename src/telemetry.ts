import type {Row} from './store';
import {irregularSignal} from './signal-noise';

export const telemetryFields = ['gpuUtil','cpuUtil','vramUtil','memoryUtil','storageUtil','temperature'] as const;
export type TelemetryField = typeof telemetryFields[number];
export type TelemetryRange = {base:number;min:number;max:number};
export type TelemetryProfile = {intervalSeconds:number;referenceLoad:number;ranges:Record<TelemetryField,TelemetryRange>};
const sampleFields:Record<TelemetryField,string>={gpuUtil:'value',cpuUtil:'cpuValue',vramUtil:'vramValue',memoryUtil:'memoryValue',storageUtil:'storageValue',temperature:'temperature'};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));

export function telemetryHash(text:string){
 let n=2166136261;
 for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);
 n^=n>>>16;n=Math.imul(n,0x45d9f3b);n^=n>>>16;
 return n>>>0;
}
export function nodeLoad(node:Row,instances:Row[]){
 const held=instances.filter(v=>v.nodeId===node.id&&v.allocationHeld);
 const capacity=node.gpu||node.cpu||1,key=node.gpu?'gpu':'cpu';
 return clamp(held.reduce((sum,v)=>sum+(v[key]||0),0)/capacity,0,1);
}
export function defaultTelemetryProfile(node:Row,load=0.7,varied=false):TelemetryProfile{
 const ranges={} as TelemetryProfile['ranges'];
 const spans:Record<TelemetryField,number>={gpuUtil:14,cpuUtil:12,vramUtil:8,memoryUtil:7,storageUtil:2,temperature:5};
 for(const key of telemetryFields){
  const offset=telemetryHash(node.id+':'+key)%17-8;
  const centers:Record<TelemetryField,number>={gpuUtil:18+load*53,cpuUtil:15+load*48,vramUtil:16+load*51,memoryUtil:35+load*22,storageUtil:25+(telemetryHash(node.id)%29),temperature:(node.deviceType==='edge'?33:39)+load*19};
  const base=varied?Math.round(centers[key]+offset*.65):Number(node[key]);
  const max=key==='temperature'?95:100;
  ranges[key]={base:clamp(base,0,max),min:clamp(base-spans[key],0,max),max:clamp(base+spans[key],0,max)};
  if(!node.gpu&&(key==='gpuUtil'||key==='vramUtil'))ranges[key]={base:0,min:0,max:0};
 }
 return {intervalSeconds:2,referenceLoad:load,ranges};
}
export function validateTelemetryProfile(node:Row){
 const p=node.telemetryProfile as TelemetryProfile|undefined;if(!p)return;
 if(!Number.isInteger(p.intervalSeconds)||p.intervalSeconds<2||p.intervalSeconds>60||!Number.isFinite(p.referenceLoad)||p.referenceLoad<0||p.referenceLoad>1)throw Error(node.id+' 遥测更新间隔或负载基准无效');
 for(const key of telemetryFields){
  const r=p.ranges?.[key],limit=key==='temperature'?95:100;
  if(!r||![r.min,r.base,r.max].every(Number.isFinite)||r.min<0||r.min>r.base||r.base>r.max||r.max>limit)throw Error(node.id+' '+key+' 范围须满足 0 ≤ 下限 ≤ 基准 ≤ 上限 ≤ '+limit);
  if(!node.gpu&&(key==='gpuUtil'||key==='vramUtil')&&r.max!==0)throw Error(node.id+' 无GPU设备不能配置GPU遥测');
 }
}
export function telemetryValue(node:Row,key:TelemetryField,at:number,load:number){
 const p=node.telemetryProfile as TelemetryProfile,r=p.ranges[key];
 const time=Math.floor(at/(p.intervalSeconds*1000))*p.intervalSeconds;
 // Shared bursts remain visible in aggregate curves; site and node noise add uneven detail.
 const pace=key==='storageUtil'?7:key==='memoryUtil'?2:1;
 const wave=.58*irregularSignal(key,time/pace)+.24*irregularSignal(node.siteId+':'+key,time/pace)+.18*irregularSignal(node.id+':'+key,time/pace);
 const sensitivity=key==='storageUtil'?0:key==='temperature'?5:12;
 const center=clamp(r.base+(load-p.referenceLoad)*sensitivity,r.min,r.max);
 const span=wave>=0?r.max-center:center-r.min;
 return Math.round(clamp(center+wave*span,r.min,r.max)*10)/10;
}
export function telemetrySample(node:Row,at:number,load:number){
 const sample:Record<string,number>={time:at};
 for(const key of telemetryFields)sample[sampleFields[key]]=node.telemetryMode==='动态波动'?telemetryValue(node,key,at,load):node[key];
 return sample;
}
export function regenerateTelemetry(node:Row,at:number,load:number){
 validateTelemetryProfile(node);
 node.samples=Array.from({length:60},(_,i)=>telemetrySample(node,at-(59-i)*60000,load));
 for(const key of telemetryFields)node[key]=node.samples.at(-1)[sampleFields[key]];
}
export function initializeTelemetry(nodes:Row[],instances:Row[],at:number){
 let changed=false;
 for(const node of nodes){
  if(node.telemetryProfile||!Array.isArray(node.samples)||telemetryFields.some(key=>!Number.isFinite(node[key])))continue;
  const load=nodeLoad(node,instances);
  // Upgrade only untouched legacy defaults. Deliberately fixed/custom telemetry stays fixed.
  const legacy=node.telemetryMode==='固定值'&&node.gpuUtil===(node.gpu?66:0)&&node.cpuUtil===42&&node.memoryUtil===46&&node.storageUtil===32&&node.vramUtil===(node.gpu?58:0)&&node.temperature===(node.deviceType==='edge'?39:53)&&node.samples.every((p:any)=>p.value===(node.gpu?66:0)&&p.cpuValue===42&&p.memoryValue===46&&p.storageValue===32&&p.vramValue===(node.gpu?58:0));
  node.telemetryProfile=defaultTelemetryProfile(node,load,legacy);
  if(legacy&&node.status!=='离线'){node.telemetryMode='动态波动';regenerateTelemetry(node,at,load);}
  changed=true;
 }
 return changed;
}
export function updateTelemetry(nodes:Row[],instances:Row[],at:number){
 initializeTelemetry(nodes,instances,at);
 for(const node of nodes){
  if(node.status==='离线')continue;
  const sample=telemetrySample(node,at,nodeLoad(node,instances));
  for(const key of telemetryFields)node[key]=sample[sampleFields[key]];
  node.lastReportAt=at;
  if(Math.floor((node.samples.at(-1)?.time||0)/60000)===Math.floor(at/60000))node.samples[node.samples.length-1]=sample;
  else node.samples.push(sample);
  node.samples=node.samples.slice(-60);
 }
}
export function updateCallSamples(instances:Row[],nodes:Row[],meters:Row[],from:number,to:number){
 const first=Math.max(Math.floor(from/15000)+1,Math.floor(to/15000)-19),last=Math.floor(to/15000);
 if(first>last)return;
 for(const v of instances){
  if(v.status!=='运行中'||v.businessType!=='token'||nodes.find(n=>n.id===v.nodeId)?.status==='离线')continue;
  const rate=meters.filter(m=>m.instanceId===v.id).at(-1)?.rate||0;if(!rate)continue;
  for(let bucket=first;bucket<=last;bucket++){
   const requestId='SIM-'+v.id+'-'+bucket;if(v.calls.some((c:any)=>c.requestId===requestId))continue;
   const hash=telemetryHash(requestId),outputTokens=Math.min(64+hash%705,Math.max(1,rate));
   v.calls.unshift({requestId,time:bucket*15000,model:meters.filter(m=>m.instanceId===v.id).at(-1)?.modelName||v.calls[0]?.model||'Qwen',durationMs:140+hash%470,inputTokens:32+(hash>>>8)%225,outputTokens,status:'成功'});
  }
  v.calls=v.calls.slice(0,20);
 }
}
