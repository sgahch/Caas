import type {Row,State} from './store';

// Standard locations are illustrative city positions, never hardware geolocation.
const examples:Record<string,[string,string,number,number]>={
 'EDGE-01':['广东','深圳',114.06,22.55],'EDGE-02':['浙江','杭州',120.16,30.25],
 'EDGE-03':['北京','北京',116.4,39.9],'EDGE-04':['湖北','武汉',114.3,30.59],
 'EDGE-05':['陕西','西安',108.94,34.34],'EDGE-06':['山东','济南',117.12,36.65],
 'EDGE-07':['上海','上海',121.47,31.23],'EDGE-08':['重庆','重庆',106.55,29.56]
};
export function edgeDefaults(node:Row){
 const p=examples[node.id],offsets:Record<string,[number,number]>={'EDGE-01':[22,2],'EDGE-02':[-15,20],'EDGE-03':[-8,-5],'EDGE-04':[-18,-8],'EDGE-05':[-28,-6],'EDGE-06':[20,0],'EDGE-07':[23,-6],'EDGE-08':[22,22]};return {edgeLabelOffsetX:offsets[node.id]?.[0]||0,edgeLabelOffsetY:offsets[node.id]?.[1]||0,edgeRegion:p?.[0]||'',edgeCity:p?.[1]||'',edgeLongitude:p?.[2]||0,edgeLatitude:p?.[3]||0,edgeTenantId:'',edgeProvisionStatus:p?'已纳管':'待接入'};
}
export function edgeLocation(node:Row){
 if(node.deviceType!=='edge')return null;
 const d={...edgeDefaults(node),...node};
 if(!Number.isFinite(d.edgeLongitude)||!Number.isFinite(d.edgeLatitude)||(!d.edgeLongitude&&!d.edgeLatitude))return null;
 return {region:String(d.edgeRegion||'未标注地区'),city:String(d.edgeCity||'未标注城市'),longitude:d.edgeLongitude,latitude:d.edgeLatitude,offsetX:d.edgeLabelOffsetX,offsetY:d.edgeLabelOffsetY};
}
export function validateEdge(node:Row){
 if(node.deviceType!=='edge')return;
 for(const key of ['edgeRegion','edgeCity','edgeTenantId'])if(node[key]!==undefined&&(typeof node[key]!=='string'||node[key].length>160))throw Error(node.id+' 边缘部署信息无效');
 if((node.edgeLongitude===undefined)!==(node.edgeLatitude===undefined))throw Error(node.id+' 边缘部署经纬度须成对填写');
 if(node.edgeLongitude!==undefined&&(!Number.isFinite(node.edgeLongitude)||Math.abs(node.edgeLongitude)>180||!Number.isFinite(node.edgeLatitude)||Math.abs(node.edgeLatitude)>90))throw Error(node.id+' 边缘部署经纬度越界');
 for(const key of ['edgeLabelOffsetX','edgeLabelOffsetY'])if(node[key]!==undefined&&(!Number.isFinite(node[key])||Math.abs(node[key])>300))throw Error(node.id+' 边缘标签偏移须在-300到300像素内');
 if(node.edgeProvisionStatus!==undefined&&!['待接入','已注册','部署中','已纳管','接入异常'].includes(node.edgeProvisionStatus))throw Error(node.id+' 边缘接入阶段无效');
}
export function edgeSummary(s:State){
 const nodes=s.nodes.filter(n=>n.deviceType==='edge'),located=nodes.filter(n=>edgeLocation(n));
 return {total:nodes.length,online:nodes.filter(n=>n.status==='在线').length,located:located.length,regions:new Set(located.map(n=>edgeLocation(n)!.region).filter(r=>r!=='未标注地区')).size,unlocated:nodes.length-located.length};
}

export function edgeMapSelection(s:State,region=''){
 const records=s.nodes.filter(n=>n.deviceType==='edge').map(node=>{
  const d={...edgeDefaults(node),...node};
  return {node,region:String(d.edgeRegion||'未标注地区'),location:edgeLocation(node)};
 });
 const selected=region?records.filter(r=>r.region===region):records;
 return {regions:[...new Set(records.map(r=>r.region))].sort((a,b)=>a.localeCompare(b,'zh-CN')),total:selected.length,online:selected.filter(r=>r.node.status==='在线').length,unlocated:selected.filter(r=>!r.location).length,points:selected.flatMap(r=>r.location?[{node:r.node,...r.location}]:[])};
}
