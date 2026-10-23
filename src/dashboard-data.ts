import {historicalLoad,monitorTimes} from './monitor-data';
import {dayKey,type State} from './store';
import {siteName,name,type Config} from './config';
import {edgeLocation} from './edge';

export const taskStatuses=['运行中','待调度','调度中','失败','已暂停','已终止'];
export type TelemetryRuntime={playing:boolean;maintenance?:boolean;preview?:boolean};
export function samplingStatus(runtime:TelemetryRuntime,points:number,stalled=false){
 if(runtime.preview)return '预览已冻结';
 if(runtime.maintenance)return '维护中，更新已暂停';
 if(!runtime.playing)return '更新已暂停';
 if(stalled)return '未收到新样本，请检查运行状态';
 return points<2?'等待下一个采样点…':'';
}
export function siteLoads(s:State,c:Config){
 return s.sites.filter(site=>site.kind!=='edge').map(site=>{
  const nodes=s.nodes.filter(n=>n.siteId===site.id&&n.status!=='离线');
  const weighted=(capacity:string,field:string)=>{
   const total=nodes.reduce((sum,n)=>sum+n[capacity],0);
   return total?Math.round(nodes.reduce((sum,n)=>sum+n[capacity]*n[field],0)/total*10)/10:null;
  };
  return {id:site.id,name:siteName(c,s,site.id),gpu:weighted('gpu','gpuUtil'),cpu:weighted('cpu','cpuUtil')};
 });
}

// Renderer-only observations: no invented history or writes to business records.
export class LiveResourceHistory{
 private epoch='';
 private points:{time:number;values:(number|null)[]}[]=[];
 observe(s:State,runId='',prefill=false){
  const nodes=s.nodes.filter(n=>n.status!=='离线');
  const epoch=runId+'|'+nodes.map(n=>[n.id,n.gpu,n.cpu,n.memory].join(':')).join('|');
  const time=Math.floor(s.demoNow/(prefill?1000:2000))*(prefill?1000:2000);
  if(epoch!==this.epoch||time<(this.points.at(-1)?.time??time)){this.points=prefill?monitorTimes(s).slice(0,-1).map(time=>({time,values:([['gpuUtil','gpu'],['cpuUtil','cpu'],['memoryUtil','memory']] as const).map(([field,cap])=>historicalLoad(s,nodes,field,cap,time))})):[];this.epoch=epoch;}
  const values=[['gpu','gpuUtil'],['cpu','cpuUtil'],['memory','memoryUtil']].map(([capacity,field])=>{
   const total=nodes.reduce((sum,n)=>sum+n[capacity],0);
   return total?Math.round(nodes.reduce((sum,n)=>sum+n[capacity]*n[field],0)/total*10)/10:null;
  });
  const point={time,values};
  if(this.points.at(-1)?.time===time)this.points[this.points.length-1]=point;else this.points.push(point);
  this.points=this.points.filter(p=>p.time>=time-120000).slice(prefill?-121:-61);
  return this.snapshot();
 }
 snapshot(){return {times:this.points.map(p=>p.time),series:['GPU','CPU','内存'].map((name,i)=>({name,values:this.points.map(p=>p.values[i])}))};}
}
export function dashboardData(s:State,c:Config){
 const sites=s.sites.map(site=>{const nodes=s.nodes.filter(n=>n.siteId===site.id),ids=new Set(nodes.map(n=>n.id));const total=nodes.reduce((v,n)=>v+n.gpu,0),allocated=s.instances.filter(v=>v.allocationHeld&&ids.has(v.nodeId)).reduce((sum,v)=>sum+v.gpu,0);return {id:site.id,name:siteName(c,s,site.id),total,allocated,free:Math.max(0,total-allocated)};});
 const models=[...new Set(s.nodes.filter(n=>n.gpu).map(n=>n.model))].map(model=>({name:model,value:s.nodes.filter(n=>n.model===model).reduce((sum,n)=>sum+n.gpu,0)}));
 const tasks=taskStatuses.map(status=>({name:status,value:s.tasks.filter(t=>t.status===status).length}));
 const edgeRegions=[...new Set(s.nodes.filter(n=>n.deviceType==='edge').map(n=>edgeLocation(n)?.region||'未定位'))].map(region=>{const nodes=s.nodes.filter(n=>n.deviceType==='edge'&&(edgeLocation(n)?.region||'未定位')===region);return {name:region,total:nodes.length,online:nodes.filter(n=>n.status==='在线').length};});
 const tenants=s.tenants.map(t=>{const meters=s.tokenMeters.filter(m=>m.tenantId===t.id),bills=s.bills.filter(b=>b.tenantId===t.id);return {id:t.id,name:name(c,'tenants',t),token:meters.reduce((v,m)=>v+(m.dailyCounters.find((d:any)=>d.date===dayKey(s.demoNow))?.outputTokens||0),0),paid:bills.reduce((v,b)=>v+b.paidCents,0)/100,due:bills.reduce((v,b)=>v+Math.max(0,b.amountCents-b.paidCents),0)/100};});
 return {sites,models,tasks,edgeRegions,tenants};
}

export function resourceTrend(s:State){
 const nodes=s.nodes.filter(n=>n.status!=='离线');
 const minutes=[...new Set<number>(nodes.flatMap(n=>n.samples.filter((p:any)=>p.time<=s.demoNow).map((p:any)=>Math.floor(p.time/60000))))].sort((a,b)=>a-b).slice(-60);
 const series=[['GPU','gpu','value','gpuUtil'],['CPU','cpu','cpuValue','cpuUtil'],['内存','memory','memoryValue','memoryUtil']].map(([label,capacity,field,current])=>({name:label,values:minutes.map(minute=>{
  let sum=0,weight=0;for(const n of nodes){if(!n[capacity])continue;const p=n.samples.findLast((p:any)=>Math.floor(p.time/60000)<=minute);if(!p)continue;const value=p[field]??n[current];sum+=value*n[capacity];weight+=n[capacity];}return weight?Math.round(sum/weight*10)/10:null;
 })}));
 return {times:minutes.map(v=>v*60000),series};
}
