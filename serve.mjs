import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
const port=Number(process.env.CAAS_PORT||4173);
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');const requested=decodeURIComponent(url.pathname);const file=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(await readFile(file));}catch{res.writeHead(404).end('Not found');}}).on('error',err=>{console.error(err.code==='EADDRINUSE'?`Port ${port} is in use. Try another CAAS_PORT.`:err.message);process.exitCode=1;}).listen(port,'127.0.0.1',()=>console.log(`CaaS is ready: http://127.0.0.1:${port}\nPress Ctrl+C to stop.`));
