import {app,BrowserWindow,ipcMain,protocol,net,Menu,dialog,powerMonitor,nativeImage,session} from 'electron';
import {join,resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {DesktopService} from './service';
protocol.registerSchemesAsPrivileged([{scheme:'caas',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('CaaSDesktop');
// QA profiles are allowed only for unpacked development. Production always shares a fixed identity.
const profile=!app.isPackaged&&process.env.CAAS_TEST_PROFILE;
app.setPath('userData',profile?resolve(profile):join(app.getPath('appData'),'CaaSDesktop'));
app.setAppUserModelId('com.caas.desktop');
let display:BrowserWindow|undefined,admin:BrowserWindow|undefined,service:DesktopService;
const sessions=new Set<number>();let importCandidate:any;
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{display?.restore();display?.focus();});
 app.whenReady().then(()=>{
  mkdirSync(app.getPath('userData'),{recursive:true});
  service=new DesktopService(app.getPath('userData'),()=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('changed');});
  const renderer=resolve(__dirname,'../dist');
  protocol.handle('caas',async request=>{
   const url=new URL(request.url);let relative:string;try{relative=decodeURIComponent(url.pathname);}catch{return new Response('Bad path',{status:400});}
   const target=resolve(renderer,'.'+relative);
   if(url.host!=='app'||request.method!=='GET'||!target.startsWith(renderer+sep))return new Response('Forbidden',{status:403});
   return net.fetch(pathToFileURL(target).href);
  });
  app.on('web-contents-created',(_e,wc)=>{wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-navigate',(e,url)=>{if(!url.startsWith('caas://app/index.html'))e.preventDefault();});});
  session.defaultSession.setPermissionRequestHandler((_a,_b,callback)=>callback(false));
  const handle=(name:string,fn:(...args:any[])=>any,permission:'public'|'admin'|'auth'='public')=>ipcMain.handle(name,async(event,...args)=>{
   try{
    const w=BrowserWindow.fromWebContents(event.sender);const url=new URL(event.senderFrame?.url||'about:blank');
    if(!w||![display,admin].includes(w)||event.senderFrame!==event.sender.mainFrame||url.protocol!=='caas:'||url.host!=='app'||url.pathname!=='/index.html')throw Error('无效窗口来源');
    if(permission!=='public'&&w!==admin)throw Error('仅管理窗口可调用');
    if(permission==='admin'&&!sessions.has(w.id))throw Error('请先登录本地管理员');
    if(JSON.stringify(args).length>52*1024*1024)throw Error('请求超过大小上限');
    return {ok:true,value:await fn(w,...args)};
   }catch(e){return {ok:false,error:(e as Error).message};}
  });
  handle('snapshot',()=>service.snapshot());
  handle('dispatch',(_w,input)=>service.dispatch(input));
  handle('open-admin',()=>{openAdmin();return true;});
  handle('auth-status',w=>({initialized:service.hasAdmin(),authenticated:sessions.has(w.id)}),'auth');
  handle('login',(w,password)=>{service.login(password);sessions.add(w.id);return true;},'auth');
  handle('logout',w=>{sessions.delete(w.id);return true;},'admin');
  handle('password',(_w,oldPassword,newPassword)=>service.changePassword(oldPassword,newPassword),'admin');
  handle('admin-read',()=>service.adminRead(),'admin');
  handle('draft-save',(_w,draft)=>{checkLogo(draft?.config?.logo);return service.saveDraft(draft);},'admin');
  handle('maintenance',()=>service.beginMaintenance(),'admin');
  handle('draft-discard',()=>service.discard(),'admin');
  handle('draft-preview',()=>service.preview(),'admin');
  handle('draft-apply',(_w,input)=>service.applyDraft(input),'admin');
  handle('factory',async w=>{const r=await dialog.showMessageBox(w,{type:'warning',buttons:['取消','恢复出厂内容'],defaultId:0,cancelId:0,message:'将替换自定义配置、场景和草稿；先自动备份，保留管理员。'});if(r.response===1)return service.factory();return null;},'admin');
  handle('export',async w=>{const r=await dialog.showSaveDialog(w,{defaultPath:'CaaS-内容包.caas.json',filters:[{name:'CaaS 内容包',extensions:['json']}]});if(r.canceled)return null;writeFileSync(r.filePath!,service.exportText(),'utf8');return '内容包已导出（含已保存草稿，不含密码）';},'admin');
  handle('import-preview',async w=>{const r=await dialog.showOpenDialog(w,{filters:[{name:'CaaS 内容包',extensions:['json']}],properties:['openFile']});if(r.canceled)return null;const p=r.filePaths[0];if(statSync(p).size>50*1024*1024)throw Error('内容包超过 50 MiB');const data=service.parsePackage(readFileSync(p,'utf8'));checkLogo(data.config.logo);if(data.draft)checkLogo(data.draft.config.logo);importCandidate={id:randomUUID(),data};return {id:importCandidate.id,summary:service.importSummary(importCandidate.data)};},'admin');
  handle('import-apply',(_w,id)=>{if(!importCandidate||id!==importCandidate.id)throw Error('导入预览已过期');const v=service.restore(importCandidate.data);importCandidate=undefined;return v;},'admin');
  handle('backups',()=>service.backups(),'admin');
  handle('backup-preview',(_w,id)=>{const data=service.readBackup(id);importCandidate={id:randomUUID(),data};return {id:importCandidate.id,summary:service.importSummary(data)};},'admin');
  handle('logo',async w=>{const r=await dialog.showOpenDialog(w,{properties:['openFile'],filters:[{name:'Logo 图片',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return null;const p=r.filePaths[0];if(statSync(p).size>5*1024*1024)throw Error('图片超过 5 MiB');const b=readFileSync(p),im=nativeImage.createFromBuffer(b),size=im.getSize();if(im.isEmpty()||size.width>2048||size.height>2048)throw Error('图片无效或尺寸超过 2048×2048');return `data:image/${extname(p).slice(1)==='jpg'?'jpeg':extname(p).slice(1)};base64,${b.toString('base64')}`;},'admin');
  handle('csv',async(w,input)=>{if(!input||typeof input.csv!=='string'||input.csv.length>10*1024*1024)throw Error('CSV 参数无效');const r=await dialog.showSaveDialog(w,{defaultPath:'CaaS-'+String(input.name).replace(/[^a-zA-Z0-9-]/g,'')+'.csv',filters:[{name:'CSV',extensions:['csv']}]});if(r.canceled)return false;writeFileSync(r.filePath!,input.csv,'utf8');return true;});
  const menu=Menu.buildFromTemplate([{label:'CaaS',submenu:[{label:'本地管理后台',accelerator:'CmdOrCtrl+Shift+M',click:()=>openAdmin()},{label:'显示 / 收起操作面板',accelerator:'CmdOrCtrl+Shift+D',click:()=>display?.webContents.send('operator-controls')},{label:'全屏',accelerator:'F11',click:()=>display?.setFullScreen(!display.isFullScreen())},{type:'separator'},{role:'quit',label:'退出应用'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'查看',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}]);Menu.setApplicationMenu(menu);
  display=createWindow(false);
  powerMonitor.on('suspend',()=>service.suspend());powerMonitor.on('resume',()=>service.resume());
 }).catch(e=>{dialog.showErrorBox('CaaS 启动失败',`${e.message}\n原数据库未删除。请保留数据目录并查阅恢复说明。`);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('will-quit',()=>service?.close());
}
function createWindow(isAdmin:boolean){
 const win=new BrowserWindow({width:isAdmin?1280:1600,height:1000,minWidth:900,minHeight:640,title:isAdmin?'CaaS 本地管理后台':'CaaS 算力调度管理平台',backgroundColor:'#071326',show:false,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
 win.once('ready-to-show',()=>win.show());win.loadURL('caas://app/index.html'+(isAdmin?'?admin=1':''));
 if(isAdmin)win.on('closed',()=>{sessions.delete(win.id);admin=undefined;});else win.on('closed',()=>{admin?.close();display=undefined;});return win;
}
function openAdmin(){if(admin&&!admin.isDestroyed()){admin.focus();return;}admin=createWindow(true);}

function checkLogo(logo:any){if(!logo)return;if(typeof logo!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(logo))throw Error('Logo 格式无效');const image=nativeImage.createFromDataURL(logo),size=image.getSize();if(image.isEmpty()||size.width>2048||size.height>2048||Buffer.byteLength(logo.split(',')[1],'base64')>5*1024*1024)throw Error('Logo 无效或超过图片限制');}
