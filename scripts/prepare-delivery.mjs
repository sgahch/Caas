import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,relative,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import asar from '@electron/asar';
import assert from 'node:assert/strict';

const root=process.cwd(),manifest=JSON.parse(readFileSync('package.json','utf8')),version=manifest.version;
assert.match(version,/^\d+\.\d+\.\d+$/);
const build=resolve(manifest.build.directories.output),delivery=resolve('delivery',`v${version}`),evidence=resolve(`output/playwright/v${version}`);
const hash=data=>createHash('sha256').update(data).digest('hex'),fileHash=file=>hash(readFileSync(file));
function find7zip(dir){if(!existsSync(dir))return;for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isFile()&&item.name==='7za.exe')return path;if(item.isDirectory()){const found=find7zip(path);if(found)return found;}}}
const cache=join(process.env.LOCALAPPDATA||'','electron-builder/Cache');
const sevenZip=process.env.CAAS_7ZIP||readdirSync(cache).filter(n=>n.startsWith('7zip@')).map(n=>find7zip(join(cache,n))).find(Boolean);
assert.ok(sevenZip,'Set CAAS_7ZIP to a local 7za.exe from the electron-builder cache');
function run(args,cwd=root){const result=spawnSync(sevenZip,args,{cwd,windowsHide:true,encoding:'utf8',maxBuffer:5*1024*1024});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);}
function files(path){if(statSync(path).isFile())return [path];return readdirSync(path).sort().flatMap(name=>files(join(path,name)));}
function copyTree(source,target,filter=()=>true){if(!filter(source))return;if(statSync(source).isDirectory()){mkdirSync(target,{recursive:true});for(const name of readdirSync(source))copyTree(join(source,name),join(target,name),filter);}else copyFileSync(source,target);}
function newZip(path,inputs,cwd=root){assert.ok(resolve(path).startsWith(resolve('delivery')+'/')||resolve(path).startsWith(resolve('delivery')+'\\'));if(existsSync(path))unlinkSync(path);run(['a','-tzip','-mx=6',path,...inputs],cwd);run(['t',path]);}

