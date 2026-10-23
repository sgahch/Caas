import {commerceChartOptions,modelRankingShell} from './commerce-view';
import {tokenStats,tokenMinutes,defaultTokenSimulation,modelShares} from './token-engine';
import {siteTrends,modelAllocation,taskActivity,historicalLoad} from './monitor-data';
import {siteName} from './config';
import * as echarts from 'echarts/core';
import {BarChart,LineChart,PieChart,HeatmapChart,RadarChart,ScatterChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent,VisualMapComponent,GraphicComponent,RadarComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {dashboardData,resourceTrend,taskStatuses,siteLoads,LiveResourceHistory,samplingStatus,type TelemetryRuntime} from './dashboard-data';
import {code,type Config} from './config';
import {dateText,type State} from './store';
import {esc} from './ui';

echarts.use([BarChart,LineChart,PieChart,HeatmapChart,RadarChart,ScatterChart,GridComponent,TooltipComponent,LegendComponent,VisualMapComponent,GraphicComponent,RadarComponent,CanvasRenderer]);
const colors=['#2dd9ed','#4a92ff','#aa8bff','#ffbe69','#ff738b','#5ad6b0','#ef8ed1','#7cbbf3'];
const muted='#7899b3',line='#1b3b52',text='#c9deee';
export type ChartSelection={view:string;filters?:Record<string,string>;query?:string;nodeId?:string;tab?:'bills'|'usage'};
const registry=new Map<string,{chart:echarts.ECharts;observer:ResizeObserver;intersection:IntersectionObserver;visible:boolean;initialized:boolean}>();
const liveHistory=new LiveResourceHistory();
let trendMode='live',capacityMode='load';
let latest:{s:State;c:Config;runId:string;runtime:TelemetryRuntime}|undefined;
let observedTime=NaN,observedRun='',lastAdvanceAt=performance.now();
const copy=(c:Config,s:string)=>c.copy[s]||s;
const compact=(v:number)=>Math.abs(v)>=1e6?(v/1e6).toFixed(1)+'M':Math.abs(v)>=1e3?(v/1e3).toFixed(1)+'k':String(v);
export function chartPanel(key:string,title:string,note:string,c:Config,extra=''){
 return `<article class="panel viz-panel ${extra}"><div class="panel-head"><h2>${esc(copy(c,title))}</h2><span>${esc(copy(c,note))}</span></div><div class="viz-chart" data-viz="${key}" role="figure" aria-label="${esc(copy(c,title))}"></div></article>`;
}
export const overviewRail=(c:Config)=>`<aside class="cockpit-rail">${chartPanel('models','GPU 型号资源占比','按卡数统计',c)}${chartPanel('tasks','任务运行态势','点击筛选',c)}</aside>`;
function switchablePanel(key:string,title:string,mode:string,choices:[string,string][],c:Config){
 return chartPanel(key,title,'',c).replace('<span></span>',`<select class="chart-mode" data-chart-mode="${key}" aria-label="${esc(copy(c,title))}">${choices.map(([value,label])=>`<option value="${value}" ${value===mode?'selected':''}>${esc(copy(c,label))}</option>`).join('')}</select>`);
}
export const overviewBottom=(c:Config)=>`<section class="token-observatory"><div class="observatory-heading"><div><span class="section-index">01 / TOKEN ENGINE</span><h2>Token 实时生产</h2></div><span class="muted">每秒采样</span></div><div class="token-live-stats"><div><span>当前生成速率</span><strong id="token-rate">—</strong><small>Tokens / s</small></div><div><span>最近 60 秒平均</span><strong id="token-average">—</strong><small>Tokens / s</small></div><div><span>最近一分钟产出</span><strong id="token-minute">—</strong><small id="token-history-label">Tokens · 滚动窗口</small></div><div class="engine-state"><span>生成引擎</span><strong id="token-engine-state">运行中</strong><small>本地计量 · UTC+8</small></div></div><div class="token-chart-grid">${chartPanel('token-live','Token 实时产出趋势','Tokens/s · 历史 + 实时',c)}${chartPanel('token-minutes','Token 每分钟产量','Token / 分钟 · 含当前分钟',c)}</div>${modelRankingShell()}</section><div class="observatory-heading resource-heading"><div><span class="section-index">02 / RESOURCE INTELLIGENCE</span><h2>资源与调度洞察</h2></div><span class="muted">统一资源视图</span></div><section class="overview-trends">${switchablePanel('trend','资源利用率趋势',trendMode,[['live','最近两分钟 · 历史 + 实时'],['hour','近一小时 · 历史样本']],c)}${switchablePanel('capacity','机房资源监控',capacityMode,[['load','GPU / CPU 利用率'],['allocation','GPU 已分配 / 空闲']],c)}</section><section class="monitor-grid">${chartPanel('site-trend','各机房 GPU 负载趋势','最近 120 秒 · %',c,'wide-chart')}${chartPanel('allocation','各型号资源分配','已分配 + 空闲 = 总卡数',c)}${chartPanel('gpu-heatmap','GPU 节点负载分布','最近 120 秒 · GPU 利用率',c,'wide-chart')}${chartPanel('model-load','各 GPU 型号负载','在线卡数加权 · %',c)}${chartPanel('top-nodes','高负载节点 TOP 8','在线 GPU 节点 · %',c)}${chartPanel('task-flow','任务提交与结束趋势','近 1 小时 · 5 分钟分桶',c)}</section>`;
export function analyticsShell(view:string,c:Config){
 const specs:Record<string,[string,string,string][]>={
  nodes:[
   ['trend','资源实时脉动','GPU / CPU / 内存 · 最近 120 秒'],['site-trend','机房负载轨迹','多机房 · GPU 利用率 %'],['models','GPU 型号资源占比','卡数与占比 · 点击筛选'],
   ['resource-radar','资源多维水位','在线设备 · 容量加权 %'],['allocation','型号分配全景','已分配 + 空闲 = 总卡数'],['model-load','型号负载对比','在线 GPU · 容量加权 %'],
   ['gpu-heatmap','GPU 时序热力矩阵','节点 × 时间 · 最近 120 秒'],['heatmap','全量设备负载矩阵','GPU 设备显示 GPU · 边缘显示 CPU'],
   ['thermal','设备温度与负载','每点一台设备 · 点击查看'],['top-nodes','高负载节点 TOP 8','在线 GPU 节点 · 实时 %'],['capacity','机房资源水位','GPU / CPU · 利用率 %'],['regions','边缘设备地域分布','全量设备 · 点击地区筛选']
  ],
  billing:[['tokens','租户当日产量','输出 Token · UTC+8'],['receivables','租户账款分布','人民币元 · 已出账记录']],
  queue:[['tasks','任务状态分布','全量任务 · 点击状态筛选'],['priorities','任务优先级分布','全量任务 · 点击优先级筛选']]
 };
 return specs[view]?`<section class="analytics-grid ${view==='nodes'?'resource-monitor-grid':''}">${specs[view].map(([key,title,note])=>chartPanel(key,title,note,c)).join('')}</section>`:'';
}
const valueAxis=(max:number|null=null)=>({type:'value',max,axisLabel:{color:muted,fontSize:10,formatter:compact},splitLine:{lineStyle:{color:line,type:'dashed'}},axisLine:{show:false},axisTick:{show:false}});
const categories=(names:string[])=>({type:'category',data:names,axisLabel:{color:text,fontSize:10,overflow:'truncate',width:95},axisLine:{lineStyle:{color:line}},axisTick:{show:false}});
function donut(data:{name:string;value:number}[],unit:string){
 const nonzero=data.filter(d=>d.value),total=data.reduce((v,d)=>v+d.value,0);
 return {legend:{type:'scroll',orient:'vertical',right:8,top:'middle',itemWidth:8,itemHeight:8,itemGap:13,selectedMode:false,textStyle:{color:text,fontSize:10}},series:[{type:'pie',radius:['49%','70%'],center:['30%','50%'],avoidLabelOverlap:true,label:{show:false},itemStyle:{borderWidth:3,borderColor:'#071c31'},data:nonzero.length?nonzero:[{name:'暂无数据',value:0}],emphasis:{scaleSize:4}}],graphic:[{type:'text',left:'21%',top:'38%',style:{text:String(total),fill:'#e6f8ff',font:'600 27px Segoe UI'}},{type:'text',left:'23%',top:'59%',style:{text:unit,fill:muted,font:'10px Microsoft YaHei'}}]};
}
function timeLines(times:number[],series:{name:string;values:(number|null)[]}[],percent:boolean){return {tooltip:{trigger:'axis',renderMode:'richText',backgroundColor:'#0b2940',borderColor:'#276580',textStyle:{color:'#e2f3ff',fontSize:11},valueFormatter:(v:number)=>v===null?'—':v.toLocaleString()+(percent?'%':' Tokens/s')},legend:{type:'scroll',top:6,left:14,right:14,pageTextStyle:{color:muted},pageIconColor:text,itemWidth:16,itemHeight:3,textStyle:{color:text,fontSize:10}},grid:{left:14,right:22,top:40,bottom:12,containLabel:true},xAxis:{...categories(times.map(t=>dateText(t).slice(11,19))),boundaryGap:false,axisLabel:{color:muted,fontSize:10,interval:Math.max(0,Math.floor(times.length/5)-1)}},yAxis:{...valueAxis(percent?100:null),axisLabel:{color:muted,fontSize:10,formatter:percent?'{value}%':compact}},series:series.map((v,i)=>({id:v.name,name:v.name,type:'line',smooth:.08,showSymbol:false,lineStyle:{width:2,color:colors[i%colors.length],shadowBlur:6,shadowColor:colors[i%colors.length]+'35'},areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:colors[i%colors.length]+'35'},{offset:1,color:colors[i%colors.length]+'00'}])},data:v.values}))};}
function options(key:string,s:State,c:Config):any{
 const d=dashboardData(s,c),base={backgroundColor:'transparent',color:colors,textStyle:{fontFamily:'Microsoft YaHei, Segoe UI, sans-serif'},animation:!matchMedia('(prefers-reduced-motion: reduce)').matches,animationDuration:500,animationDurationUpdate:450,tooltip:{trigger:'item',renderMode:'richText',backgroundColor:'#0b2940',borderColor:'#276580',textStyle:{color:'#e2f3ff',fontSize:11}},grid:{left:40,right:20,top:20,bottom:28,containLabel:true}};
 let body:any={};
 if(key==='models'){
  const shares=modelShares(d.models),total=shares.reduce((sum,m)=>sum+m.value,0);
  const width=registry.get(key)?.chart.getWidth()||280,height=registry.get(key)?.chart.getHeight()||180,center=width*(width<300?.21:.23);
  const ring:any=donut(shares,'GPU 卡');ring.series[0].center=[center,'50%'];ring.series[0].radius=width<300?['35%','51%']:['40%','59%'];
  body={...ring,tooltip:{...base.tooltip,formatter:(p:any)=>`${p.name}\n${p.value} 卡 · ${shares.find(m=>m.name===p.name)?.percent.toFixed(1)??'0.0'}%`},legend:{type:'scroll',orient:'vertical',right:7,top:'middle',itemWidth:6,itemHeight:6,itemGap:8,pageIconSize:8,pageTextStyle:{color:muted,fontSize:9},textStyle:{color:text,fontSize:9,rich:{name:{width:60,color:text,fontSize:9},value:{width:64,align:'right',color:'#8eafc7',fontSize:9}}},formatter:(name:string)=>{const m=shares.find(m=>m.name===name);return m?`{name|${name}}{value|${m.value} · ${m.percent.toFixed(1)}%}`:name;}},graphic:[{type:'text',x:center,y:height*.44,style:{text:String(total),align:'center',verticalAlign:'middle',fill:'#e6f8ff',font:'600 27px Segoe UI'}},{type:'text',x:center,y:height*.59,style:{text:total?'GPU 总卡数':'暂无资源',align:'center',verticalAlign:'middle',fill:muted,font:'9px Microsoft YaHei'}}]};
 }
 if(key==='tasks')body={grid:{left:12,right:33,top:12,bottom:8,containLabel:true},xAxis:{...valueAxis(),minInterval:1},yAxis:{...categories([...taskStatuses].reverse()),axisLine:{show:false}},series:[{type:'bar',barMaxWidth:10,showBackground:true,backgroundStyle:{color:'#123048'},label:{show:true,position:'right',color:text,fontSize:10},data:[...d.tasks].reverse().map(v=>({value:v.value,name:v.name,itemStyle:{color:({'运行中':colors[0],'待调度':colors[3],'调度中':colors[1],'失败':colors[4],'已暂停':colors[2],'已终止':muted} as any)[v.name],borderRadius:[0,3,3,0]}}))}]};
 if(key==='trend'){
  const trend=trendMode==='live'?liveHistory.snapshot():resourceTrend(s),hint=trendMode==='live'?samplingStatus(latest?.runtime||{playing:true},trend.times.length,performance.now()-lastAdvanceAt>6000):'';body={tooltip:{...base.tooltip,trigger:'axis'},legend:{top:4,right:12,itemWidth:14,itemHeight:3,selectedMode:true,textStyle:{color:text,fontSize:10}},grid:{left:12,right:20,top:40,bottom:10,containLabel:true},xAxis:{...categories(trend.times.map(t=>dateText(t).slice(11,trendMode==='live'?19:16))),boundaryGap:false,axisLabel:{color:muted,fontSize:10,interval:Math.max(0,Math.floor(trend.times.length/5)-1)}},yAxis:{...valueAxis(100),axisLabel:{color:muted,fontSize:10,formatter:'{value}%'}},graphic:hint?[{type:'text',left:'center',top:'middle',style:{text:copy(c,hint),fill:muted,font:'11px Microsoft YaHei'}}]:[],series:trend.series.map((v,i)=>({id:v.name,name:v.name,type:'line',smooth:.08,showSymbol:trend.times.length<2,symbolSize:5,connectNulls:false,lineStyle:{width:2},areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:colors[i%colors.length]+'30'},{offset:1,color:colors[i%colors.length]+'00'}])},data:v.values}))};
 }
 if(key==='capacity'){
  const sites=d.sites.filter(v=>v.total);body={legend:{top:5,right:10,itemWidth:9,itemHeight:9,selectedMode:false,textStyle:{color:text,fontSize:10}},grid:{left:10,right:20,top:36,bottom:10,containLabel:true},xAxis:valueAxis(),yAxis:categories(sites.map(v=>v.name)),series:[{name:'已分配',type:'bar',stack:'gpu',barMaxWidth:15,data:sites.map(v=>({name:v.name,value:v.allocated,siteId:v.id}))},{name:'空闲',type:'bar',stack:'gpu',barMaxWidth:15,itemStyle:{color:'#254865',borderRadius:[0,3,3,0]},data:sites.map(v=>({name:v.name,value:v.free,siteId:v.id}))}]};
 }
 if(key==='capacity'&&capacityMode==='load'){
  const sites=siteLoads(s,c);body={legend:{top:5,right:10,itemWidth:9,itemHeight:9,selectedMode:false,textStyle:{color:text,fontSize:10}},grid:{left:10,right:40,top:36,bottom:10,containLabel:true},xAxis:{...valueAxis(100),axisLabel:{color:muted,fontSize:10,formatter:'{value}%'}},yAxis:categories(sites.map(v=>v.name)),series:([['GPU','gpu'],['CPU','cpu']] as const).map(([name,key])=>({id:name,name,type:'bar',barMaxWidth:10,barGap:'35%',label:{show:true,position:'right',formatter:'{c}%',color:text,fontSize:9},itemStyle:{borderRadius:[0,3,3,0]},data:sites.map(v=>({value:v[key],siteId:v.id}))}))};
 }
 if(key==='heatmap'){
  const perRow=12,rowCount=Math.max(1,Math.ceil(s.nodes.length/perRow));body={tooltip:{...base.tooltip,formatter:(p:any)=>`${code(c,'nodes',p.data.nodeId)}\n${p.data.offline?'离线':p.data.kind+' '+p.value[2]+'%'}`},grid:{left:10,right:12,top:15,bottom:45,containLabel:true},xAxis:{...categories(Array.from({length:perRow},(_,i)=>String(i+1).padStart(2,'0'))),splitArea:{show:false}},yAxis:{...categories(Array.from({length:rowCount},(_,i)=>String(i*perRow+1)+'—'+Math.min(s.nodes.length,(i+1)*perRow))),inverse:true},visualMap:{min:0,max:100,orient:'horizontal',left:'center',bottom:0,itemWidth:8,itemHeight:130,text:['100%','0%'],textStyle:{color:muted,fontSize:9},inRange:{color:['#102d46','#146687','#29c9dc','#a5f2d0']},calculable:false},series:[{type:'heatmap',label:{show:true,color:'#d7edf7',fontSize:9,formatter:(p:any)=>p.data.offline?'离线':String(p.value[2])},itemStyle:{borderWidth:4,borderColor:'#071b30',borderRadius:3},data:s.nodes.map((n,i)=>({nodeId:n.id,kind:n.gpu?'GPU':'CPU',offline:n.status==='离线',value:[i%perRow,Math.floor(i/perRow),n.status==='离线'?0:Math.round(n.gpu?n.gpuUtil:n.cpuUtil)],...(n.status==='离线'?{itemStyle:{color:'#352c40'}}:{})}))}]};
 }
 if(key==='regions')body={legend:{top:4,right:10,itemWidth:8,itemHeight:8,selectedMode:false,textStyle:{color:text,fontSize:10}},grid:{left:10,right:16,top:35,bottom:10,containLabel:true},xAxis:categories(d.edgeRegions.map(v=>v.name)),yAxis:{...valueAxis(),minInterval:1},series:[{name:'在线',type:'bar',stack:'edge',barMaxWidth:22,itemStyle:{color:colors[2]},data:d.edgeRegions.map(v=>v.online)},{name:'离线 / 异常',type:'bar',stack:'edge',itemStyle:{color:'#494263'},data:d.edgeRegions.map(v=>v.total-v.online)}]};
 if(key==='tokens'||key==='receivables'){
  const tenants=[...d.tenants].sort((a,b)=>key==='tokens'?a.token-b.token:a.paid+a.due-b.paid-b.due);
  body={legend:key==='receivables'?{top:3,right:10,itemWidth:8,itemHeight:8,selectedMode:false,textStyle:{color:text,fontSize:10}}:undefined,grid:{left:10,right:25,top:key==='tokens'?10:30,bottom:10,containLabel:true},xAxis:valueAxis(),yAxis:categories(tenants.map(v=>v.name)),series:key==='tokens'?[{name:'输出 Token',type:'bar',barMaxWidth:12,itemStyle:{color:colors[2],borderRadius:[0,3,3,0]},data:tenants.map(v=>({value:v.token,tenantId:v.id}))}]:[{name:'已收',type:'bar',stack:'money',barMaxWidth:12,data:tenants.map(v=>({value:v.paid,tenantId:v.id}))},{name:'未收',type:'bar',stack:'money',barMaxWidth:12,itemStyle:{color:colors[3]},data:tenants.map(v=>({value:v.due,tenantId:v.id}))}]};
 }
 if(key==='priorities')body={legend:{top:4,right:10,itemWidth:8,itemHeight:8,selectedMode:false,textStyle:{color:text,fontSize:10}},xAxis:categories(['P0','P1','P2','P3']),yAxis:{...valueAxis(),minInterval:1},grid:{...base.grid,top:38},series:['运行中','待调度','失败','其他'].map(status=>({name:status,type:'bar',stack:'tasks',barMaxWidth:30,itemStyle:{color:({'运行中':colors[0],'待调度':colors[3],'失败':colors[4],'其他':colors[2]} as any)[status]},data:['P0','P1','P2','P3'].map(priority=>({value:s.tasks.filter(t=>t.priority===priority&&(status==='其他'?!['运行中','待调度','失败'].includes(t.status):t.status===status)).length,priority}))}))};
 if(key==='gpu-heatmap'){
  const nodes=s.nodes.filter(n=>n.gpu&&n.status!=='离线').sort((a,b)=>b.gpuUtil-a.gpuUtil).slice(0,8),times=Array.from({length:12},(_,i)=>s.demoNow-(11-i)*10000);
  body={tooltip:{...base.tooltip,formatter:(p:any)=>`${code(c,'nodes',p.data.nodeId)} · ${dateText(times[p.value[0]]).slice(11,19)}\nGPU ${p.value[2]}%`},grid:{left:12,right:14,top:12,bottom:36,containLabel:true},xAxis:{...categories(times.map(t=>dateText(t).slice(11,19))),axisLabel:{color:muted,fontSize:9,interval:2}},yAxis:categories(nodes.map(n=>code(c,'nodes',n.id))),visualMap:{min:0,max:100,orient:'horizontal',left:'center',bottom:0,itemWidth:7,itemHeight:160,text:['100%','0%'],textStyle:{color:muted,fontSize:9},inRange:{color:['#102b47','#205e87','#26b8c3','#91ead4']},calculable:false},series:[{type:'heatmap',itemStyle:{borderWidth:3,borderColor:'#071c30',borderRadius:2},data:nodes.flatMap((n,y)=>times.map((time,x)=>({nodeId:n.id,value:[x,y,historicalLoad(s,[n],'gpuUtil','gpu',time)]})))}]};
 }
 if(key==='resource-radar'){
  const online=s.nodes.filter(n=>n.status!=='离线'),sites=s.sites.filter(site=>online.some(n=>n.siteId===site.id));
  const fields=[['GPU','gpuUtil','gpu'],['CPU','cpuUtil','cpu'],['显存','vramUtil','gpu'],['内存','memoryUtil','memory'],['存储','storageUtil','storage']] as const;
  body={legend:{bottom:5,left:'center',itemWidth:8,itemHeight:8,textStyle:{color:text,fontSize:10}},radar:{center:['50%','46%'],radius:'62%',indicator:fields.map(([name])=>({name,max:100})),axisName:{color:muted,fontSize:10},splitNumber:4,splitArea:{areaStyle:{color:['#102d4522','#19405a33']}},splitLine:{lineStyle:{color:'#24465b'}},axisLine:{lineStyle:{color:'#24465b'}}},series:[{type:'radar',symbolSize:3,lineStyle:{width:1.5},data:sites.map((site,i)=>({name:siteName(c,s,site.id),value:fields.map(([,field,capacity])=>historicalLoad(s,online.filter(n=>n.siteId===site.id),field,capacity,s.demoNow)??0),areaStyle:{color:colors[i%colors.length],opacity:.1},itemStyle:{color:colors[i%colors.length]}}))}]};
 }
 if(key==='thermal'){
  const online=s.nodes.filter(n=>n.status!=='离线');
  body={tooltip:{...base.tooltip,formatter:(p:any)=>`${code(c,'nodes',p.data.nodeId)} · ${p.seriesName}\n负载 ${p.value[0]}% · 温度 ${p.value[1]}°C`},legend:{top:5,right:12,itemWidth:7,itemHeight:7,textStyle:{color:text,fontSize:10}},grid:{left:12,right:22,top:40,bottom:12,containLabel:true},xAxis:{...valueAxis(100),name:'负载 %',nameLocation:'middle',nameGap:22,nameTextStyle:{color:muted,fontSize:9}},yAxis:{...valueAxis(95),axisLabel:{color:muted,fontSize:10,formatter:'{value}°'}},series:[['中心 GPU',online.filter(n=>n.gpu)],['边缘 CPU',online.filter(n=>!n.gpu)]].map(([name,nodes],i)=>({name,type:'scatter',symbolSize:(v:number[])=>9+Math.sqrt(v[2])*1.6,itemStyle:{color:colors[i?2:0],opacity:.72,shadowBlur:10,shadowColor:colors[i?2:0]+'55'},data:(nodes as State['nodes']).map(n=>({nodeId:n.id,value:[n.gpu?n.gpuUtil:n.cpuUtil,n.temperature,n.gpu||1]}))}))};
 }
 if(key==='token-live'){
  const history=tokenStats(s,c.tokenSimulation||defaultTokenSimulation()).history.slice(-121);
  body=timeLines(history.map(p=>p.time),[{name:'Token 生成速率',values:history.map(p=>p.tokens)}],false);
 }
 if(key==='token-minutes'){
  const minutes=tokenMinutes(s,c.tokenSimulation||defaultTokenSimulation());
  body={tooltip:{...base.tooltip,trigger:'axis',formatter:(items:any[])=>{const b=minutes[items[0]?.dataIndex];return b?`${dateText(b.time).slice(11,16)} · ${b.seconds} 秒样本${b.seeded?' · 含历史样本':''}\n${b.tokens.toLocaleString()} Tokens`:'';}},grid:{left:12,right:15,top:22,bottom:12,containLabel:true},xAxis:categories(minutes.map(m=>dateText(m.time).slice(11,16))),yAxis:valueAxis(),series:[{name:'分钟产量',type:'bar',barMaxWidth:38,itemStyle:{borderRadius:[4,4,0,0],color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#aa8bff'},{offset:1,color:'#28477d'}])},data:minutes.map(m=>m.tokens)}]};
 }
 if(key==='site-trend'){const trend=siteTrends(s);body=timeLines(trend.times,trend.series.map(v=>({...v,name:siteName(c,s,v.id)})),true);}
 if(key==='allocation'){
  const models=modelAllocation(s);body={legend:{top:4,right:12,textStyle:{color:text,fontSize:10},itemWidth:9,itemHeight:9},grid:{left:12,right:22,top:36,bottom:12,containLabel:true},xAxis:valueAxis(),yAxis:categories(models.map(m=>m.name)),series:[{name:'已分配',type:'bar',stack:'cards',barMaxWidth:15,itemStyle:{color:colors[0]},data:models.map(m=>m.allocated)},{name:'空闲',type:'bar',stack:'cards',barMaxWidth:15,itemStyle:{color:'#315275',borderRadius:[0,4,4,0]},data:models.map(m=>m.free)}]};
 }
 if(key==='model-load'||key==='top-nodes'){
  const data=key==='model-load'?modelAllocation(s).filter(m=>m.load!==null).map(m=>({name:m.name,value:m.load})):s.nodes.filter(n=>n.gpu&&n.status!=='离线').sort((a,b)=>b.gpuUtil-a.gpuUtil).slice(0,8).reverse().map(n=>({name:code(c,'nodes',n.id),value:n.gpuUtil,nodeId:n.id}));
  body={grid:{left:12,right:50,top:14,bottom:10,containLabel:true},tooltip:{...base.tooltip,valueFormatter:(v:number)=>v+'%'},xAxis:{...valueAxis(100),axisLabel:{color:muted,fontSize:10,formatter:'{value}%'}},yAxis:categories(data.map(m=>m.name)),series:[{type:'bar',barMaxWidth:11,showBackground:true,backgroundStyle:{color:'#102d44'},label:{show:true,position:'right',color:text,fontSize:10,formatter:'{c}%'},itemStyle:{borderRadius:[0,4,4,0],color:new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:key==='top-nodes'?'#22547c':'#4c4286'},{offset:1,color:key==='top-nodes'?colors[0]:colors[2]}])},data}]};
 }
 if(key==='task-flow'){
  const activity=taskActivity(s);body={legend:{top:4,right:12,itemWidth:8,itemHeight:8,textStyle:{color:text,fontSize:10}},grid:{left:12,right:18,top:38,bottom:12,containLabel:true},tooltip:{...base.tooltip,trigger:'axis'},xAxis:categories(activity.map(v=>dateText(v.time).slice(11,16))),yAxis:{...valueAxis(),minInterval:1},series:[{name:'提交任务',type:'bar',barMaxWidth:14,itemStyle:{color:colors[1],borderRadius:[3,3,0,0]},data:activity.map(v=>v.submitted)},{name:'结束实例',type:'bar',barMaxWidth:14,itemStyle:{color:colors[2],borderRadius:[3,3,0,0]},data:activity.map(v=>v.ended)}]};
 }
 const commerce=commerceChartOptions(key,s,c,!!latest?.runtime.playing&&!latest?.runtime.maintenance&&!latest?.runtime.preview);if(commerce)body=commerce;
 // Stable IDs let ECharts animate values instead of recreating each series on every poll.
 if(body.series)body.series=body.series.map((series:any,index:number)=>({...series,id:series.id||key+'-'+(series.name||index)}));
 return {...base,...body};
}
export function mountVisuals(s:State,c:Config,select:(value:ChartSelection)=>void,runId='',runtime:TelemetryRuntime={playing:true}){
 document.querySelectorAll<HTMLSelectElement>('[data-chart-mode]').forEach(el=>el.onchange=()=>{
  if(el.dataset.chartMode==='trend')trendMode=el.value;else capacityMode=el.value;
  if(latest)updateVisuals(latest.s,latest.c,latest.runId,latest.runtime);
 });
 document.querySelectorAll<HTMLElement>('[data-viz]').forEach(el=>{
  const key=el.dataset.viz!,chart=echarts.init(el);const observer=new ResizeObserver(()=>{chart.resize();if((key==='models'||key==='model-providers')&&latest)chart.setOption(options(key,latest.s,latest.c),{replaceMerge:['series','graphic'],lazyUpdate:true,silent:true});});observer.observe(el);const intersection=new IntersectionObserver(entries=>{const entry=registry.get(key);if(!entry)return;entry.visible=entries[0].isIntersecting;if(entry.visible&&latest){chart.setOption(options(key,latest.s,latest.c),{replaceMerge:['series','graphic'],lazyUpdate:true,silent:true});}},{rootMargin:'120px'});registry.set(key,{chart,observer,intersection,visible:true,initialized:false});intersection.observe(el);
  chart.on('click',(p:any)=>{
   if(key==='rent-product'&&p.data.entityId)select({view:'orders',filters:{productId:p.data.entityId}});
   if(key==='rent-tenant'&&p.data.entityId)select({view:'orders',filters:{tenantId:p.data.entityId}});
   if(key==='models')select({view:'nodes',filters:{model:p.name}});
   if(key==='tasks')select({view:'queue',filters:{status:p.name}});
   if(key==='capacity'&&p.data.siteId)select({view:'overview',filters:{siteId:p.data.siteId}});
   if((key==='heatmap'||key==='gpu-heatmap'||key==='top-nodes'||key==='thermal')&&p.data.nodeId)select({view:'nodes',nodeId:p.data.nodeId});
   if(key==='regions')select({view:'nodes',filters:{deviceType:'edge',edgeRegion:p.name}});
   if((key==='tokens'||key==='receivables')&&p.data.tenantId)select({view:'billing',tab:key==='tokens'?'usage':'bills',filters:{tenantId:p.data.tenantId}});
   if(key==='priorities'&&p.data.priority)select({view:'queue',filters:{priority:p.data.priority}});
  });
 });updateVisuals(s,c,runId,runtime);
}
export function updateVisuals(s:State,c:Config,runId='',runtime:TelemetryRuntime={playing:true}){if(s.demoNow!==observedTime||runId!==observedRun||(runtime.playing&&!latest?.runtime.playing)){observedTime=s.demoNow;observedRun=runId;lastAdvanceAt=performance.now();}latest={s,c,runId,runtime};liveHistory.observe(s,runId,true);const stats=tokenStats(s,c.tokenSimulation||defaultTokenSimulation(),runtime.playing&&!runtime.maintenance&&!runtime.preview);for(const [id,value] of Object.entries({'token-rate':stats.current.toLocaleString(),'token-average':Math.round(stats.average).toLocaleString(),'token-minute':stats.minute.toLocaleString(),'token-history-label':stats.history.some(p=>p.seeded&&p.time>s.demoNow-60000)?'Tokens · 含历史样本':'Tokens · 滚动窗口','token-engine-state':runtime.preview?'预览冻结':runtime.maintenance?'维护暂停':runtime.playing?'持续产出':'已暂停'})){const el=document.getElementById(id);if(el)el.textContent=value;}registry.forEach((entry,key)=>{if(entry.initialized&&(!entry.visible||document.hidden))return;entry.chart.setOption(options(key,s,c),{replaceMerge:['series','graphic'],lazyUpdate:true,silent:true});entry.initialized=true;});}
export function disposeVisuals(){registry.forEach(({chart,observer,intersection})=>{observer.disconnect();intersection.disconnect();chart.dispose();});registry.clear();}
