import * as THREE from 'three';
import {geoToWorld,polygonShape} from './geo';
import {edgeMapSelection} from './edge';
import {type State} from './store';
import {type Config,siteName,code} from './config';
export type MapView={dispose:()=>void;setRegion:(region:string)=>void;update:(state:State)=>void};
export function mountMap(host:HTMLElement,onSelect:(center:string,nodeId?:string)=>void,state:State,config:Config):MapView{
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let disposed=false,frame=0;const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(35,1,.1,500);camera.position.set(0,-45,53);camera.lookAt(0,1,0);camera.zoom=1.35;camera.updateProjectionMatrix();
 let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{host.innerHTML='<div class="map-fallback">当前环境未启用 WebGL，请启用硬件加速后查看 3D 地图。</div>';return {dispose:()=>{host.innerHTML='';},setRegion:()=>{},update:()=>{}};}
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.appendChild(renderer.domElement);scene.add(new THREE.AmbientLight(0x8ac8ff,2));const light=new THREE.DirectionalLight(0x55cfff,4);light.position.set(-20,-10,40);scene.add(light);
 const group=new THREE.Group();scene.add(group);const project=geoToWorld;
 const grid=new THREE.GridHelper(75,35,0x184368,0x102841);grid.rotation.x=Math.PI/2;grid.position.z=-1;scene.add(grid);
 const base=new THREE.Mesh(new THREE.RingGeometry(23,23.07,100),new THREE.MeshBasicMaterial({color:0x208cb8,transparent:true,opacity:.35}));base.scale.y=.65;base.position.z=-.8;scene.add(base);
 const motes:{mesh:THREE.Mesh;curve:THREE.QuadraticBezierCurve3;phase:number;speed:number}[]=[];const labels:{el:HTMLButtonElement;p:THREE.Vector3;ring:THREE.Mesh;marker:THREE.Group}[]=[];
 const centers=state.sites.filter(site=>site.kind!=='edge');
 const markers=[...centers.map(site=>{const p=config.sites[site.id]||site;return {id:site.id,nodeId:'',title:siteName(config,state,site.id),region:'',longitude:p.longitude,latitude:p.latitude,edge:false,offline:false,count:state.nodes.filter(n=>n.siteId===site.id).length,offsetX:p.offsetX||0,offsetY:p.offsetY||0};}),...edgeMapSelection(state).points.map(p=>({id:p.node.siteId,nodeId:p.node.id,title:p.city,region:p.region,longitude:p.longitude,latitude:p.latitude,edge:true,offline:p.node.status!=='在线',count:1,offsetX:p.offsetX,offsetY:p.offsetY}))];
 markers.forEach(item=>{
  const p=project([item.longitude,item.latitude]);p.z=1.6;
  const color=item.edge?0xb484ff:0x31deff,marker=new THREE.Group();marker.position.copy(p);group.add(marker);
  const body=new THREE.Mesh(item.edge?new THREE.SphereGeometry(.18,12,8):new THREE.BoxGeometry(.7,.7,1.6),new THREE.MeshStandardMaterial({color:item.edge?0x7950c8:0x147cae,emissive:color,emissiveIntensity:item.offline?.05:.4,metalness:.6,roughness:.3}));body.position.z=item.edge?.25:.8;marker.add(body);
  const ring=new THREE.Mesh(new THREE.RingGeometry(item.edge?.28:.95,item.edge?.34:1.08,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:item.offline?.18:.8,side:THREE.DoubleSide}));ring.position.z=.04;marker.add(ring);
  const el=document.createElement('button');el.className=item.edge?'map-edge-dot'+(item.offline?' offline':''):'map-label';
  if(item.edge){
   el.dataset.edgeNode=item.nodeId;el.dataset.edgeRegion=item.region;
   el.title=`${item.region} · ${item.title} · ${code(config,'nodes',item.nodeId)} · ${item.offline?'离线 / 异常':'在线'}`;el.setAttribute('aria-label',el.title);
   const caption=document.createElement('span');caption.className='edge-pin-caption';caption.textContent=item.title+' · '+code(config,'nodes',item.nodeId);caption.style.marginLeft=item.offsetX+'px';caption.style.marginTop=item.offsetY+'px';el.append(caption);
  }else{el.textContent=item.title;const count=document.createElement('small');count.textContent=item.count+' '+(config.copy['节点']||'节点');el.append(count);}
  el.onclick=()=>onSelect(item.id,item.nodeId||undefined);host.append(el);labels.push({el,p:p.clone().add(new THREE.Vector3(0,0,item.edge?.25:1.8)),ring,marker});
 });
 const setRegion=(region:string)=>{host.dataset.edgeRegion=region;labels.forEach(({el,marker},i)=>{const visible=!markers[i].edge||!region||markers[i].region===region;marker.visible=visible;el.hidden=!visible;});};
 centers.forEach(site=>{const target=centers.find(s=>s.id===(config.sites[site.id]?.routeTo||site.routeTo));if(!target||target.id===site.id)return;const a=config.sites[site.id]||site,b=config.sites[target.id]||target;const start=project([a.longitude,a.latitude]);start.z=2;const end=project([b.longitude,b.latitude]);end.z=2;const mid=start.clone().lerp(end,.5);mid.z=6;const curve=new THREE.QuadraticBezierCurve3(start,mid,end);group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,48,.02,5,false),new THREE.MeshBasicMaterial({color:0x5defff,transparent:true,opacity:.65})));const mote=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),new THREE.MeshBasicMaterial({color:0xc0ffff}));group.add(mote);motes.push({mesh:mote,curve,phase:motes.length*.23,speed:.00032});});
 // Edge ingress traces share the actual configured locations and online state.
 markers.filter(m=>m.edge&&!m.offline).forEach((item,index)=>{const target=centers[index%centers.length];if(!target)return;const center=config.sites[target.id]||target,start=project([item.longitude,item.latitude]),end=project([center.longitude,center.latitude]);start.z=1.8;end.z=2;const mid=start.clone().lerp(end,.5);mid.z=4+index%3;const curve=new THREE.QuadraticBezierCurve3(start,mid,end);group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,32,.012,4,false),new THREE.MeshBasicMaterial({color:0x967ce8,transparent:true,opacity:.27})));for(let i=0;i<2;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.065,6,5),new THREE.MeshBasicMaterial({color:0xcab7ff}));group.add(mesh);motes.push({mesh,curve,phase:index*.17+i*.5,speed:.00028});}});
 const update=(next:State)=>{labels.forEach(({el,ring,marker},i)=>{const item=markers[i],nodes=next.nodes.filter(n=>item.nodeId?n.id===item.nodeId:n.siteId===item.id),online=nodes.filter(n=>n.status!=='离线'),gpu=nodes.reduce((sum,n)=>sum+n.gpu,0),capacity=online.reduce((sum,n)=>sum+(n.gpu||n.cpu),0),load=capacity?online.reduce((sum,n)=>sum+(n.gpu||n.cpu)*(n.gpu?n.gpuUtil:n.cpuUtil),0)/capacity:0;item.offline=!online.length;el.title=`${item.title} · ${online.length}/${nodes.length} 在线 · ${gpu} GPU · 负载 ${load.toFixed(1)}%`;el.classList.toggle('offline',item.offline);(ring.material as THREE.MeshBasicMaterial).opacity=item.offline?.15:.4+load/200;const body=marker.children[0] as THREE.Mesh;(body.material as THREE.MeshStandardMaterial).emissiveIntensity=item.offline?.05:.25+load/200;});};update(state);
 fetch(`${import.meta.env.BASE_URL}maps/china-adm1.geojson`).then(r=>r.json()).then(geo=>{if(disposed)return;for(const feature of geo.features){const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];for(const polygon of polygons){if(!polygon[0]?.length)continue;const shape=polygonShape(polygon);if(!shape)continue;const geometry=new THREE.ExtrudeGeometry(shape,{depth:1.5,bevelEnabled:false});const material=[new THREE.MeshStandardMaterial({color:0x123d67,metalness:.55,roughness:.4}),new THREE.MeshStandardMaterial({color:0x087fa6,emissive:0x06415c,emissiveIntensity:.5})];group.add(new THREE.Mesh(geometry,material));for(const ring of polygon){const points=ring.map((p:number[])=>{const v=project(p);v.z=1.54;return v;});group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x39caff,transparent:true,opacity:.85})));}}}}).catch(()=>{if(disposed)return;const note=document.createElement('span');note.className='map-error';note.textContent='地图数据载入失败，请重启客户端检查随包资源';host.appendChild(note);});
 const positionLabels=()=>{
  const w=host.clientWidth,h=host.clientHeight,placed:{x:number;y:number;width:number;height:number}[]=[];
  for(const [i,{el,p}] of labels.entries()){
   const v=p.clone().project(camera),item=markers[i];el.style.visibility=Math.abs(v.x)>1||Math.abs(v.y)>1?'hidden':'visible';
   let x=(v.x*.5+.5)*w+(item.edge?0:item.offsetX),y=(-v.y*.5+.5)*h+(item.edge?0:item.offsetY);
   if(!item.edge){
    const width=el.offsetWidth,height=el.offsetHeight;
    // Dense national sites keep clickable labels separate at all supported sizes.
    const candidates=[[0,0]];for(let r=1;r<=7;r++)for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,1],[-1,1],[1,-1]])candidates.push([dx*r*26,dy*r*23]);
    let best={x:Math.max(4,Math.min(w-width-4,x-width/2)),y:Math.max(4,Math.min(h-height-4,y-height))},score=Infinity;
    for(const [dx,dy] of candidates){const box={x:Math.max(4,Math.min(w-width-4,x-width/2+dx)),y:Math.max(4,Math.min(h-height-4,y-height+dy)),width,height};const overlap=placed.reduce((a,b)=>a+Math.max(0,Math.min(box.x+width+3,b.x+b.width)-Math.max(box.x-3,b.x))*Math.max(0,Math.min(box.y+height+3,b.y+b.height)-Math.max(box.y-3,b.y)),0);const cost=overlap*10000+dx*dx+dy*dy;if(cost<score){score=cost;best=box;}}
    placed.push({...best,width,height});x=best.x+width/2;y=best.y+height;
   }
   el.style.marginLeft='0px';el.style.marginTop='0px';el.style.left=x+'px';el.style.top=y+'px';
  }
 };
 const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();positionLabels();};const ro=new ResizeObserver(resize);ro.observe(host);resize();
 function animate(time:number){if(disposed)return;if(document.hidden)return;frame=requestAnimationFrame(animate);labels.forEach(({ring},i)=>ring.scale.setScalar(1+(reduced||markers[i].offline?0:Math.sin(time*.003+i)*.25)));motes.forEach(({mesh,curve,phase,speed})=>mesh.position.copy(curve.getPoint(reduced?.5:(time*speed+phase)%1)));renderer.render(scene,camera);}frame=requestAnimationFrame(animate);const visibility=()=>{cancelAnimationFrame(frame);if(!document.hidden)frame=requestAnimationFrame(animate);};document.addEventListener('visibilitychange',visibility);
 return {setRegion,update,dispose:()=>{disposed=true;document.removeEventListener('visibilitychange',visibility);cancelAnimationFrame(frame);ro.disconnect();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});renderer.dispose();host.innerHTML='';}};
}