for(const name of ['portable','setup']){
 const result=JSON.parse(readFileSync(join(evidence,name,'result.json'),'utf8'));
 assert.equal(result.version,version);assert.equal(result.errors.length,0);assert.ok(result.checks.some(x=>x.includes('actual legacy SQLite')),'Run packaged tests with CAAS_LEGACY_PACKAGE before release');
}
const legacy=JSON.parse(readFileSync(join(evidence,'legacy-compatibility.json'),'utf8'));assert.ok(legacy.length>=8&&legacy.every(r=>r.passed));
assert.equal(JSON.parse(readFileSync(join(evidence,'full-ui-result.json'),'utf8')).errors.length,0);
for(const name of ['commerce','commerce-portable']){const result=JSON.parse(readFileSync(join(evidence,name,'result.json'),'utf8'));assert.equal(result.version,version);assert.equal(result.errors.length,0);assert.ok(result.checks.some(x=>x.includes('restart preserves catalog')));}
for(const name of ['nationwide','nationwide-portable']){const result=JSON.parse(readFileSync(join(evidence,name,'result.json'),'utf8'));assert.equal(result.version,version);assert.equal(result.errors.length,0);assert.equal(result.checks.length,3);}
assert.equal(JSON.parse(readFileSync(join(evidence,'cross-package.json'),'utf8')).checks.length,2);
mkdirSync(delivery,{recursive:true});
const integrity={version,createdAt:new Date().toISOString(),executables:[],embeddedCode:[],sourceTreeSHA256:''};
const officialAsar=join(build,'win-unpacked/resources/app.asar');assert.equal(JSON.parse(asar.extractFile(officialAsar,'package.json')).version,version);
for(const file of ['CaaS-Setup-x64.exe','CaaS-Portable-x64.exe']){
 const src=join(build,file),dst=join(delivery,file);copyFileSync(src,dst);assert.equal(fileHash(src),fileHash(dst));
 const extracted=resolve('.qa',`release-integrity-${version}`,file.includes('Portable')?'portable':'setup');mkdirSync(extracted,{recursive:true});
 run(['e',dst,'resources/app.asar','-o'+extracted,'-y']);const archive=join(extracted,'app.asar');assert.equal(fileHash(archive),fileHash(officialAsar),'Both final EXEs must contain the same app.asar');
 for(const entry of ['desktop/main.cjs','desktop/preload.cjs',...files(resolve('dist')).map(path=>relative(root,path).replaceAll('\\','/'))]){
  const expected=fileHash(resolve(entry)),actual=hash(asar.extractFile(archive,join(...entry.split('/'))));assert.equal(actual,expected,file+' embeds stale '+entry);
 }
 integrity.executables.push({file,sha256:fileHash(dst),bytes:statSync(dst).size});integrity.embeddedCode.push({file,appVersion:JSON.parse(asar.extractFile(archive,'package.json')).version,asarSHA256:fileHash(archive),matchesCurrentBuild:true});
}
const standard=JSON.parse(readFileSync('resources/standard.caas.json','utf8'));assert.equal(standard.appVersion,version);assert.equal(standard.sha256,hash(JSON.stringify(standard.payload)));copyFileSync('resources/standard.caas.json',join(delivery,'CaaS-Standard.caas.json'));copyFileSync('resources/caas-nationwide.sqlite',join(delivery,'全国预置数据.sqlite'));
const docs={'QUICK_START.md':'快速开始.md','USER_GUIDE.md':'使用说明.md','DEMO_GUIDE.md':'演示步骤.md','DATA_FORMAT.md':'数据格式.md','ASSET_SOURCES.md':'素材来源.md','VERIFICATION.md':'实际测试记录.md','CLEAN_MACHINE_TEST.md':'目标环境验证范围.md','dependencies.md':'依赖版本.md','RENTAL_ANALYTICS.md':'租赁与模型用量说明.md',[`RELEASE_NOTES_${version}.md`]:'交付说明.md'};
for(const [source,target] of Object.entries(docs))copyFileSync(join('docs',source),join(delivery,target));
copyTree(evidence,join(delivery,'evidence'),path=>!basename(path).startsWith('failure'));
copyTree('public/maps',join(delivery,'地图许可'),path=>!path.endsWith('.geojson'));
copyFileSync('node_modules/electron/dist/LICENSE',join(delivery,'LICENSE.electron.txt'));
const licenses=join(delivery,'第三方许可');mkdirSync(licenses,{recursive:true});
for(const dependency of ['three','echarts','zrender','lucide','tslib'])for(const file of readdirSync(join('node_modules',dependency)).filter(n=>/^(LICENSE|NOTICE|COPYING)/i.test(n)))if(statSync(join('node_modules',dependency,file)).isFile())copyFileSync(join('node_modules',dependency,file),join(licenses,dependency+'-'+file));
copyTree('node_modules/echarts/licenses',join(licenses,'echarts-licenses'));
writeFileSync(join(delivery,'启动平台.cmd'),'@echo off\r\nstart "" "%~dp0CaaS-Portable-x64.exe"\r\n');
const sources=['src','electron','scripts','public','resources','build','README.md','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.electron.json','vite.config.ts','.gitignore','启动演示.cmd',...Object.keys(docs).map(n=>'docs/'+n)];
const sourceFiles=[...new Set(sources.flatMap(path=>files(resolve(path))))].sort().map(path=>({path:relative(root,path).replaceAll('\\','/'),sha256:fileHash(path)}));
integrity.sourceTreeSHA256=hash(JSON.stringify(sourceFiles));writeFileSync(join(delivery,'evidence/source-manifest.json'),JSON.stringify({version,sourceTreeSHA256:integrity.sourceTreeSHA256,files:sourceFiles},null,2));
writeFileSync(join(delivery,'evidence/artifact-integrity.json'),JSON.stringify(integrity,null,2));
const sourceZip=join(delivery,`CaaS-v${version}-Source.zip`);newZip(sourceZip,sources);
const checksums=files(delivery).filter(path=>basename(path)!=='SHA256SUMS.txt').map(path=>fileHash(path)+' *'+relative(delivery,path).replaceAll('\\','/')).join('\n')+'\n';writeFileSync(join(delivery,'SHA256SUMS.txt'),checksums);
const zip=resolve('delivery',`CaaS-v${version}-交付包.zip`);newZip(zip,['.'],delivery);writeFileSync(zip+'.sha256',fileHash(zip)+' *'+basename(zip)+'\n');
console.log(JSON.stringify({version,directory:delivery,zip,bytes:statSync(zip).size,sha256:fileHash(zip),integrity},null,2));
