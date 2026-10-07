'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pets',{
 call:(action,payload={})=>ipcRenderer.invoke('pets:call',action,payload),
 onState:callback=>{const fn=(_event,state)=>callback(state);ipcRenderer.on('pets:state',fn);return()=>ipcRenderer.removeListener('pets:state',fn);},
 onCursor:callback=>{const fn=(_event,point)=>callback(point);ipcRenderer.on('pets:cursor',fn);return()=>ipcRenderer.removeListener('pets:cursor',fn);}
});
