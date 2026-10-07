'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createProviders}=require('../../src/providers.cjs');
const i18n=require('../../shared/i18n.js');

module.exports=async function(ctx,win,child,id){
  const childId=id+':agent:child';
  const originals=[id,childId].map(key=>[key,{...ctx.store.get(key)}]);
  const savedLanguage=process.env.SESSION_PETS_TEST_LANGUAGE;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pet-input-'));
  const received=[];
  const provider=createProviders({dataDir:directory,onEvent:event=>{received.push(event);ctx.store.ingest(event);}});
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async predicate=>{const end=Date.now()+4000;while(!await predicate()){if(Date.now()>end)throw Error('Input indicator did not settle');await delay(30);}};
  const read=target=>target.webContents.executeJavaScript(`(()=>{const node=document.getElementById('pet-attention');return {hidden:node.hidden,label:document.getElementById('pet-attention-label').textContent,opacity:getComputedStyle(node).opacity,hover:document.querySelector('.floating-pet').matches(':hover'),complete:!document.getElementById('pet-completion').hidden}})()`);
  async function send(type,extra={}){
    const count=received.length;
    const proc=spawn('python3',[path.join(ctx.root,'plugins/claude-session-pets/hooks/emit.py')],{env:{...process.env,SESSION_PETS_SOCKET:provider.hookSocketPath,CLAUDE_CODE_ENTRYPOINT:'claude-desktop'},stdio:['pipe','pipe','pipe']});
    proc.stdin.end(JSON.stringify({session_id:id.slice('claude:'.length),hook_event_name:type,tool_name:'AskUserQuestion',tool_use_id:'input-1',...extra}));
    assert.equal(await new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('exit',resolve);}),0);
    await until(()=>received.length>count);
  }
  try{
    await provider.startClaude();
    await send('PreToolUse',{tool_input:{questions:[{question:'private fixture question'}]}});
    await until(async()=>!(await read(win)).hidden);
    win.showInactive();await win.webContents.executeJavaScript('document.activeElement.blur()');win.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});await delay(500);
    let value=await read(win);assert.equal(value.hover,false);assert.equal(value.opacity,'1');assert.equal(value.complete,false);
    for(const language of ['ko','en']){
      process.env.SESSION_PETS_TEST_LANGUAGE=language;ctx.refreshLanguage();
      await until(async()=>(await read(win)).label===i18n.translate(language,'답변 필요'));
      await fs.writeFile(path.join(ctx.root,`work/smoke/attention-${language}.png`),(await win.webContents.capturePage()).toPNG());
    }
    const dispatches=ctx.smokeDispatches.length;
    await win.webContents.executeJavaScript(`document.getElementById('pet-attention').click()`);
    await until(()=>ctx.smokeDispatches.length===dispatches+1);
    assert.equal(ctx.smokeDispatches.pop().url,`claude://code/continue?session=${id.slice('claude:'.length)}`);
    await send('PostToolUse',{tool_name:'Bash',tool_use_id:'other'});assert.equal((await read(win)).hidden,false);
    await send('PostToolUse',{tool_response:{answers:{secret:'private fixture answer'}}});
    await until(async()=>(await read(win)).hidden);
    assert.equal(JSON.stringify(received).includes('private fixture'),false);
    await send('PreToolUse',{tool_name:'ExitPlanMode',tool_use_id:'plan-1'});
    await until(async()=>(await read(win)).label==='Approval needed');
    await send('PostToolUseFailure',{tool_name:'ExitPlanMode',tool_use_id:'plan-1'});
    await until(async()=>(await read(win)).hidden);
    await send('PreToolUse',{agent_id:'child'});
    await until(async()=>!(await read(child)).hidden);assert.equal((await read(win)).hidden,true);
    child.showInactive();child.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});await delay(500);
    await fs.writeFile(path.join(ctx.root,'work/smoke/attention-child.png'),(await child.webContents.capturePage()).toPNG());
    await send('PostToolUse',{agent_id:'child'});await until(async()=>(await read(child)).hidden);
    return {hookToSocketToUI:true,worksWithoutPromptId:true,visibleWithoutHover:true,bilingual:true,clickOpensOriginalSession:true,matchingAnswerClears:true,unrelatedToolDoesNotClear:true,planApprovalDistinct:true,childIsolated:true,questionAndAnswerTextExcluded:true,liveClaudeModelRun:false};
  }finally{
    await provider.stop();await fs.rm(directory,{recursive:true,force:true});
    for(const [key,record] of originals)ctx.store.sessions.set(key,record);
    ctx.store.publish();
    if(savedLanguage===undefined)delete process.env.SESSION_PETS_TEST_LANGUAGE;else process.env.SESSION_PETS_TEST_LANGUAGE=savedLanguage;
    ctx.refreshLanguage();win.hide();child.hide();
  }
};
