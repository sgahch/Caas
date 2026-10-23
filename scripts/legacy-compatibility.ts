import {DesktopService} from '../electron/service';
import {validate,metrics} from '../src/store';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const reports=[];
for(const dir of readdirSync('delivery')){
 const path=join('delivery',dir,'CaaS-Standard.caas.json');if(!existsSync(path)||dir==='v'+version)continue;
 const service=new DesktopService(resolve('.qa',`legacy-${version}-${dir}-${Date.now()}`),()=>{},false);
 try{
  service.login('Legacy-Compatibility-2026');
  const payload=service.parsePackage(readFileSync(path,'utf8'));service.restore(payload);validate(service.state);
  const before=metrics(service.state).totalToken;service.advanceBy(2);validate(service.state);assert.ok(metrics(service.state).totalToken>=before);
  assert.equal(service.state.policies[0].enabled,'手动触发生效');assert.ok(service.hasAdmin());
  reports.push({source:path,appVersion:JSON.parse(readFileSync(path,'utf8')).appVersion,passed:true,checks:['checksum and import','restore and validate','dynamic engine advance','local account retained']});
 }finally{service.close();}
}
assert.ok(reports.length>=8);const evidence=`output/playwright/v${version}`;mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'legacy-compatibility.json'),JSON.stringify(reports,null,2));console.log(`${reports.length} legacy content packages passed`);
