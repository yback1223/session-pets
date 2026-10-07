'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createCodexStatus}=require('../../src/codex-status.cjs');

module.exports=async function(ctx,win,id){
 const original={...ctx.store.get(id)},dispatchCount=ctx.smokeDispatches.length;
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pet-question-ui-'));
 const nativeId=id.slice(6),turn='question-ui-turn';
 const file=path.join(directory,'sessions/2026/10/07',`rollout-2026-10-07T00-00-00-${nativeId}.jsonl`);
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{id:nativeId}})+'\n');
 let clock=Date.now();
 const observer=createCodexStatus({codexHome:directory,getSessions:()=>[ctx.store.get(id)],onEvent:e=>ctx.store.ingest(e),now:()=>clock});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async predicate=>{const end=Date.now()+6000;while(!await predicate()){if(Date.now()>end)throw Error('Codex question renderer timed out');await pause(30);}};
 const inspect=()=>win.webContents.executeJavaScript(`({state:document.querySelector('.floating-pet').dataset.state,question:!document.getElementById('pet-attention').hidden,progress:!!document.getElementById('pet-progress'),complete:!document.getElementById('pet-completion').hidden,opacity:getComputedStyle(document.getElementById('pet-attention')).opacity})`);
 const append=async(type,payload)=>{await fs.appendFile(file,JSON.stringify({timestamp:new Date(clock).toISOString(),type,payload})+'\n');await observer.tick();};
 const ask=async(callId,count)=>{await append('response_item',{type:'function_call',name:'request_user_input_async',call_id:callId,arguments:JSON.stringify({questions:Array.from({length:count},()=>({title:'Fixture question',options:['One','Two']}))})});await append('response_item',{type:'function_call_output',call_id:callId,output:'{"accepted":true}'});};
 const reply=async(callId,index)=>append('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'<send_user_message_question_reply>'+JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,index]),answer:'One'}])+'</send_user_message_question_reply>'}]});
 try{
  await append('event_msg',{type:'task_started',turn_id:turn});
  await ask('ui-question',2);
  await until(async()=>(await inspect()).question);
  assert.equal((await inspect()).progress,false);
  win.showInactive();await win.webContents.executeJavaScript('document.activeElement.blur()');win.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});
  await until(async()=>(await inspect()).opacity==='1');
  await until(()=>win.webContents.executeJavaScript('!document.hidden'));
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(80);
  await fs.writeFile(path.join(ctx.root,'work/smoke/codex-question.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('pet-attention').click()`);
  await until(()=>ctx.smokeDispatches.length===dispatchCount+1);
  assert.equal((await inspect()).question,true,'opening the session does not answer the question');
  clock+=120000;await observer.tick();assert.equal(ctx.store.get(id).state,'needs-input');
  await reply('ui-question',0);assert.equal(ctx.store.get(id).pendingRequests.length,1);
  assert.equal((await inspect()).question,true);
  await reply('ui-question',1);await until(async()=>(await inspect()).state==='working');
  assert.equal((await inspect()).question,false);
  await ask('ui-after-complete',1);await append('event_msg',{type:'task_complete',turn_id:turn});
  await until(async()=>(await inspect()).question);
  assert.equal((await inspect()).complete,false);
  await reply('ui-after-complete',0);await until(async()=>(await inspect()).complete);
  assert.equal((await inspect()).question,false);
  return {fileToReaderToStoreToRenderer:true,asyncAcceptanceIsNotAnAnswer:true,openingSessionDoesNotDismiss:true,longWaitRetained:true,partialReplyRetained:true,answerResumesWorking:true,questionOverridesCompletion:true,finalAnswerRestoresCompletion:true,source:'isolated Codex JSONL using real call/reply envelope shapes'};
 }finally{
  await observer.stop();await fs.rm(directory,{recursive:true,force:true});ctx.smokeDispatches.splice(dispatchCount);ctx.store.sessions.set(id,original);ctx.store.publish();win.hide();
 }
};
