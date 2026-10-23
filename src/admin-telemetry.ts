import {dateText,type Row,type State} from './store';
import {esc} from './ui';
import {defaultTelemetryProfile,nodeLoad,regenerateTelemetry,telemetryFields,validateTelemetryProfile,type TelemetryField,type TelemetryProfile} from './telemetry';

const labels:Record<TelemetryField,string>={gpuUtil:'GPU 利用率 %',cpuUtil:'CPU 利用率 %',vramUtil:'显存利用率 %',memoryUtil:'内存利用率 %',storageUtil:'存储利用率 %',temperature:'温度 ℃'};
type EditorHost={modal:(title:string,body:string,confirm?:()=>Promise<void>)=>void;save:(node:Row)=>Promise<void>};
export function telemetryEditor(node:Row,state:State,editable:boolean,host:EditorHost){
 const load=nodeLoad(node,state.instances);
 node.telemetryProfile||=defaultTelemetryProfile(node,load);
 const profile=node.telemetryProfile as TelemetryProfile;
 const input=(value:number,attrs:string)=>`<input type="number" step="0.1" value="${value}" ${attrs} ${editable?'':'disabled'}>`;
 const values=node.samples.map((p:any)=>p.value);
 const chart=`<svg viewBox="0 0 600 100" preserveAspectRatio="none" aria-label="近一小时GPU曲线"><polyline fill="none" stroke="#28cbee" stroke-width="2" points="${values.map((v:number,i:number)=>`${i/Math.max(1,values.length-1)*600},${98-v*.9}`).join(' ')}"/></svg>`;
 const history=node.samples.map((p:any)=>[dateText(p.time),p.value,p.cpuValue??node.cpuUtil,p.vramValue??node.vramUtil,p.memoryValue??node.memoryUtil,p.storageValue??node.storageUtil,p.temperature??node.temperature].join('\t')).join('\n');
 host.modal('遥测设置 · '+node.id,`<p class="telemetry-explainer">波动模式由基准、上下限和实际资源占用生成平滑曲线；固定模式保留输入值。离线节点不产生新样本。保存参数会重建近一小时曲线，业务容量和计费记录保持原值。</p><div class="admin-form"><label class="admin-field">变化模式<select id="tm-mode" ${editable?'':'disabled'}><option ${node.telemetryMode==='动态波动'?'selected':''}>动态波动</option><option ${node.telemetryMode==='固定值'?'selected':''}>固定值</option></select></label><label class="admin-field">变化间隔<select id="tm-interval" ${editable?'':'disabled'}>${[2,4,8,15,30,60].map(v=>`<option value="${v}" ${profile.intervalSeconds===v?'selected':''}>${v} 秒</option>`).join('')}</select></label><label class="admin-field">网络状态<select id="tm-network" ${editable?'':'disabled'}>${['正常','异常','中断'].map(v=>`<option ${node.network===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="admin-field">最后心跳（在线时自动更新）<input id="tm-heartbeat" type="datetime-local" step="1" value="${dateText(node.lastReportAt).replace(' ','T')}" ${editable&&node.status==='离线'?'':'disabled'}></label></div><div class="table-scroll telemetry-ranges"><table><thead><tr><th>指标</th><th>固定值</th><th>波动基准</th><th>下限</th><th>上限</th></tr></thead><tbody>${telemetryFields.map(key=>{const disabled=!node.gpu&&['gpuUtil','vramUtil'].includes(key);return `<tr><td>${labels[key]}</td><td>${input(node[key],`data-current="${key}" ${disabled?'readonly':''}`)}</td>${(['base','min','max'] as const).map(part=>`<td>${input(profile.ranges[key][part],`data-range="${key}" data-part="${part}" ${disabled?'readonly':''}`)}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div><p id="tm-note">波动模式使用基准与范围；固定值模式使用“固定值”列。参数在进入维护后可以修改。</p><div class="telemetry-preview">${chart}</div><details class="telemetry-advanced"><summary>高级：自定义历史曲线（${node.samples.length} 个样本）</summary><p>每行以制表符分隔：时间、GPU%、CPU%、显存%、内存%、存储%、温度。修改下方内容后，将使用这些历史样本，并将最后一个样本同步为当前值。</p><textarea id="tm-history" spellcheck="false" ${editable?'':'disabled'}>${esc(history)}</textarea></details>`,editable?async()=>{
  node.telemetryMode=(document.getElementById('tm-mode') as HTMLSelectElement).value;
  profile.intervalSeconds=Number((document.getElementById('tm-interval') as HTMLSelectElement).value);
  profile.referenceLoad=load;node.network=(document.getElementById('tm-network') as HTMLSelectElement).value;if(node.status==='离线')node.lastReportAt=Date.parse((document.getElementById('tm-heartbeat') as HTMLInputElement).value+'+08:00');
  document.querySelectorAll<HTMLInputElement>('[data-current]').forEach(el=>node[el.dataset.current!]=Number(el.value));
  document.querySelectorAll<HTMLInputElement>('[data-range]').forEach(el=>{profile.ranges[el.dataset.range as TelemetryField][el.dataset.part as 'base'|'min'|'max']=Number(el.value);});
  validateTelemetryProfile(node);
  const raw=(document.getElementById('tm-history') as HTMLTextAreaElement).value;
  if(raw!==history){
   const lines=raw.trim().split(/\r?\n/);if(lines.length<1||lines.length>60)throw Error('历史曲线需要 1～60 个样本');
   node.samples=lines.map((line,i)=>{const cells=line.split('\t');if(cells.length!==7)throw Error(`曲线第 ${i+1} 行需要7列，以制表符分隔`);const [value,cpuValue,vramValue,memoryValue,storageValue,temperature]=cells.slice(1).map(Number),time=Date.parse(cells[0].replace(' ','T')+'+08:00');if(![time,value,cpuValue,vramValue,memoryValue,storageValue,temperature].every(Number.isFinite))throw Error(`曲线第 ${i+1} 行存在无效时间或数字`);return {time,value,cpuValue,vramValue,memoryValue,storageValue,temperature};});
   const last=node.samples.at(-1);Object.assign(node,{gpuUtil:last.value,cpuUtil:last.cpuValue,vramUtil:last.vramValue,memoryUtil:last.memoryValue,storageUtil:last.storageValue,temperature:last.temperature});
  }else regenerateTelemetry(node,state.demoNow,load);
  await host.save(node);
 }:undefined);
 const note=document.getElementById('tm-note')!;
 const update=()=>{const dynamic=(document.getElementById('tm-mode') as HTMLSelectElement).value==='动态波动';document.querySelectorAll<HTMLInputElement>('[data-current]').forEach(el=>el.disabled=!editable||dynamic);document.querySelectorAll<HTMLInputElement>('[data-range]').forEach(el=>el.disabled=!editable||!dynamic);note.textContent=dynamic?'波动模式：按范围生成新样本，历史业务数据保持原值。':'固定模式：固定值与曲线末点自动同步，适合准备精确截图。';};
 document.getElementById('tm-mode')!.addEventListener('change',update);update();
}
