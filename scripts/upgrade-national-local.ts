import {DesktopService} from '../electron/service';
import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {metrics,validate} from '../src/store';
import {edgeSummary} from '../src/edge';
// Run only after the target application's normal exit; never patch a live connection.
const root=resolve(process.argv[2]||'');assert.ok(process.argv[2],'Pass the closed application user-data directory');
const file=join(root,'data/caas.sqlite');assert.ok(existsSync(file),'Existing SQLite required');
const beforeFile=process.argv[3]?resolve(process.argv[3]):file;
const read=new DatabaseSync(beforeFile,{readOnly:true});let before:any;
try{assert.equal((read.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok');before=JSON.parse((read.prepare("SELECT json FROM records WHERE key='runtime_state'").get() as any).json);}finally{read.close();}
const backup=beforeFile!==file?beforeFile:join(root,'backups',`before-nationwide-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);mkdirSync(join(root,'backups'),{recursive:true});if(beforeFile===file)copyFileSync(file,backup);
const service=new DesktopService(root,()=>{},false);
try{
 validate(service.state);for(const n of before.nodes){const next=service.state.nodes.find(v=>v.id===n.id);assert.ok(next);for(const key of ['id','name','siteId','gpu','cpu','memory','storage','edgeUnits','status','ip'])assert.deepEqual(next[key],n[key],n.id+'/'+key);}
 for(const [collection,keys] of [['orders',['id','tenantId','productId','quantity','unitPriceCents','start','end','activatedAt','nodeId','status','contractPeriods']],['bills',['id','orderId','tenantId','periodStart','periodEnd','amountCents','paidCents','status']]] as const)for(const row of before[collection]){const next=service.state[collection].find(v=>v.id===row.id);assert.ok(next);for(const key of keys)assert.deepEqual(next[key],row[key],row.id+'/'+key);}
 assert.equal((service.db.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok');
 const report={at:new Date().toISOString(),root,backup,before:{nodes:before.nodes.length,centers:before.sites.filter((v:any)=>v.kind==='center').length},after:{...metrics(service.state),centers:service.state.sites.filter(v=>v.kind==='center').length,edgeRegions:edgeSummary(service.state).regions},originalCapacityAndIdentityPreserved:true,originalFinancialRecordsPreserved:true,sqliteIntegrity:'ok'};
 mkdirSync('output',{recursive:true});writeFileSync('output/local-nationwide-upgrade.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{service.close();}
