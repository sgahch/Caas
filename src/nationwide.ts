import type {State,Row} from './store';
import {edgeDefaults} from './edge';
import {initializeTelemetry} from './telemetry';

export const NATIONWIDE_EVENT='catalog:nationwide-v1';
// City positions and capacity are local demonstration inventory, not verified deployments.
export const provincialEdges:[string,string,number,number][]=[
 ['天津','天津',117.2,39.12],['河北','石家庄',114.51,38.04],['山西','太原',112.55,37.87],
 ['内蒙古','呼和浩特',111.67,40.82],['辽宁','沈阳',123.43,41.8],['吉林','长春',125.32,43.82],
 ['黑龙江','哈尔滨',126.63,45.75],['江苏','南京',118.8,32.06],['安徽','合肥',117.23,31.82],
 ['福建','福州',119.3,26.08],['江西','南昌',115.86,28.68],['河南','郑州',113.63,34.75],
 ['湖南','长沙',112.94,28.23],['广西','南宁',108.32,22.82],['海南','海口',110.2,20.04],
 ['四川','成都',104.06,30.67],['贵州','贵阳',106.63,26.65],['云南','昆明',102.83,24.88],
 ['西藏','拉萨',91.13,29.65],['甘肃','兰州',103.83,36.06],['青海','西宁',101.78,36.62],
 ['宁夏','银川',106.23,38.49],['新疆','乌鲁木齐',87.62,43.83]
];
export function enrichNationwide(s:State){
 if(s.processedDemoEventIds.includes(NATIONWIDE_EVENT))return false;
 const edgeTemplate=s.nodes.find(n=>n.deviceType==='edge');
 const edgeSite=s.sites.find(n=>n.kind==='edge');
 const added:Row[]=[];
 const makeNode=(template:Row,id:string,siteId:string,model:string,gpu:number,edge=false)=>{
  const n:Row={...structuredClone(template),id,name:id,siteId,model,gpu,cpu:edge?32:gpu===1?64:192,memory:edge?125:gpu===1?128:768,storage:edge?2000:gpu===1?4000:12000,edgeUnits:edge?8:0,status:'在线',network:'正常',lastReportAt:s.demoNow,allocated:0,gpuUtil:gpu?66:0,cpuUtil:42,memoryUtil:46,storageUtil:32,vramUtil:gpu?58:0,temperature:edge?39:53,telemetryMode:'固定值',samples:[],description:'全国资源预置样例，可在后台维护'};
  delete n.telemetryProfile;
  n.samples=Array.from({length:60},(_,i)=>({time:s.demoNow-(59-i)*60000,value:gpu?66:0,cpuValue:42,memoryValue:46,storageValue:32,vramValue:gpu?58:0}));
  s.nodes.push(n);added.push(n);return n;
 };
 if(edgeTemplate&&edgeSite)for(const [index,[region,city,longitude,latitude]] of provincialEdges.entries()){
  if(s.nodes.some(n=>n.deviceType==='edge'&&n.edgeRegion===region))continue;
  const id=`EDGE-N-${String(index+1).padStart(2,'0')}`;if(s.nodes.some(n=>n.id===id))continue;
  const n=makeNode(edgeTemplate,id,edgeSite.id,'边缘算力芯片',0,true);
  Object.assign(n,edgeDefaults({id}),{edgeRegion:region,edgeCity:city,edgeLongitude:longitude,edgeLatitude:latitude,edgeProvisionStatus:'已纳管',edgeTenantId:s.tenants[index%s.tenants.length]?.id||'',ip:`10.80.0.${index+1}`});
 }
 initializeTelemetry(added,s.instances,s.demoNow);
 s.processedDemoEventIds.push(NATIONWIDE_EVENT);return true;
}
