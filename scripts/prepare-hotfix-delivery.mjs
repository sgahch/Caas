import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {resolve,join,relative,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import asar from '@electron/asar';
import assert from 'node:assert/strict';

const manifest=JSON.parse(readFileSync('package.json','utf8')),version=manifest.version;
const build=resolve(manifest.build.directories.output),delivery=resolve('delivery',`v${version}`),evidence=resolve(`output/playwright/v${version}`);
const hash=data=>createHash('sha256').update(data).digest('hex'),fileHash=path=>hash(readFileSync(path));
const files=path=>statSync(path).isFile()?[path]:readdirSync(path).sort().flatMap(name=>files(join(path,name)));
function find7zip(path){if(!existsSync(path))return;for(const item of readdirSync(path,{withFileTypes:true})){const file=join(path,item.name);if(item.name==='7za.exe')return file;if(item.isDirectory()){const found=find7zip(file);if(found)return found;}}}
const sevenZip=process.env.CAAS_7ZIP||find7zip(join(process.env.LOCALAPPDATA,'electron-builder/Cache/7zip@1.0.0'));
assert.ok(sevenZip,'7za.exe unavailable');
function run(args,cwd=process.cwd()){
 const result=spawnSync(sevenZip,args,{cwd,windowsHide:true,encoding:'utf8',maxBuffer:5*1024*1024});
 // SFX archives can report a PE-header warning while extracting valid contents.
 assert.ok(result.status===0||result.status===1,result.stdout+'\n'+result.stderr);
}
function copyTree(source,target){if(statSync(source).isDirectory()){mkdirSync(target,{recursive:true});for(const name of readdirSync(source))if(!name.startsWith('failure'))copyTree(join(source,name),join(target,name));}else copyFileSync(source,target);}
function zip(path,inputs,cwd){assert.ok(!existsSync(path),'Refuse to overwrite existing release archive: '+path);run(['a','-tzip','-mx=6',path,...inputs],cwd);run(['t',path]);}

const labels=['centers-unpacked','centers-portable','centers-setup','deletion-unpacked','deletion-portable','deletion-setup','unpacked','portable'];
for(const label of labels){const report=JSON.parse(readFileSync(join(evidence,label,'result.json'),'utf8'));assert.equal(report.version,version);assert.deepEqual(report.errors,[]);assert.ok(report.checks.length>=6);}
const unitLog=readFileSync(`.qa/deletion-v${version}-unit.log`,'utf8');assert.match(unitLog,/# fail 0/);
const unitTests=Number(unitLog.match(/# tests (\d+)/)?.[1]);assert.ok(unitTests>=77);
mkdirSync(join(delivery,'验证记录'),{recursive:true});
const integrity={version,createdAt:new Date().toISOString(),executables:[],embeddedCode:[]};
const officialAsar=join(build,'win-unpacked/resources/app.asar');
assert.equal(JSON.parse(asar.extractFile(officialAsar,'package.json')).version,version);
// electron-builder removes development scripts/build settings from package.json.
const packagedManifest=JSON.parse(asar.extractFile(officialAsar,'package.json'));
for(const key of ['name','version','main'])assert.equal(packagedManifest[key],manifest[key]);
const entries=['desktop/main.cjs','desktop/preload.cjs',...files(resolve('dist')).map(path=>relative(process.cwd(),path).replaceAll('\\','/'))];
for(const name of ['CaaS-Setup-x64.exe','CaaS-Portable-x64.exe']){
 const source=join(build,name),target=join(delivery,name),extract=resolve('.qa',`hotfix-integrity-${version}`,name);
 mkdirSync(extract,{recursive:true});run(['e',source,'resources/app.asar','-o'+extract,'-y']);const archive=join(extract,'app.asar');
 assert.equal(fileHash(archive),fileHash(officialAsar),'Installer and portable must contain the tested build');
 for(const entry of entries)assert.equal(hash(asar.extractFile(archive,join(...entry.split('/')))),fileHash(resolve(entry)),'Stale embedded code: '+entry);
 copyFileSync(source,target);assert.equal(fileHash(source),fileHash(target));
 integrity.executables.push({file:name,bytes:statSync(target).size,sha256:fileHash(target)});
 integrity.embeddedCode.push({file:name,asarSHA256:fileHash(archive),matchesTestedBuild:true});
}
copyFileSync(`docs/RELEASE_NOTES_${version}.md`,join(delivery,'更新说明与操作步骤.md'));
copyFileSync('docs/USER_GUIDE.md',join(delivery,'使用说明.md'));
for(const label of labels)copyTree(join(evidence,label),join(delivery,'验证记录',label));
copyFileSync(`.qa/deletion-v${version}-unit.log`,join(delivery,'验证记录','自动化测试.log'));
writeFileSync(join(delivery,'验证记录','构建完整性.json'),JSON.stringify(integrity,null,2));
writeFileSync(join(delivery,'启动平台.cmd'),'@echo off\r\nstart "" "%~dp0CaaS-Portable-x64.exe"\r\n');
copyFileSync(join(build,'win-unpacked/LICENSE.electron.txt'),join(delivery,'LICENSE.electron.txt'));
copyFileSync(join(build,'win-unpacked/LICENSES.chromium.html'),join(delivery,'LICENSES.chromium.html'));
const licenseDir=join(delivery,'第三方许可');mkdirSync(licenseDir,{recursive:true});
for(const dependency of ['three','echarts','zrender','lucide','tslib'])for(const name of readdirSync(join('node_modules',dependency)).filter(n=>/^(LICENSE|NOTICE|COPYING)/i.test(n)))if(statSync(join('node_modules',dependency,name)).isFile())copyFileSync(join('node_modules',dependency,name),join(licenseDir,dependency+'-'+name));
copyTree('node_modules/echarts/licenses',join(licenseDir,'echarts-licenses'));copyTree('public/maps',join(delivery,'地图许可与数据'));
writeFileSync(join(delivery,'实际测试记录.md'),`# ${version} 验证记录\n\n${unitTests} 项自动化测试通过。已在本机 Windows 11 验证打包程序、免安装 EXE，以及从安装包提取的程序负载：默认仅有南宁/成都/内蒙古三个中心，保留31个边缘区域；后台新增站点、设备与Token任务后，直接点击站点“删除”可一次确认清理关联数据，支持取消；地图连线自动修正，草稿与正式数据隔离，SQLite重启后不再补回。设备直接删除和原有“删除设备及关联”流程均验证通过。\n\n旧数据单元回归验证：旧版13个中心及111节点的正式数据、基线和未完成草稿同步清理，清理前备份，保留本机登录和有效配置；草稿中无关的未完成编辑保留。\n\n打包程序和免安装 EXE 同时通过原有业务冒烟、内容包导入导出、2.6.1 内容包及 SQLite 升级兼容性检查。两个最终 EXE 内嵌代码的哈希与已验证构建一致。\n\n未在其他电脑或物理断网环境测试；安装向导交互未执行，安装包内程序负载已经运行验证。详细结果、界面截图与哈希见“验证记录”。\n`);
const sourceZip=resolve('delivery',`CaaS-v${version}-Source.zip`);
zip(sourceZip,['src','electron','scripts','public','resources','build','docs','README.md','package.json','package-lock.json','index.html','tsconfig.json','tsconfig.electron.json','vite.config.ts','.gitignore'],process.cwd());
writeFileSync(sourceZip+'.sha256',fileHash(sourceZip)+' *'+basename(sourceZip)+'\n');
writeFileSync(join(delivery,'SHA256SUMS.txt'),files(delivery).filter(path=>basename(path)!=='SHA256SUMS.txt').map(path=>fileHash(path)+' *'+relative(delivery,path).replaceAll('\\','/')).join('\n')+'\n');
const bundle=resolve('delivery',`CaaS-v${version}-三中心更新包.zip`);zip(bundle,['.'],delivery);
writeFileSync(bundle+'.sha256',fileHash(bundle)+' *'+basename(bundle)+'\n');
console.log(JSON.stringify({version,directory:delivery,bundle,bytes:statSync(bundle).size,sha256:fileHash(bundle),sourceZip},null,2));
