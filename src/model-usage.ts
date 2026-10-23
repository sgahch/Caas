import type {Row,State} from './store';
import {dayKey} from './store';
import {meterActive,meterRate,type TokenSimulation} from './token-engine';

export const MODEL_ROUTES_EVENT='catalog:model-routes-v1';
export const modelRoutes=[
 ['GPT-4.1','OpenAI'],['Claude Sonnet 4','Anthropic'],['Gemini 2.5 Pro','Google'],['Llama 3.3','Meta'],
 ['DeepSeek V3','DeepSeek'],['Qwen3','阿里云'],['GLM-4.5','智谱'],['Kimi K2','Moonshot']
];
export function defaultModelRoute(index:number){const [modelName,modelProvider]=modelRoutes[index%modelRoutes.length];return {modelName,modelProvider};}
export function enrichModelRoutes(s:State){
 if(s.processedDemoEventIds.includes(MODEL_ROUTES_EVENT))return false;
 s.tokenMeters.forEach((m,i)=>{if(!m.modelName)Object.assign(m,defaultModelRoute(i));});
 s.processedDemoEventIds.push(MODEL_ROUTES_EVENT);return true;
}
export function modelUsage(s:State,period:'day'|'total'='day',settings?:TokenSimulation,running=true){
 const groups=new Map<string,{id:string;name:string;provider:string;input:number;output:number;total:number;rate:number;share:number}>();
 for(const m of s.tokenMeters){
  const name=String(m.modelName||'未分配模型'),provider=String(m.modelProvider||'未标注'),id=provider+' / '+name;
  const row=groups.get(id)||{id,name,provider,input:0,output:0,total:0,rate:0,share:0};
  const counters=period==='day'?m.dailyCounters.filter((d:Row)=>d.date===dayKey(s.demoNow)):m.dailyCounters;
  row.input+=counters.reduce((v:number,d:Row)=>v+d.inputTokens,0)+(period==='total'?m.inputBeforeDemoDay:0);
  row.output+=counters.reduce((v:number,d:Row)=>v+d.outputTokens,0)+(period==='total'?m.outputBeforeDemoDay:0);
  if(running&&meterActive(s,m))row.rate+=meterRate(m,s.demoNow,settings);
  row.total=row.input+row.output;groups.set(id,row);
 }
 const rows=[...groups.values()].sort((a,b)=>b.total-a.total||a.id.localeCompare(b.id));
 const total=rows.reduce((v,r)=>v+r.total,0);
 rows.forEach(r=>r.share=total?r.total/total*100:0);return rows;
}
