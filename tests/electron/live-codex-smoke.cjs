'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createCodexStatus}=require('../../src/codex-status.cjs');
const {createCodexReadState,LOCAL_HOST_KEY}=require('../../src/codex-read-state.cjs');

module.exports=async function(ctx,win,id){
  const original={...ctx.store.get(id)};
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pet-codex-live-'));
  const nativeId=id.slice(6);
  const file=path.join(directory,'sessions/2026/10/07',`rollout-2026-10-07T00-00-00-${nativeId}.jsonl`);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{id:nativeId}})+'\n');
  const observer=createCodexStatus({codexHome:directory,getSessions:()=>[ctx.store.get(id)],onEvent:event=>ctx.store.ingest(event)});
  let readClock=Date.now();
  const readObserver=createCodexReadState({codexHome:directory,getSessions:()=>[ctx.store.get(id)],acknowledgeCompletion:(key,turn)=>ctx.store.acknowledgeCompletion(key,turn),now:()=>readClock});
  const readFile=path.join(directory,'.codex-global-state.json');
  const writeReadState=unread=>fs.writeFile(readFile,JSON.stringify({'electron-thread-read-state-v1':{version:1,unreadByIdentity:{fixture:{[LOCAL_HOST_KEY]:unread}}}}));
  const until=async predicate=>{const end=Date.now()+6000;while(!await predicate()){if(Date.now()>end)throw Error('Live Codex indicator timed out');await new Promise(r=>setTimeout(r,30));}};
  const inspect=()=>win.webContents.executeJavaScript(`({state:document.querySelector('.floating-pet').dataset.state,progress:!!document.getElementById('pet-progress'),complete:!document.getElementById('pet-completion').hidden,hover:document.querySelector('.floating-pet').matches(':hover')})`);
  const append=async(type,turn_id)=>{await fs.appendFile(file,JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type,turn_id}})+'\n');await observer.tick();};
  try{
    await observer.tick();
    await append('task_started','55555555-5555-4555-8555-555555555555');
    await until(async()=>(await inspect()).state==='working');
    win.showInactive();await win.webContents.executeJavaScript('document.activeElement.blur()');win.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});
    await until(()=>win.webContents.executeJavaScript('!document.hidden'));
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await new Promise(resolve=>setTimeout(resolve,80));
    const working=await inspect();assert.equal(working.state,'working');assert.equal(working.hover,false);assert.equal(working.complete,false);
    assert.equal(working.progress,false);
    await fs.writeFile(path.join(ctx.root,'work/smoke/live-codex-working.png'),(await win.webContents.capturePage()).toPNG());
    await append('item_completed','55555555-5555-4555-8555-555555555555');
    assert.equal(ctx.store.get(id).state,'working','an item completion is not a turn completion');
    await append('task_complete','55555555-5555-4555-8555-555555555555');
    await until(async()=>(await inspect()).complete);
    assert.equal((await inspect()).progress,false);
    await until(()=>win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('pet-completion')).opacity==='1'`));
    await fs.writeFile(path.join(ctx.root,'work/smoke/live-codex-complete.png'),(await win.webContents.capturePage()).toPNG());
    await writeReadState([nativeId]);await readObserver.tick();readClock+=2000;await readObserver.tick();
    assert.equal((await inspect()).complete,true,'unread host results retain their badges');
    await writeReadState([]);await readObserver.tick();readClock+=2000;await readObserver.tick();
    await until(async()=>!(await inspect()).complete);
    assert.equal((await inspect()).state,'done','host read state dismisses the notification, not completion');
    await append('task_started','66666666-6666-4666-8666-666666666666');
    await until(async()=>(await inspect()).state==='working');
    assert.equal((await inspect()).complete,false);
    await append('turn_aborted','66666666-6666-4666-8666-666666666666');
    await until(async()=>(await inspect()).state==='idle');
    assert.equal((await inspect()).complete,false);
    return{realFileReaderToStoreToRenderer:true,workingIndicatorRemoved:true,explicitCompletionOnly:true,hostReadStateClearsCompletion:true,hostUnreadRetainsCompletion:true,newTurnClearsCompletion:true,abortDoesNotComplete:true,source:'isolated Codex JSONL and read-state files through production readers'};
  }finally{
    await observer.stop();await readObserver.stop();await fs.rm(directory,{recursive:true,force:true});ctx.store.sessions.set(id,original);ctx.store.publish();win.hide();
  }
};
