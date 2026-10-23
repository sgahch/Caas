import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,metrics,utilization,clone,validate,tick} from './store';
import {defaultConfig} from './config';
import {dashboardData,resourceTrend,siteLoads,LiveResourceHistory,samplingStatus} from './dashboard-data';
import {edgeLocation,edgeSummary,validateEdge,edgeMapSelection} from './edge';

test('edge map province selection includes unlocated devices without plotting invented positions',()=>{
 const s=seed(),before=clone(s),all=edgeMapSelection(s);
 assert.equal(all.total,8);assert.equal(all.online,7);assert.equal(all.points.length,8);assert.equal(all.regions.length,8);
 assert.equal(edgeMapSelection(s,'广东').points[0].node.id,'EDGE-01');
 assert.equal(edgeMapSelection(s,'重庆').online,0);assert.equal(edgeMapSelection(s,'未知').total,0);
 assert.deepEqual(s,before);
 const node=s.nodes.find(n=>n.id==='EDGE-01')!;
 Object.assign(node,{edgeRegion:'福建',edgeCity:'福州',edgeLongitude:0,edgeLatitude:0});
 const selected=edgeMapSelection(s,'福建');assert.equal(selected.total,1);assert.equal(selected.unlocated,1);assert.equal(selected.points.length,0);
 assert.equal(edgeMapSelection(s,'广东').total,0);assert.ok(edgeMapSelection(s).regions.includes('福建'));
 s.nodes=s.nodes.filter(n=>n.deviceType!=='edge');assert.deepEqual(edgeMapSelection(s),{regions:[],total:0,online:0,unlocated:0,points:[]});
});

test('sampling hints distinguish paused, maintenance, preview, startup and stalled clocks',()=>{
 assert.equal(samplingStatus({playing:false},1),'更新已暂停');
 assert.equal(samplingStatus({playing:false,maintenance:true},1),'维护中，更新已暂停');
 assert.equal(samplingStatus({playing:false,preview:true},1),'预览已冻结');
 assert.equal(samplingStatus({playing:true},1),'等待下一个采样点…');
 assert.equal(samplingStatus({playing:true},2),'');
 assert.equal(samplingStatus({playing:true},2,true),'未收到新样本，请检查运行状态');
 assert.equal(samplingStatus({playing:false},2,true),'更新已暂停');
});

test('live charts sample actual weighted loads, retain two minutes and reset on scenario or clock changes',()=>{
 const s=seed(),h=new LiveResourceHistory(),initial=clone(s);
 const first=h.observe(s,'one');assert.equal(first.times.length,1);assert.deepEqual(s,initial);
 h.observe(s,'one');assert.equal(h.snapshot().times.length,1);
 tick(s,2);const second=h.observe(s,'one');assert.equal(second.times.length,2);
 const online=s.nodes.filter(n=>n.status!=='离线');
 const cpu=online.reduce((v,n)=>v+n.cpu*n.cpuUtil,0)/online.reduce((v,n)=>v+n.cpu,0);
 assert.equal(second.series[1].values.at(-1),Math.round(cpu*10)/10);
 for(let i=0;i<70;i++){tick(s,2);h.observe(s,'one');}
 const recent=h.snapshot();assert.equal(recent.times.length,61);assert.equal(recent.times.at(-1)!-recent.times[0],120000);
 h.observe(s,'two');assert.equal(h.snapshot().times.length,1);
 s.demoNow-=10000;h.observe(s,'two');assert.equal(h.snapshot().times.length,1);
 s.nodes[0].status='离线';h.observe(s,'two');assert.equal(h.snapshot().times.length,1);
 const sites=siteLoads(s,defaultConfig());assert.equal(sites.length,3);
 for(const site of sites){const nodes=s.nodes.filter(n=>n.siteId===site.id&&n.status!=='离线');const capacity=nodes.reduce((v,n)=>v+n.gpu,0);assert.equal(site.gpu,Math.round(nodes.reduce((v,n)=>v+n.gpu*n.gpuUtil,0)/capacity*10)/10);}
 s.nodes=[];const empty=h.observe(s,'empty');assert.ok(empty.series.every(v=>v.values[0]===null));
 assert.ok(siteLoads(s,defaultConfig()).every(v=>v.gpu===null&&v.cpu===null));
});

test('dashboard aggregates conserve GPU, task counts, Token and billed money without changing state',()=>{
 const s=seed(),before=clone(s),d=dashboardData(s,defaultConfig()),m=metrics(s);
 assert.equal(d.models.reduce((v,r)=>v+r.value,0),m.gpu);
 assert.equal(d.sites.reduce((v,r)=>v+r.allocated,0),m.allocated);
 assert.equal(d.sites.reduce((v,r)=>v+r.free,0),m.gpu-m.allocated);
 assert.equal(d.tasks.reduce((v,r)=>v+r.value,0),s.tasks.length);
 assert.equal(d.tenants.reduce((v,r)=>v+r.token,0),m.token);
 assert.equal(d.tenants.reduce((v,r)=>v+r.paid+r.due,0),s.bills.reduce((v,b)=>v+b.amountCents,0)/100);
 assert.deepEqual(s,before);
 const trend=resourceTrend(s);assert.equal(trend.times.length,60);
 assert.ok(Math.abs(trend.series[0].values.at(-1)!-utilization(s,'gpuUtil'))<=.05);
 assert.ok(trend.series.every(v=>v.values.every(n=>n===null||(n>=0&&n<=100))));
});
test('distributed edge locations support legacy defaults, custom positions, unlocated and zero devices',()=>{
 const s=seed();assert.deepEqual(edgeSummary(s),{total:8,online:7,located:8,regions:8,unlocated:0});
 const node=s.nodes.find(n=>n.id==='EDGE-01')!;delete node.edgeRegion;delete node.edgeCity;delete node.edgeLongitude;delete node.edgeLatitude;
 assert.equal(edgeLocation(node)?.city,'深圳');
 Object.assign(node,{edgeRegion:'四川',edgeCity:'成都',edgeLongitude:104.06,edgeLatitude:30.67});validate(s);
 assert.equal(edgeLocation(node)?.region,'四川');
 node.edgeLongitude=181;assert.throws(()=>validate(s),/经纬度越界/);node.edgeLongitude=0;node.edgeLatitude=0;
 assert.equal(edgeLocation(node),null);assert.equal(edgeSummary(s).unlocated,1);
 assert.equal(edgeLocation({...node,id:'EDGE-CUSTOM',edgeLongitude:undefined,edgeLatitude:undefined}),null);
 const empty=clone(s);empty.nodes=[];empty.tasks=[];empty.tokenMeters=[];empty.instances=[];empty.bills=[];
 assert.equal(edgeSummary(empty).total,0);assert.deepEqual(resourceTrend(empty),{times:[],series:[{name:'GPU',values:[]},{name:'CPU',values:[]},{name:'内存',values:[]}]});
 assert.deepEqual(dashboardData(empty,defaultConfig()).models,[]);assert.doesNotThrow(()=>validateEdge({id:'legacy',deviceType:'edge'}));
});
