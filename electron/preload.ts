import {contextBridge,ipcRenderer} from 'electron';
const invoke=(name:string)=>(...args:unknown[])=>ipcRenderer.invoke(name,...args).then(r=>{if(!r.ok)throw Error(r.error);return r.value;});
contextBridge.exposeInMainWorld('caas',Object.freeze({
 snapshot:invoke('snapshot'),dispatch:invoke('dispatch'),openAdmin:invoke('open-admin'),authStatus:invoke('auth-status'),login:invoke('login'),logout:invoke('logout'),changePassword:invoke('password'),
 adminRead:invoke('admin-read'),saveDraft:invoke('draft-save'),beginMaintenance:invoke('maintenance'),discardDraft:invoke('draft-discard'),preview:invoke('draft-preview'),applyDraft:invoke('draft-apply'),
 exportPackage:invoke('export'),chooseImport:invoke('import-preview'),confirmImport:invoke('import-apply'),backups:invoke('backups'),previewBackup:invoke('backup-preview'),factory:invoke('factory'),chooseLogo:invoke('logo'),exportCsv:invoke('csv'),
 onOperatorToggle:(listener:()=>void)=>{const fn=()=>listener();ipcRenderer.on('operator-controls',fn);return()=>ipcRenderer.removeListener('operator-controls',fn);},
 onChanged:(listener:()=>void)=>{const fn=()=>listener();ipcRenderer.on('changed',fn);return()=>ipcRenderer.removeListener('changed',fn);}
}));
