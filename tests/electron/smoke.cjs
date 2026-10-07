'use strict';
// Native windows owned by this app only; external links and CLI launches are injected fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function(ctx) {
  const {root,store,assets,settings,petWindows,pickerWindows,windows,smokeDispatches,linkWindows,app,Menu} = ctx;
  const out = path.join(root, 'work/smoke');
  await fs.mkdir(out, {recursive:true});
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (test, label, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (!await test()) { if (Date.now() > deadline) throw Error('대기 시간 초과: '+label); await delay(40); }
  };
  const ready = win => until(async () => !win.webContents.isLoading() && await win.webContents.executeJavaScript(`Boolean(document.getElementById('floating-name') && document.body.dataset.ready==='true')`), '펫 렌더링');
  const click = win => win.webContents.executeJavaScript(`document.getElementById('pet-handle').click()`);
  const picker = await require('./picker-smoke.cjs')(ctx);
  assert.equal(assets.catalog.filter(p=>!p.id.startsWith('custom-')).length,2);
  const a = '33333333-3333-4333-8333-333333333333', b = '44444444-4444-4444-8444-444444444444';
  const aid = 'codex:'+a, bid = 'claude:'+b, childId = bid+':agent:child';
  const fixture = [
    {id:aid,nativeId:a,provider:'codex',title:'원래 Codex 세션',petId:'gorilla',pinned:true},
    {id:bid,provider:'claude',surface:'desktop',title:'원래 Claude 세션',petId:'tiger',pinned:true},
    {id:childId,provider:'claude',parentId:bid,title:'작은 Claude 일꾼',petId:'gorilla',pinned:true}
  ];
  store.snapshot(fixture);
  const codex = petWindows.get(aid), claude = petWindows.get(bid), child = petWindows.get(childId);
  await Promise.all([ready(codex),ready(claude),ready(child)]);
  const localization=await require('./locale-smoke.cjs')(ctx,codex,child);
  const completion=await require('./completion-smoke.cjs')(ctx,codex,aid);
  const attention=await require('./attention-smoke.cjs')(ctx,claude,child,bid);
  const hostLocalization=await require('./host-language-smoke.cjs')(ctx,codex,claude,aid,bid);
  const liveCodex=await require('./live-codex-smoke.cjs')(ctx,codex,aid);
  const codexQuestions=await require('./codex-question-smoke.cjs')(ctx,codex,aid);
  assert.equal((await codex.webContents.capturePage()).toBitmap()[3],0);
  assert.deepEqual([...new Set([...windows.values()].map(w=>w.view))],['pet']);
  await click(codex); await until(()=>smokeDispatches.length===1,'Codex 클릭');
  assert.equal(smokeDispatches[0].url,`codex://threads/${a}`);
  await click(claude); await until(()=>smokeDispatches.length===2,'Claude 클릭');
  assert.equal(smokeDispatches[1].url,`claude://code/continue?session=${b}`);
  await click(child); await until(()=>smokeDispatches.length===3,'자식 클릭');
  assert.equal(smokeDispatches[2].url,smokeDispatches[1].url);
  store.patch(bid,{surface:'cli',cwd:root});
  await click(claude); await until(()=>smokeDispatches.length===4,'CLI 클릭');
  assert.deepEqual(smokeDispatches[3].args,['--desktop','--resume',b]);
  const refused = await codex.webContents.executeJavaScript(`Promise.all(['open-hub','open-bubble','settings','send-message'].map(action=>window.pets.call(action,{}).then(()=>false,()=>true)))`);
  assert.ok(refused.every(Boolean));
  assert.equal(await codex.webContents.executeJavaScript(`window.pets.call('open-session',{sessionId:${JSON.stringify(bid)}}).then(()=>false,()=>true)`),true);
  const labels = menu => menu.items.flatMap(item=>[item.label,...(item.submenu?labels(item.submenu):[])]);
  assert.ok(!labels(Menu.getApplicationMenu()).some(label=>/설정|라이브러리|demo|데모|시연/i.test(label)));
  const layout = await codex.webContents.executeJavaScript(`({noPanels:!document.querySelector('#hub-template,#bubble-template,#pet-mode,.demo-badge'),noOverflow:document.documentElement.scrollWidth<=innerWidth,aria:document.getElementById('pet-handle').getAttribute('aria-label')})`);
  assert.equal(layout.noPanels,true);assert.equal(layout.noOverflow,true);assert.match(layout.aria,ctx.snapshot().language==='ko'?/원래 세션 열기/:/open the original session/);
  await codex.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new PointerEvent('pointerenter'))`);
  assert.equal(await codex.webContents.executeJavaScript('document.body.dataset.emotion'),'greeting');
  codex.webContents.send('pets:cursor',{x:1,y:-1,near:false,speed:0});
  await until(async()=>await codex.webContents.executeJavaScript(`document.querySelector('.floating-pet').style.getPropertyValue('--look-x')==='8px'`),'커서 따라보기');
  assert.equal(store.get(aid).state,'unknown','emotions must not change observed session status');
  await codex.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new WheelEvent('wheel',{deltaY:1,cancelable:true}))`);
  assert.equal(await codex.webContents.executeJavaScript('document.body.dataset.emotion'),'dance');
  await delay(180);
  await fs.writeFile(path.join(out,'gorilla-dance.png'),(await codex.webContents.capturePage()).toPNG());
  await claude.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new WheelEvent('wheel',{deltaY:1,cancelable:true}))`);
  await delay(180);
  await fs.writeFile(path.join(out,'tiger-dance.png'),(await claude.webContents.capturePage()).toPNG());
  settings.reducedMotion=true;store.publish();await delay(50);
  assert.equal(await codex.webContents.executeJavaScript(`getComputedStyle(document.getElementById('floating-sprite')).animationName`),'none');
  settings.reducedMotion=false;store.publish();
  assert.equal(smokeDispatches.length,4,'hover and expression controls must not open sessions');
  await codex.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new MouseEvent('click',{detail:1}))`);
  await delay(60);
  await codex.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new MouseEvent('click',{detail:2}))`);
  await delay(300);
  assert.equal(smokeDispatches.length,4,'double click dances without navigating');
  // Pointer deltas use local coordinates plus window position, including unfocused native input.
  codex.showInactive();await delay(100);
  const before = codex.getPosition();
  const center = await codex.webContents.executeJavaScript(`(()=>{const r=document.getElementById('pet-handle').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  await codex.webContents.executeJavaScript(`window.dragEvents=[];for(const type of ['pointerdown','pointermove','pointerup'])document.getElementById('pet-handle').addEventListener(type,e=>window.dragEvents.push({type:e.type,x:e.screenX,y:e.screenY,button:e.button}));`);
  codex.webContents.sendInputEvent({type:'mouseMove',...center});await delay(100);
  codex.webContents.sendInputEvent({type:'mouseDown',...center,button:'left',clickCount:1});
  await delay(100);
  codex.webContents.sendInputEvent({type:'mouseMove',x:center.x-35,y:center.y-20,button:'left'});
  try { await until(()=>codex.getPosition()[0]!==before[0],'드래그 이동',3000); }
  catch(error) { console.error({focused:codex.isFocused(),before,after:codex.getPosition(),events:await codex.webContents.executeJavaScript('window.dragEvents')});throw error; }
  codex.webContents.sendInputEvent({type:'mouseUp',x:center.x-35,y:center.y-20,button:'left',clickCount:1});
  await delay(150);assert.equal(smokeDispatches.length,4,'drag must not navigate');
  codex.hide();
  await fs.writeFile(path.join(out,'pet.png'),(await codex.webContents.capturePage()).toPNG());
  await codex.webContents.executeJavaScript(`document.getElementById('pet-handle').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
  await until(()=>pickerWindows.has(aid),'우클릭 선택기');pickerWindows.get(aid).close();
  for(const row of fixture)store.sessions.delete(row.id);store.publish();
  const lifecycle=await require('./lifecycle-smoke.cjs')(ctx);
  const importDir=path.join(app.getPath('userData'),'import fixture');await fs.mkdir(importDir,{recursive:true});
  await fs.copyFile(path.join(root,'assets/pets/gorilla-expressions.png'),path.join(importDir,'my-pet.png'));
  await fs.writeFile(path.join(importDir,'my-pet.json'),JSON.stringify({version:1,name:'가져오기 검사',image:'my-pet.png',columns:1,rows:1,states:{idle:[0]}}));
  assert.match((await assets.import(path.join(importDir,'my-pet.json'))).id,/^custom-/);
  const report={codexQuestions,liveCodex,hostLocalization,attention,completion,localization,catalogCount:assets.catalog.filter(p=>!p.id.startsWith('custom-')).length,picker,hoverReaction:true,wheelDance:true,cursorTracking:true,reducedMotion:true,emotionDoesNotChangeTaskState:true,nativeSessionDispatch:true,claudeChildOpensParent:true,claudeCliExactResume:true,removedPanelsAndMenu:true,crossSessionRequestRejected:true,dragWithoutNavigation:true,rightClickPicker:true,lifecycle,customAtlasImported:true,externalAppNavigation:'not executed; dispatch boundary tested'};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  return report;
};
