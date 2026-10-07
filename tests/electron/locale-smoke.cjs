'use strict';
// Only the app's isolated smoke process is reconfigured; never modify OS preferences.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const i18n=require('../../shared/i18n.js');

module.exports=async function(ctx,pet,child){
  const original=process.env.SESSION_PETS_TEST_LANGUAGE;
  const before=JSON.stringify({sessions:ctx.store.list(),settings:ctx.settings});
  const picker=ctx.openPicker();
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async predicate=>{const end=Date.now()+5000;while(!await predicate()){if(Date.now()>end)throw Error('Localized renderer did not become ready');await delay(30);}};
  const ready=win=>win.webContents.executeJavaScript(`document.body.dataset.ready==='true'`);
  const labels=menu=>menu.items.flatMap(item=>[item.label,...(item.submenu?labels(item.submenu):[])]);
  const results=[];
  try{
    await until(()=>ready(picker));
    const selected=await picker.webContents.executeJavaScript(`document.getElementById('picker-choose').dataset.petId`);
    for(const [preferred,language] of [['en-KR','en'],['ko-US','ko'],['de-DE','en']]){
      process.env.SESSION_PETS_TEST_LANGUAGE=preferred;
      ctx.refreshLanguage();
      for(const win of [pet,child,picker])await until(()=>win.webContents.executeJavaScript(`document.documentElement.lang===${JSON.stringify(language)}`));
      const t=(text,values)=>i18n.translate(language,text,values);
      assert.equal(ctx.snapshot().language,language);
      assert.ok(!labels(ctx.Menu.getApplicationMenu()).some(label=>/demo|데모|시연/i.test(label)));
      assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('pet-mode')===null`),true);
      assert.ok(labels(ctx.Menu.getApplicationMenu()).includes(t('기본 일꾼 고르기')));
      assert.ok(labels(ctx.Menu.getApplicationMenu()).includes(t('전체 선택')));
      const petText=await pet.webContents.executeJavaScript(`({name:document.getElementById('floating-name').textContent,state:document.getElementById('floating-state').textContent,title:document.getElementById('floating-title').textContent,change:document.getElementById('pet-library').getAttribute('aria-label')})`);
      assert.equal(petText.name,t('고릴대장'));
      assert.equal(petText.state,t('상태 미확인'));
      assert.equal(petText.title,'원래 Codex 세션','user session title must not be translated');
      assert.equal(petText.change,t('펫 바꾸기'));
      assert.equal(await child.webContents.executeJavaScript(`document.getElementById('child-label').textContent`),t('작은 일꾼'));
      const pickerText=await picker.webContents.executeJavaScript(`({heading:document.getElementById('picker-session').textContent,hint:document.getElementById('picker-hint').textContent,selected:document.getElementById('picker-choose').dataset.petId,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,text:document.getElementById('app').innerText})`);
      assert.equal(pickerText.heading,t('기본 일꾼 고르기'));
      assert.equal(pickerText.hint,t('클릭 또는 Enter로 선택'));
      assert.equal(pickerText.selected,selected);
      assert.equal(pickerText.overflow,false);
      if(language==='en')assert.doesNotMatch(pickerText.text,/[가-힣]/);
      await pet.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new PointerEvent('pointerenter'))`);
      assert.equal(await pet.webContents.executeJavaScript(`document.getElementById('pet-reaction').textContent`),t('대장 등장.'));
      const error=await pet.webContents.executeJavaScript(`window.pets.call('move',{dx:'invalid',dy:0}).then(()=>'',e=>e.message)`);
      assert.ok(error.endsWith(t('잘못된 위치입니다.')));
      if(preferred!=='de-DE'){
        pet.showInactive();await delay(80);
        const center=await pet.webContents.executeJavaScript(`(()=>{const r=document.getElementById('pet-handle').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
        pet.webContents.sendInputEvent({type:'mouseMove',...center});await delay(180);
        await fs.writeFile(path.join(ctx.root,`work/smoke/locale-${language}-pet.png`),(await pet.webContents.capturePage()).toPNG());
        await fs.writeFile(path.join(ctx.root,`work/smoke/locale-${language}-picker.png`),(await picker.webContents.capturePage()).toPNG());
      }
      results.push({preferred,language,menus:true,pet:true,picker:true,child:true,expressions:true,errors:true});
    }
    assert.equal(JSON.stringify({sessions:ctx.store.list(),settings:ctx.settings}),before,'language changes must preserve sessions and choices');
    return {cases:results,sessionChoicesPreserved:true,osPreferencesModified:false};
  }finally{
    picker.destroy();pet.hide();
    if(original===undefined)delete process.env.SESSION_PETS_TEST_LANGUAGE;else process.env.SESSION_PETS_TEST_LANGUAGE=original;
    ctx.refreshLanguage();
  }
};
