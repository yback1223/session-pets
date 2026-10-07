'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const i18n=require('../../shared/i18n.js');

module.exports=async function(ctx,win,id){
  const original={...ctx.store.get(id)};
  const savedLanguage=process.env.SESSION_PETS_TEST_LANGUAGE;
  const reducedMotion=ctx.settings.reducedMotion;
  const dispatchCount=ctx.smokeDispatches.length;
  let sequence=1;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const event=(kind,turnId)=>ctx.store.ingest({id:'completion-smoke-'+sequence,provider:'codex',sessionId:id,kind,turnId,generation:1,sequence:sequence++,evidence:'test-fixture',payload:{}});
  const inspect=()=>win.webContents.executeJavaScript(`(()=>{const b=document.getElementById('pet-completion');return{hidden:b.hidden,display:getComputedStyle(b).display,opacity:getComputedStyle(b).opacity,label:b.textContent.trim(),hover:document.querySelector('.floating-pet').matches(':hover'),role:b.getAttribute('role'),emotion:document.body.dataset.emotion,state:document.querySelector('.floating-pet').dataset.state,toolsOpacity:getComputedStyle(document.querySelector('.pet-tools')).opacity}})()`);
  const until=async predicate=>{const end=Date.now()+4000;while(!await predicate()){if(Date.now()>end)throw Error('Completion renderer did not settle');await delay(30);}};
  try{
    // Ordinary observed completion is not a verified result.
    event('turn.started','unverified');event('turn.completed','unverified');
    await until(async()=>(await inspect()).state==='observed');
    assert.equal((await inspect()).hidden,true);
    // Managed mode exists here only as an isolated fixture for the verified completion contract.
    ctx.store.patch(id,{mode:'managed'});
    event('turn.started','verified');event('turn.completed','verified');
    await until(async()=>!(await inspect()).hidden);
    win.showInactive();await win.webContents.executeJavaScript('document.activeElement.blur()');
    win.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});
    await delay(550);
    let badge=await inspect();
    assert.equal(badge.hover,false);assert.equal(badge.opacity,'1');assert.equal(badge.role,'status');assert.equal(badge.toolsOpacity,'0');
    for(const language of ['ko','en']){
      process.env.SESSION_PETS_TEST_LANGUAGE=language;ctx.refreshLanguage();
      const expected=i18n.translate(language,'작업 완료');
      await until(async()=>(await inspect()).label===expected);
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await delay(80);
      await fs.writeFile(path.join(ctx.root,`work/smoke/completion-${language}.png`),(await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
    badge=await inspect();assert.equal(badge.emotion,'dance');assert.equal(badge.hidden,false);assert.equal(badge.state,'done');
    ctx.settings.reducedMotion=true;ctx.store.publish();await delay(60);
    assert.equal((await inspect()).hidden,false);
    assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('pet-completion')).animationName`),'none');
    await win.webContents.executeJavaScript(`document.getElementById('pet-completion-open').click()`);
    await until(async()=>(await inspect()).hidden);
    assert.equal(ctx.store.get(id).state,'done','opening the result preserves completion state');
    assert.equal(ctx.store.get(id).acknowledgedCompletionTurnId,'verified');
    ctx.store.publish();await delay(60);assert.equal((await inspect()).hidden,true,'ordinary updates do not restore read notifications');
    event('turn.started','next');await until(async()=>(await inspect()).hidden);
    assert.equal((await inspect()).state,'working');
    event('turn.completed','verified');await delay(60);assert.equal((await inspect()).hidden,true);
    event('turn.completed','next');await until(async()=>!(await inspect()).hidden);
    await win.webContents.executeJavaScript(`document.getElementById('pet-handle').click()`);
    await until(async()=>(await inspect()).hidden);
    assert.equal(ctx.store.get(id).acknowledgedCompletionTurnId,'next');
    assert.equal(ctx.smokeDispatches.length-dispatchCount,2);
    assert.ok(ctx.smokeDispatches.slice(dispatchCount).every(item=>item.url==='codex://threads/'+id.slice(6)));
    event('turn.started','failed');event('turn.failed','failed');await until(async()=>(await inspect()).state==='error');assert.equal((await inspect()).hidden,true);
    return{visibleWithoutHover:true,hiddenControls:true,explicitCheckAndLabel:true,bilingual:true,emotionIndependent:true,reducedMotion:true,newTurnClears:true,lateCompletionIgnored:true,unverifiedAndFailureNeverComplete:true,badgeOpensAndAcknowledges:true,petOpensAndAcknowledges:true,resultStatePreserved:true,newCompletionNotifiesAgain:true,source:'isolated managed fixture; not a live provider completion'};
  }finally{
    ctx.settings.reducedMotion=reducedMotion;
    ctx.smokeDispatches.splice(dispatchCount);
    ctx.store.sessions.set(id,original);ctx.store.publish();
    if(savedLanguage===undefined)delete process.env.SESSION_PETS_TEST_LANGUAGE;else process.env.SESSION_PETS_TEST_LANGUAGE=savedLanguage;
    ctx.refreshLanguage();win.hide();
  }
};
