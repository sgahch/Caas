import {enrichProductCatalog,PRODUCT_CATALOG_EVENT} from '../src/product-catalog';
import {enrichModelRoutes,MODEL_ROUTES_EVENT} from '../src/model-usage';
import {enrichNationwide,NATIONWIDE_EVENT} from '../src/nationwide';
import {CORE_CENTERS_EVENT,retainCoreCenters} from '../src/center-policy';
import {cleanupRemovedConfig} from '../src/scenario';
import {enrichDemoGpuModels,GPU_CATALOG_EVENT} from '../src/gpu-catalog';
import {defaultTokenSimulation} from '../src/token-engine';
import {initializeTelemetry} from '../src/telemetry';
import {validateStateShape} from '../src/shape';
import {migrateDatabase,SCHEMA_VERSION} from './migrations';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,unlinkSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual,randomUUID,createHash} from 'node:crypto';
import {seed,clone,validate,metrics,advance,schedule,taskAction,terminateOrder,renew,migrate,handleAlert,fillIdle,collections,type State} from '../src/store';
import {defaultConfig,validateConfig,type Config} from '../src/config';
import {APP_VERSION} from '../src/version';
type Meta={configRevision:number;businessRevision:number;runtimeRevision:number;runId:string;playing:boolean;maintenance:boolean;previousPlaying:boolean};
export type Draft={id:string;draftRevision:number;draftBaseConfigRevision:number;sourceRunId:string;sourceBusinessRevision:number;config:Config;state?:State;savedAt:number};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const LEGACY_TEXT:Record<string,string>={'演示点位':'资源点位','区域示意点，非实测地址':'区域点位','离线演示客户':'客户','模拟设备，不代表真实硬件规格':'算力设备','90 天合同，演示月固定 30 天':'90 天合同，按月固定 30 天','Qwen 推理演示样例':'Qwen 推理样例','演示告警样例':'告警样例','模拟实例':'计算实例','演示镜像':'标准镜像'};
function normalizeLegacy(s:any){if(!s)return;for(const p of s.policies||[])if(p.enabled==='手动演示生效')p.enabled='手动触发生效';for(const k of collections)for(const r of s[k]||[]){if(typeof r.description==='string'&&LEGACY_TEXT[r.description])r.description=LEGACY_TEXT[r.description];if(typeof r.image==='string'&&LEGACY_TEXT[r.image])r.image=LEGACY_TEXT[r.image];if(typeof r.telemetryMode==='string'&&r.telemetryMode==='模拟波动')r.telemetryMode='动态波动';}}
function normalizeLegacyConfig(c:any){if(!c)return;if(c.tenantLabel==='演示租户')c.tenantLabel='租户';if(c.environment==='离线演示环境')c.environment='离线环境';}
export class DesktopService{
 db:DatabaseSync;state:State;baseline:State;config:Config;meta:Meta;draft:Draft|null=null;private timer:any;private stamp=performance.now();private suspended=false;private closed=false;private lastCheckpoint=performance.now();private runtimeDirty=false;
 constructor(public root:string,private changed:()=>void=()=>{},clock=true){
  mkdirSync(join(root,'data'),{recursive:true});mkdirSync(join(root,'backups'),{recursive:true});this.db=new DatabaseSync(join(root,'data','caas.sqlite'));
  this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');const version=(this.db.prepare('PRAGMA user_version').get() as any).user_version;
  if(version>SCHEMA_VERSION){this.db.close();throw Error('数据库来自更高版本，请安装对应版本，不能降级写入');}
  if(version===0){const existing=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();if(existing.length)throw Error('未知数据库格式，保留原文件，停止写入');this.db.exec('BEGIN IMMEDIATE; CREATE TABLE records (key TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE events (id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE command_results (key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL); CREATE TABLE local_admin (id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,hash TEXT NOT NULL); PRAGMA user_version=1; COMMIT;');}
  migrateDatabase(this.db,root,version>0);
  const read=(key:string)=>{const r=this.db.prepare('SELECT json FROM records WHERE key=?').get(key) as any;return r?JSON.parse(r.json):null;};
  this.state=read('runtime_state')||seed(true);this.state.logs=this.db.prepare('SELECT json FROM events ORDER BY rowid DESC LIMIT 2000').all().map((r:any)=>JSON.parse(r.json));this.baseline=read('scenario_baseline')||seed(true);this.config=read('published_config')||defaultConfig();this.meta=read('app_meta')||{configRevision:1,businessRevision:1,runtimeRevision:1,runId:randomUUID(),playing:true,maintenance:false,previousPlaying:true};this.draft=read('cms_draft');normalizeLegacy(this.state);normalizeLegacy(this.baseline);normalizeLegacyConfig(this.config);if(this.draft){normalizeLegacy(this.draft.state);normalizeLegacyConfig(this.draft.config);}validate(this.state);validate(this.baseline);validateConfig(this.config,this.state);
  if(!read('runtime_state'))this.persist();
  const legacy=this.state.nodes.some(n=>!n.telemetryProfile);
  if(legacy){if(read('runtime_state'))this.autoBackup();initializeTelemetry(this.state.nodes,this.state.instances,this.state.demoNow);initializeTelemetry(this.baseline.nodes,this.baseline.instances,this.baseline.demoNow);if(this.draft?.state)initializeTelemetry(this.draft.state.nodes,this.draft.state.instances,this.draft.state.demoNow);if(this.config.refreshSeconds===30){this.config.refreshSeconds=3;(this.meta as any).refreshSeconds=3;}this.meta.configRevision++;this.meta.runtimeRevision++;if(this.draft)this.draft.draftBaseConfigRevision=this.meta.configRevision;this.persist();}
  if(!this.state.processedDemoEventIds.includes(GPU_CATALOG_EVENT)){this.autoBackup();enrichDemoGpuModels(this.state);enrichDemoGpuModels(this.baseline);if(this.draft?.state)enrichDemoGpuModels(this.draft.state);validate(this.state);validate(this.baseline);this.meta.businessRevision++;this.meta.runtimeRevision++;if(this.draft?.state)this.draft.sourceBusinessRevision=this.meta.businessRevision;this.persist();}
  if(!this.state.processedDemoEventIds.includes(PRODUCT_CATALOG_EVENT)||!this.state.processedDemoEventIds.includes(MODEL_ROUTES_EVENT)){this.autoBackup();for(const scene of [this.state,this.baseline,this.draft?.state])if(scene){enrichProductCatalog(scene);enrichModelRoutes(scene);enrichNationwide(scene);}validate(this.state);validate(this.baseline);this.meta.businessRevision++;this.meta.runtimeRevision++;if(this.draft?.state)this.draft.sourceBusinessRevision=this.meta.businessRevision;this.persist();}
  if(!this.state.processedDemoEventIds.includes(NATIONWIDE_EVENT)){this.autoBackup();for(const scene of [this.state,this.baseline,this.draft?.state])if(scene)enrichNationwide(scene);validate(this.state);validate(this.baseline);this.meta.businessRevision++;this.meta.runtimeRevision++;if(this.draft?.state)this.draft.sourceBusinessRevision=this.meta.businessRevision;this.persist();}
  if(!this.state.processedDemoEventIds.includes(CORE_CENTERS_EVENT)){
   this.autoBackup();this.mutate(()=>{
    retainCoreCenters(this.state);retainCoreCenters(this.baseline);cleanupRemovedConfig(this.config,this.state);
    if(this.draft){if(this.draft.state)retainCoreCenters(this.draft.state,false);cleanupRemovedConfig(this.draft.config,this.draft.state||this.state);}
    validate(this.state);validate(this.baseline);validateConfig(this.config,this.state);
    this.meta.businessRevision++;this.meta.runtimeRevision++;this.meta.configRevision++;
    if(this.draft){this.draft.draftBaseConfigRevision=this.meta.configRevision;this.draft.sourceBusinessRevision=this.meta.businessRevision;}
   });
  }
  (this.meta as any).refreshSeconds||=this.config.refreshSeconds;
  this.stamp=performance.now();
  if(clock)this.timer=setInterval(()=>{try{this.pulse();}catch(e){this.meta.playing=false;console.error('计量保存失败',e);this.changed();}},1000);
 }
 private record(key:string,v:any){this.db.prepare('INSERT INTO records(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(v));}
 private persist(extra?:()=>void){this.db.exec('BEGIN IMMEDIATE');try{const {logs,...runtime}=this.state;this.record('runtime_state',runtime);this.record('scenario_baseline',this.baseline);this.record('published_config',this.config);this.record('app_meta',this.meta);this.record('cms_draft',this.draft);this.db.exec('DELETE FROM events');const insert=this.db.prepare('INSERT INTO events(id,json) VALUES (?,?)');for(const e of [...logs].reverse())insert.run(e.id,JSON.stringify(e));extra?.();this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private mutate(fn:()=>any,extra?:()=>void){const old=clone({state:this.state,baseline:this.baseline,config:this.config,meta:this.meta,draft:this.draft});try{const result=fn();this.persist(extra);this.changed();return result;}catch(e){Object.assign(this,old);throw e;}}
 snapshot(){return clone({state:this.state,config:this.config,...this.meta,schemaVersion:SCHEMA_VERSION,appVersion:APP_VERSION});}
 private pulse(){const now=performance.now(),elapsed=Math.floor((now-this.stamp)/1000);if(elapsed<1)return;this.stamp+=elapsed*1000;if(!this.meta.playing||this.meta.maintenance||this.suspended||elapsed>5)return;this.advanceRuntime(elapsed);}
 advanceBy(seconds:number){return this.mutate(()=>{const before=this.state.orders.filter(o=>o.status==='已结束').length;advance(this.state,this.state.demoNow+seconds*1000,this.config.tokenSimulation||defaultTokenSimulation());if(this.state.orders.filter(o=>o.status==='已结束').length!==before)this.meta.businessRevision++;this.meta.runtimeRevision++;});}
 private advanceRuntime(seconds:number){const before=this.state.orders.filter(o=>o.status==='已结束').length;advance(this.state,this.state.demoNow+seconds*1000,this.config.tokenSimulation||defaultTokenSimulation());this.meta.runtimeRevision++;this.runtimeDirty=true;const businessChanged=this.state.orders.filter(o=>o.status==='已结束').length!==before;if(businessChanged){this.meta.businessRevision++;this.persist();this.runtimeDirty=false;}else if(performance.now()-this.lastCheckpoint>=5000){this.checkpoint();}this.changed();}
 private checkpoint(){if(!this.runtimeDirty)return;this.db.exec('BEGIN IMMEDIATE');try{const {logs,...runtime}=this.state;this.record('runtime_state',runtime);this.record('app_meta',this.meta);this.db.exec('COMMIT');this.runtimeDirty=false;this.lastCheckpoint=performance.now();}catch(e){this.db.exec('ROLLBACK');throw e;}}
 suspend(){this.pulse();this.checkpoint();this.suspended=true;this.stamp=performance.now();}resume(){this.suspended=false;this.stamp=performance.now();}
 dispatch(input:any){
  if(!input||typeof input.requestId!=='string'||input.requestId.length>160||input.runId!==this.meta.runId)throw Error('运行版本已变化，请刷新后重试');if(this.meta.maintenance)throw Error('正在维护数据，业务操作已暂停');
  const key=this.meta.runId+':'+input.requestId,fingerprint=digest(input.command),cached=this.db.prepare('SELECT fingerprint,result FROM command_results WHERE key=?').get(key) as any;
  if(cached){if(cached.fingerprint!==fingerprint)throw Error('重复请求编号对应不同操作');return this.snapshot();}this.pulse();if(input.expectedBusinessRevision!==this.meta.businessRevision)throw Error('业务数据已变化，已保留当前选择，请刷新后核对');
  const c=input.command;if(!c||!['task','terminateOrder','renew','migrate','alert','fill','reset','play','refreshSettings'].includes(c.type))throw Error('命令类型无效');if(c.id!==undefined&&typeof c.id!=='string')throw Error('编号参数无效');
  return this.mutate(()=>{switch(c.type){case 'task':taskAction(this.state,c.id,c.action);break;case 'terminateOrder':terminateOrder(this.state,c.id);break;case 'renew':renew(this.state,c.id,c.days);break;case 'migrate':migrate(this.state,c.id,c.target);break;case 'alert':handleAlert(this.state,c.id,c.disposition);break;case 'fill':fillIdle(this.state);break;case 'reset':this.state=clone(this.baseline);this.meta.runId=randomUUID();break;case 'play':if(typeof c.playing!=='boolean')throw Error('播放参数无效');this.meta.playing=c.playing;break;case 'refreshSettings':if(![2,3,5,10,30,60].includes(c.seconds))throw Error('刷新频率无效');(this.meta as any).refreshSeconds=c.seconds;break;}validate(this.state);this.meta.businessRevision++;this.meta.runtimeRevision++;return this.snapshot();},()=>{this.db.prepare('INSERT INTO command_results(key,fingerprint,result) VALUES (?,?,?)').run(key,fingerprint,JSON.stringify({ok:true}));this.db.exec('DELETE FROM command_results WHERE rowid NOT IN (SELECT rowid FROM command_results ORDER BY rowid DESC LIMIT 3000)');});
 }
 hasAdmin(){return !!this.db.prepare('SELECT id FROM local_admin WHERE id=1').get();}
 private password(p:any){if(typeof p!=='string'||p.length<8||p.length>200)throw Error('密码须为 8～200 个字符');}
 login(p:any){this.password(p);const row=this.db.prepare('SELECT salt,hash FROM local_admin WHERE id=1').get() as any;if(!row){const salt=randomBytes(32).toString('hex'),hash=scryptSync(p,salt,64).toString('hex');this.db.prepare('INSERT INTO local_admin(id,salt,hash) VALUES (1,?,?)').run(salt,hash);return true;}if(!timingSafeEqual(Buffer.from(row.hash,'hex'),scryptSync(p,row.salt,64)))throw Error('本地管理员密码错误');return true;}
 changePassword(old:any,next:any){this.login(old);this.password(next);const salt=randomBytes(32).toString('hex');this.db.prepare('UPDATE local_admin SET salt=?,hash=? WHERE id=1').run(salt,scryptSync(next,salt,64).toString('hex'));return true;}
 adminRead(){return {snapshot:this.snapshot(),draft:clone(this.draft),backups:this.backups()};}
 private newDraft():Draft{return {id:randomUUID(),draftRevision:0,draftBaseConfigRevision:this.meta.configRevision,sourceRunId:this.meta.runId,sourceBusinessRevision:this.meta.businessRevision,config:clone(this.config),savedAt:Date.now()};}
 saveDraft(input:any){if(!input||typeof input!=='object')throw Error('草稿参数无效');if(this.draft&&input.draftRevision!==this.draft.draftRevision)throw Error('草稿已更新，请重新载入');if(input.state&&!this.meta.maintenance)throw Error('结构编辑必须先进入维护模式');validateConfig(input.config,input.state||this.state,true);if(input.state)validateStateShape(input.state);if(JSON.stringify(input).length>45*1024*1024)throw Error('草稿过大');return this.mutate(()=>{const d=this.draft||this.newDraft();this.draft={...d,config:clone(input.config),...(input.state?{state:clone(input.state)}:{}),draftRevision:d.draftRevision+1,savedAt:Date.now()};return clone(this.draft);});}
 beginMaintenance(){this.pulse();if(this.meta.maintenance)return this.adminRead();return this.mutate(()=>{this.meta.previousPlaying=this.meta.playing;this.meta.playing=false;this.meta.maintenance=true;this.meta.businessRevision++;this.meta.runtimeRevision++;this.draft=this.draft||this.newDraft();this.draft.state=clone(this.state);this.draft.sourceBusinessRevision=this.meta.businessRevision;this.draft.sourceRunId=this.meta.runId;this.draft.draftRevision++;return this.adminRead();});}
 discard(){return this.mutate(()=>{this.draft=null;if(this.meta.maintenance){this.meta.playing=this.meta.previousPlaying;this.meta.maintenance=false;this.meta.businessRevision++;this.meta.runtimeRevision++;this.stamp=performance.now();}return this.adminRead();});}
 preview(){if(!this.draft)throw Error('没有已保存草稿');const s=clone(this.draft.state||this.state);validate(s);validateConfig(this.draft.config,s);return {snapshot:{...this.snapshot(),state:s,config:this.draft.config,playing:false,preview:true},summary:this.summary(s),draftRevision:this.draft.draftRevision};}
 private summary(next:State){const a=metrics(this.state),b=metrics(next);return {before:a,after:b,records:Object.fromEntries(['nodes','orders','tasks','instances','bills','usage','tokenMeters'].map(k=>[k,{before:(this.state as any)[k].length,after:(next as any)[k].length}]))};}
 applyDraft(input:any){if(!this.draft||input?.draftRevision!==this.draft.draftRevision)throw Error('草稿预览已过期');const d=clone(this.draft);if(d.draftBaseConfigRevision!==this.meta.configRevision)throw Error('配置基准已变化，草稿保留，请重新核对');if(d.state){if(!this.meta.maintenance||d.sourceRunId!==this.meta.runId||d.sourceBusinessRevision!==this.meta.businessRevision)throw Error('维护基准已变化');validate(d.state);if(input.confirm!==true)throw Error('须确认整体场景替换影响');this.autoBackup();}validateConfig(d.config,d.state||this.state);return this.mutate(()=>{if(d.config.refreshSeconds!==this.config.refreshSeconds)(this.meta as any).refreshSeconds=d.config.refreshSeconds;this.config=d.config;if(d.state){this.state=d.state;this.baseline=clone(d.state);this.meta.runId=randomUUID();this.meta.maintenance=false;this.meta.playing=false;this.meta.businessRevision++;}this.meta.configRevision++;this.meta.runtimeRevision++;this.draft=null;this.stamp=performance.now();return this.snapshot();});}
 private payload(){return clone({config:this.config,baseline:this.baseline,state:this.state,draft:this.draft,clock:{playing:this.meta.playing,maintenance:this.meta.maintenance}});}
 exportText(){const payload=this.payload();return JSON.stringify({backupFormatVersion:1,schemaVersion:1,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),payload,assetManifest:{builtinMap:'bc4afc7eacf4351ae5b3ae7a612327987ce1123cb5deb8574fb49107091c6623'},sha256:digest(payload)},null,2);}
 parsePackage(text:string){
  if(Buffer.byteLength(text)>50*1024*1024)throw Error('内容包超过 50 MiB');
  const p=JSON.parse(text);
  // Check the original bytes' payload before applying any compatibility conversion.
  if(p.backupFormatVersion!==1||![1,SCHEMA_VERSION].includes(p.schemaVersion)||p.sha256!==digest(p.payload))throw Error('内容包版本不支持或 SHA-256 损坏');
  if(p.assetManifest?.builtinMap!=='bc4afc7eacf4351ae5b3ae7a612327987ce1123cb5deb8574fb49107091c6623')throw Error('内置地图版本不匹配');
  const v=p.payload;
  if(!v||Object.keys(v).some(k=>!['config','baseline','state','draft','clock'].includes(k)))throw Error('内容包含未知字段');
  validateStateShape(v.state);validateStateShape(v.baseline);
  if(v.draft?.state)validateStateShape(v.draft.state);
  normalizeLegacy(v.state);normalizeLegacy(v.baseline);normalizeLegacyConfig(v.config);
  if(v.draft){normalizeLegacy(v.draft.state);normalizeLegacyConfig(v.draft.config);}
  for(const scene of [v.state,v.baseline,v.draft?.state])if(scene){enrichProductCatalog(scene);enrichModelRoutes(scene);enrichNationwide(scene);}
  retainCoreCenters(v.state);retainCoreCenters(v.baseline);cleanupRemovedConfig(v.config,v.state);
  if(v.draft){if(v.draft.state)retainCoreCenters(v.draft.state,false);cleanupRemovedConfig(v.draft.config,v.draft.state||v.state);}
  validate(v.state);validate(v.baseline);validateConfig(v.config,v.state);
  if(v.draft){validateConfig(v.draft.config,v.draft.state||v.state,true);if(v.draft.state&&JSON.stringify(v.draft.state).length>45*1024*1024)throw Error('草稿过大');}
  return v;
 }
 importSummary(payload:any){return this.summary(payload.state);}
 restore(payload:any){validate(payload.state);validate(payload.baseline);validateConfig(payload.config,payload.state);this.autoBackup();return this.mutate(()=>{this.state=clone(payload.state);this.baseline=clone(payload.baseline);this.config=clone(payload.config);this.meta.runId=randomUUID();this.meta.configRevision++;this.meta.businessRevision++;this.meta.runtimeRevision++;this.meta.playing=false;this.meta.maintenance=!!payload.draft?.state;this.meta.previousPlaying=false;this.draft=payload.draft?clone(payload.draft):null;if(this.draft){this.draft.draftBaseConfigRevision=this.meta.configRevision;this.draft.sourceRunId=this.meta.runId;this.draft.sourceBusinessRevision=this.meta.businessRevision;}this.stamp=performance.now();return this.snapshot();});}
 factory(){this.autoBackup();return this.mutate(()=>{this.state=seed(true);this.baseline=clone(this.state);this.config=defaultConfig();this.draft=null;this.meta={...this.meta,configRevision:this.meta.configRevision+1,businessRevision:this.meta.businessRevision+1,runtimeRevision:this.meta.runtimeRevision+1,runId:randomUUID(),playing:false,maintenance:false};return this.snapshot();});}
 private autoBackup(){const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.caas.json';writeFileSync(join(this.root,'backups',id),this.exportText(),'utf8');const files=this.backups();for(const f of files.slice(3))unlinkSync(join(this.root,'backups',f));}
 backups(){return readdirSync(join(this.root,'backups')).filter(n=>/^[\w.-]+\.caas\.json$/.test(n)).sort().reverse();}
 readBackup(id:string){if(!this.backups().includes(id))throw Error('备份不存在');return this.parsePackage(readFileSync(join(this.root,'backups',id),'utf8'));}
 close(){if(this.closed)return;clearInterval(this.timer);try{this.checkpoint();}finally{this.closed=true;this.db.close();}}
}
