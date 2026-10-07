'use strict';
// Managed events exist only in this isolated test; no external session is driven.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const i18n=require('../../shared/i18n.js');

module.exports=async function(ctx){
  const {store,petWindows,linkWindows}=ctx;
  const ids=[1,2,3,4].map(n=>`codex:55555555-5555-4555-8555-55555555555${n}`);
  const [parent,peer,first,second]=ids;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(predicate,label)=>{
    const deadline=Date.now()+6000;
    while(!await predicate()){
      if(Date.now()>deadline)throw Error('Lifecycle check timed out: '+label);
      await delay(30);
    }
  };
  let sequence=0;
  const send=(id,kind,payload={})=>store.ingest({id:'lifecycle-'+(++sequence),provider:'codex',sessionId:id,kind,turnId:id+'-turn',generation:1,sequence,evidence:'test-fixture',payload});
  try{
    store.snapshot([{id:'demo:retired',provider:'demo',pinned:true}]);
    assert.equal(petWindows.has('demo:retired'),false,'old saved examples must not reappear');
    assert.equal(store.get('demo:retired'),undefined);
    store.snapshot([
      {id:parent,provider:'codex',title:'Lifecycle parent',petId:'gorilla',mode:'managed',pinned:true},
      {id:peer,provider:'codex',title:'Lifecycle peer',petId:'tiger',mode:'managed',pinned:true}
    ]);
    send(parent,'turn.started');send(peer,'turn.started');
    for(const [index,id]of [first,second].entries()){
      send(id,'subagent.started',{parentSessionId:parent});
      store.patch(id,{mode:'managed',petId:index?'tiger':'gorilla'});
    }
    await until(()=>petWindows.has(first)&&petWindows.has(second),'children appear');
    assert.notDeepEqual(petWindows.get(first).getPosition(),petWindows.get(second).getPosition());
    send(peer,'message.sent',{receiverSessionId:parent});
    assert.equal(linkWindows.size,1);
    send(first,'subagent.completed');send(second,'subagent.completed');
    await until(()=>!petWindows.has(first)&&!petWindows.has(second),'completed children retire');
    assert.equal(store.get(parent).state,'working','child completion must not complete the parent');
    await until(()=>linkWindows.size===0,'link effect cleans itself up');
    send(parent,'turn.completed');
    const win=petWindows.get(parent);
    const label=i18n.translate(ctx.snapshot().language,'작업 완료');
    await until(()=>win.webContents.executeJavaScript(`document.getElementById('pet-completion-label')?.textContent===${JSON.stringify(label)}`),'parent completion label');
    assert.equal(await win.webContents.executeJavaScript(`document.getElementById('pet-completion').hidden`),false);
    await fs.writeFile(path.join(ctx.root,'work/smoke/completed.png'),(await win.webContents.capturePage()).toPNG());
    return {retiredSessionsIgnored:true,childrenAppearAndRetire:true,parentStateIndependent:true,linkCleanup:true,source:'isolated managed fixture; not a live provider completion'};
  }finally{
    for(const id of ids)store.sessions.delete(id);
    store.publish();
  }
};
