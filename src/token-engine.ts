import type {State,Row} from './store';
import {irregularSignal} from './signal-noise';

export type TokenSimulation={variable:boolean;variation:number;multiplier:number};
export type TokenPoint={time:number;tokens:number;seeded?:boolean};
export const defaultTokenSimulation=():TokenSimulation=>({variable:true,variation:.32,multiplier:1});
export function validateTokenSimulation(value:TokenSimulation){
 if(!value||typeof value.variable!=='boolean'||!Number.isFinite(value.variation)||value.variation<0||value.variation>.8||!Number.isFinite(value.multiplier)||value.multiplier<0||value.multiplier>100)throw Error('Token 生成参数无效：波动 0～80%，倍率 0～100');
}
export function meterActive(s:State,m:Row,at=s.demoNow){
 const v=s.instances.find(v=>v.id===m.instanceId),u=s.usage.find(u=>u.id===m.usageRecordId);
 return !!(v&&u&&u.startedAt<at&&(!u.endedAt||u.endedAt>=at)&&v.status==='运行中'&&v.businessType==='token'&&s.nodes.find(n=>n.id===v.nodeId)?.status!=='离线');
}
export function meterRate(m:Row,at:number,settings?:TokenSimulation){
 if(!settings)return m.rate as number;
 const time=at/1000;
 const wave=.78*irregularSignal('token-workload',time)+.22*irregularSignal(m.id,time);
 return Math.max(0,Math.floor(m.rate*settings.multiplier*(1+(settings.variable?settings.variation*wave:0))));
}
export function demoTokenHistory(s:State,settings?:TokenSimulation):TokenPoint[]{
 return Array.from({length:120},(_,i)=>{const time=s.demoNow-(119-i)*1000;return {time,tokens:s.tokenMeters.reduce((sum,m)=>sum+(meterActive(s,m,time)?meterRate(m,time,settings):0),0),seeded:true};});
}
export function tokenStats(s:State,settings?:TokenSimulation,running=true){
 const history=s.tokenHistory?.length?s.tokenHistory:demoTokenHistory(s,settings),recent=history.filter(p=>p.time>s.demoNow-60000&&p.time<=s.demoNow);
 const total=recent.reduce((sum,p)=>sum+p.tokens,0);
 return {history,current:running?(history.at(-1)?.tokens||0):0,average:recent.length?total/recent.length:0,minute:total,seconds:recent.length};
}
export function tokenMinutes(s:State,settings?:TokenSimulation){
 const grouped=new Map<number,{time:number;tokens:number;seconds:number;seeded:boolean}>();
 for(const p of tokenStats(s,settings).history){const time=Math.floor((p.time-1)/60000)*60000;const bucket=grouped.get(time)||{time,tokens:0,seconds:0,seeded:false};bucket.tokens+=p.tokens;bucket.seconds++;bucket.seeded||=!!p.seeded;grouped.set(time,bucket);}
 return [...grouped.values()].slice(-12);
}
// Largest remainder makes the displayed tenths add up to exactly 100.0%.
export function modelShares(models:{name:string;value:number}[]){
 const total=models.reduce((sum,m)=>sum+m.value,0);if(!total)return models.map(m=>({...m,percent:0}));
 const rows=models.map(m=>({...m,raw:m.value/total*1000,units:Math.floor(m.value/total*1000)}));
 let left=1000-rows.reduce((sum,m)=>sum+m.units,0);
 for(const m of [...rows].sort((a,b)=>(b.raw-b.units)-(a.raw-a.units)))if(left-->0)m.units++;
 return rows.map(({name,value,units})=>({name,value,percent:units/10}));
}
