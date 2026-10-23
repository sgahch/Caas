import type {State,Row} from './store';
import {telemetryValue,nodeLoad,type TelemetryField} from './telemetry';

export function historicalLoad(s:State,nodes:Row[],field:TelemetryField,capacity:string,at:number){
 const total=nodes.reduce((sum,n)=>sum+n[capacity],0);if(!total)return null;
 return Math.round(nodes.reduce((sum,n)=>sum+n[capacity]*(at===s.demoNow?n[field]:n.telemetryMode==='动态波动'&&n.telemetryProfile?telemetryValue(n,field,at,nodeLoad(n,s.instances)):n[field]),0)/total*10)/10;
}
export function monitorTimes(s:State){return Array.from({length:121},(_,i)=>s.demoNow-(120-i)*1000);}
export function siteTrends(s:State){const times=monitorTimes(s);return {times,series:s.sites.filter(v=>v.kind!=='edge').map(site=>{const nodes=s.nodes.filter(n=>n.siteId===site.id&&n.status!=='离线');return {id:site.id,name:site.name,values:times.map(at=>historicalLoad(s,nodes,'gpuUtil','gpu',at))};})};}
export function modelAllocation(s:State){return [...new Set(s.nodes.filter(n=>n.gpu).map(n=>n.model))].map(model=>{const nodes=s.nodes.filter(n=>n.model===model&&n.gpu),ids=new Set(nodes.map(n=>n.id)),total=nodes.reduce((sum,n)=>sum+n.gpu,0),allocated=s.instances.filter(v=>v.allocationHeld&&ids.has(v.nodeId)).reduce((sum,v)=>sum+v.gpu,0);return {name:model,total,allocated,free:total-allocated,load:historicalLoad(s,nodes.filter(n=>n.status!=='离线'),'gpuUtil','gpu',s.demoNow)};});}
export function taskActivity(s:State){const end=Math.floor(s.demoNow/300000)*300000;return Array.from({length:12},(_,i)=>{const time=end-(11-i)*300000;return {time,submitted:s.tasks.filter(v=>v.created>=time&&v.created<time+300000).length,ended:s.instances.filter(v=>v.endedAt>=time&&v.endedAt<time+300000).length};});}
