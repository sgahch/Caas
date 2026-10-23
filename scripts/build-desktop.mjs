import {build} from 'esbuild';
await build({entryPoints:['electron/main.ts'],outfile:'desktop/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','node:sqlite'],sourcemap:true});
await build({entryPoints:['electron/preload.ts'],outfile:'desktop/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
