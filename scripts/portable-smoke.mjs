import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const p=JSON.parse(readFileSync('package.json','utf8'));
const result=spawnSync(process.execPath,['scripts/final-package-test.mjs',process.argv[2]||join(p.build.directories.output,'CaaS-Portable-x64.exe'),'portable'],{stdio:'inherit',windowsHide:true,env:process.env});
process.exitCode=result.status??1;
