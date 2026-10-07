'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
module.exports=async function(ctx,codex,claude,aid,bid){
  const previous=process.env.SESSION_PETS_TEST_HOST_LANGUAGES;
  const originalState=ctx.store.get(aid).state;
  const before=JSON.stringify(ctx.store.list());
  const wasVisible=codex.isVisible();
  let languageFile;
  const until=async predicate=>{const end=Date.now()+6000;while(!await predicate()){if(Date.now()>end)throw Error('Host language UI timed out');await new Promise(r=>setTimeout(r,30));}};
  const language=win=>win.webContents.executeJavaScript('document.documentElement.lang');
  const prepare=async()=>JSON.parse((await exec('python3',[path.join(ctx.root,'scripts/pet.py'),'prepare-language','--provider','codex','--socket',ctx.control.socketPath,'--no-launch'],{env:{...process.env,CODEX_THREAD_ID:aid.slice(6)},maxBuffer:300000})).stdout);
  await ctx.control.start();
  try{
    process.env.SESSION_PETS_TEST_HOST_LANGUAGES=JSON.stringify({codex:'ko-KR',claude:'en-US'});ctx.refreshLanguage();
    await until(async()=>await language(codex)==='ko'&&await language(claude)==='en');
    assert.equal(await codex.webContents.executeJavaScript(`document.getElementById('pet-library').getAttribute('aria-label')`),'펫 바꾸기');
    assert.equal(await claude.webContents.executeJavaScript(`document.getElementById('pet-library').getAttribute('aria-label')`),'Change pet');
    process.env.SESSION_PETS_TEST_HOST_LANGUAGES=JSON.stringify({codex:'ar-SA',claude:'ko-KR'});ctx.refreshLanguage();
    const pending=await prepare();assert.equal(pending.translationReady,false);assert.equal(pending.locale,'ar-SA');
    const request=pending.translationRequest;languageFile=request.catalogPath;
    // Complete fixture for transport checks; selected visible labels are translated for RTL layout.
    const messages={...request.messages,'펫 소환':'استدعاء حيوان أليف','답변 필요':'يلزم الرد','눌러서 세션 열기':'انقر لفتح الجلسة','상태 미확인':'الحالة غير معروفة','펫 바꾸기':'تغيير الحيوان الأليف'};
    await fs.writeFile(languageFile,JSON.stringify({version:1,locale:request.locale,messages}));
    assert.equal((await prepare()).translationReady,true);
    await until(async()=>await language(codex)==='ar-SA'&&await language(claude)==='ko');
    assert.equal(await codex.webContents.executeJavaScript('document.documentElement.dir'),'rtl');
    assert.equal(await claude.webContents.executeJavaScript('document.documentElement.dir'),'ltr');
    ctx.store.patch(aid,{state:'needs-input'});
    await until(()=>codex.webContents.executeJavaScript(`document.getElementById('pet-attention-label').textContent==='يلزم الرد'`));
    codex.showInactive();
    await until(()=>codex.webContents.executeJavaScript(`getComputedStyle(document.getElementById('pet-attention')).opacity==='1'`));
    const overflow=await codex.webContents.executeJavaScript(`({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].map(e=>{const r=e.getBoundingClientRect();return{id:e.id,tag:e.tagName,cls:e.className,left:r.left,right:r.right,width:r.width,visibility:getComputedStyle(e).visibility};}).filter(e=>e.left<-.5||e.right>innerWidth+.5)})`);
    assert.ok(overflow.scroll<=overflow.width,JSON.stringify(overflow));
    const clippedText=await codex.webContents.executeJavaScript(`[...document.querySelectorAll('.pet-attention,.attention-copy,.floating-caption,.floating-title')].filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight;}).map(e=>e.className)`);
    assert.deepEqual(clippedText,[],'RTL labels remain fully inside the window');
    await fs.writeFile(path.join(ctx.root,'work/smoke/host-language-rtl.png'),(await codex.webContents.capturePage()).toPNG());
    const picker=ctx.openPicker(aid);
    try{
      await until(async()=>!picker.webContents.isLoading()&&await language(picker)==='ar-SA');
      assert.equal(await picker.webContents.executeJavaScript('document.documentElement.dir'),'rtl');
      assert.equal(await picker.webContents.executeJavaScript(`document.getElementById('picker-previous').getBoundingClientRect().x<document.getElementById('picker-next').getBoundingClientRect().x`),true,'carousel arrows keep their physical direction');
    }finally{picker.close();}
    assert.equal((await prepare()).translationRequest,undefined,'reuse the existing catalog');
    ctx.store.patch(aid,{state:originalState});
    assert.equal(JSON.stringify(ctx.store.list()),before,'localization preserves the sessions');
    return{differentHostLanguages:true,liveChanges:true,pythonPreparation:true,completeCatalogRequired:true,cachedCatalogReused:true,rtl:true,rtlPicker:true,osPreferencesChanged:false,translationQuality:'selected fixture labels only; no all-language quality claim'};
  }finally{
    ctx.store.patch(aid,{state:originalState});
    if(wasVisible)codex.showInactive();else codex.hide();
    await ctx.control.stop();
    if(languageFile)await fs.unlink(languageFile);
    if(previous===undefined)delete process.env.SESSION_PETS_TEST_HOST_LANGUAGES;else process.env.SESSION_PETS_TEST_HOST_LANGUAGES=previous;
    ctx.refreshLanguage();
    await until(async()=>await language(codex)===ctx.snapshot(aid).language&&await language(claude)===ctx.snapshot(bid).language);
  }
};
