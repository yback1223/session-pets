'use strict';
const {app,BrowserWindow,ipcMain,dialog,screen,Menu,Tray,nativeImage,nativeTheme,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {SessionStore}=require('./store.cjs');
const {PetAssets}=require('./assets.cjs');
const {createProviders}=require('./providers.cjs');
const {createControlServer}=require('./control.cjs');
const {createSessionOpener}=require('./session-links.cjs');
const i18n=require('../shared/i18n.js');
const {createHostLanguages}=require('./host-language.cjs');
const {createCodexStatus}=require('./codex-status.cjs');
const {createCodexReadState}=require('./codex-read-state.cjs');
const ROOT=path.resolve(__dirname,'..');
const SMOKE=!app.isPackaged&&process.argv.includes('--smoke-test');
app.setName('열두 일꾼');
// Native glass follows the light palette used by the renderer.
nativeTheme.themeSource='light';
app.setPath('userData',SMOKE?path.join(ROOT,'work','smoke-runtime'):path.join(os.homedir(),'Library','Application Support','session-pets'));
if(!SMOKE&&!app.requestSingleInstanceLock()){app.quit();}else{app.whenReady().then(start).catch(e=>{console.error('실행 실패:',e.message);app.exit(1);});}
let store,assets,providers,codexStatus,codexReadState,control,openSession,tray,saveTimer,expiryTimer,cursorTimer,quitting=false;
const windows=new Map(),petWindows=new Map(),positions=new Map(),delayedTimers=new Set(),linkWindows=new Set();
const pickerWindows=new Map();
const smokeDispatches=[];
const connection={codex:{status:'idle',error:''},claude:{status:'idle',error:'',pluginCommand:"claude --plugin-dir '"+path.join(ROOT,'plugins','claude-session-pets').replace(/'/g,"'\\''")+"'"}};
let settings={reducedMotion:false,defaultPetId:'gorilla'};
let language='en',locale='';
let hostLanguages,activeProvider=null,languageSignature='';
const t=(source,values)=>i18n.translate(language,source,values);
const page=path.join(ROOT,'renderer','index.html');
const pageURL=pathToFileURL(page).href;
function viewLanguage(id){
 const provider=store?.get(id)?.provider||(['codex','claude'].includes(id)?id:activeProvider);
 const host=provider&&hostLanguages?.get(provider);
 if(!host)return {language,locale,languageSource:'system',translationReady:true};
 return {language:host.language,locale:host.locale,languageSource:host.source,translationReady:host.translationReady,translations:i18n.catalogFor(host.locale)};
}
function snapshot(id){return {catalog:assets.catalog,sessions:store.list(),settings,connection,...viewLanguage(id)};}
function refreshLanguage(provider){
 if(!app.isReady())return;
 if(['codex','claude'].includes(provider))activeProvider=provider;
 // Test injection is confined to the isolated smoke process; normal runs read host settings.
 const preferred=SMOKE&&process.env.SESSION_PETS_TEST_LANGUAGE?[process.env.SESSION_PETS_TEST_LANGUAGE]:app.getPreferredSystemLanguages();
 let overrides;
 if(SMOKE){try{overrides=JSON.parse(process.env.SESSION_PETS_TEST_HOST_LANGUAGES||'null');}catch{}if(!overrides&&process.env.SESSION_PETS_TEST_LANGUAGE)overrides={codex:preferred[0],claude:preferred[0]};}
 const hosts=hostLanguages?.refresh(overrides);
 if(!SMOKE)try{hostLanguages?.syncInstalledSkills();}catch{console.warn('Could not refresh pet skill language metadata.');}
 const selected=activeProvider&&hostLanguages?.get(activeProvider);
 const nextLanguage=selected?selected.language:i18n.resolveLanguage(preferred.length?preferred:[app.getLocale()]);
 const nextLocale=selected?selected.locale:i18n.formatLocale(app.getSystemLocale(),nextLanguage);
 const signature=JSON.stringify([nextLanguage,nextLocale,hosts,hosts&&Object.values(hosts).map(host=>i18n.catalogFor(host.locale))]);
 if(signature===languageSignature)return;
 languageSignature=signature;
 language=nextLanguage;locale=nextLocale;app.setName(t('열두 일꾼'));
 if(store&&assets){updateMenus();for(const [win,meta] of windows)if(!win.isDestroyed())win.setTitle(i18n.translate(viewLanguage(meta.sessionId).language,'열두 일꾼'));broadcast();}
}
function updateMenus(){
 const choose={label:t('기본 일꾼 고르기'),click:()=>openPicker()};
 const edits=[['undo','실행 취소'],['redo','다시 실행'],['cut','잘라내기'],['copy','복사'],['paste','붙여넣기'],['selectAll','전체 선택']].map(([role,label])=>({role,label:t(label)}));
 edits.splice(2,0,{type:'separator'});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:t('열두 일꾼'),submenu:[choose,{type:'separator'},{role:'quit',label:t('열두 일꾼 종료')}]},{label:t('편집'),submenu:edits}]));
 if(tray){tray.setToolTip(t('열두 일꾼'));tray.setContextMenu(Menu.buildFromTemplate([choose,{type:'separator'},{label:t('종료'),click:()=>app.quit()}]));}
}
function broadcast(){for(const [win,meta] of windows)if(!win.isDestroyed())win.webContents.send('pets:state',snapshot(meta.sessionId));}
function newWindow(view,{sessionId,...options}={}){
 if(!['pet','picker'].includes(view))throw new Error('지원하지 않는 화면입니다.');
 const win=new BrowserWindow({width:430,height:410,minWidth:100,minHeight:100,show:false,backgroundColor:'#00000000',title:i18n.translate(viewLanguage(sessionId).language,'열두 일꾼'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true},...options});
 windows.set(win,{view,sessionId});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',e=>e.preventDefault());
 win.webContents.on('will-attach-webview',e=>e.preventDefault());
 win.on('closed',()=>windows.delete(win));
 win.once('ready-to-show',()=>{if(!SMOKE)win.show();});
 win.loadFile(page,{query:{view,...(sessionId?{sessionId}:{})}});
 return win;
}
function openPicker(sessionId){
 const key=sessionId||'default';
 if(sessionId&&!store.get(sessionId))throw new Error('연결할 세션을 찾을 수 없습니다.');
 const existing=pickerWindows.get(key);if(existing&&!existing.isDestroyed()){if(!SMOKE){existing.show();existing.focus();}return existing;}
 const width=430,height=450,pet=petWindows.get(sessionId);
 const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
 const target=pet&&!pet.isDestroyed()?pet.getBounds():null;
 const center=target?{x:target.x+target.width/2,y:target.y+target.height/2}:{x:area.x+area.width/2,y:area.y+area.height/2};
 const pos=bounded({x:center.x-width/2,y:center.y-height/2},width,height);
 const win=newWindow('picker',{sessionId,width,height,...pos,frame:false,transparent:true,resizable:false,alwaysOnTop:true,hasShadow:false,skipTaskbar:true});
 pickerWindows.set(key,win);
 if(pet&&!pet.isDestroyed())pet.hide();
 win.on('closed',()=>{pickerWindows.delete(key);const p=petWindows.get(sessionId);if(!quitting&&!SMOKE&&p&&!p.isDestroyed()&&store.get(sessionId)?.pinned)p.show();});
 return win;
}
function choosePet(sessionId,petId,picker){
 const pet=assets.catalog.find(p=>p.id===petId);if(!pet)throw new Error('선택한 펫을 찾을 수 없습니다.');
 if(sessionId){
  const session=store.get(sessionId);if(!session||session.ended)throw new Error('종료되었거나 찾을 수 없는 세션입니다.');
  if(picker&&!positions.has(sessionId)&&!petWindows.has(sessionId)){const box=picker.getBounds();positions.set(sessionId,bounded({x:box.x+(box.width-260)/2,y:box.y+40},260,330));}
  store.patch(sessionId,{petId,petChosen:true,pinned:true,dismissed:false});
  const win=petWindows.get(sessionId);if(!SMOKE&&win&&!win.isDestroyed()){win.show();win.moveTop();}
 }else{settings.defaultPetId=petId;broadcast();scheduleSave();}
}
async function handleControl(request){
 if(request.action==='prepare-language')return hostLanguages.prepare(request.provider);
 const id=request.provider+':'+request.sessionId;
 let session=store.get(id);
 if(request.action==='status')return {status:pickerWindows.has(id)?'choosing':session?.pinned?'visible':'hidden',sessionId:id,petId:session?.petChosen?session.petId:null,state:session?.state||'unknown',evidence:session?.evidence||'none',updatedAt:session?.updatedAt||null};
 if(request.action==='hide'){
  if(session)store.patch(id,{pinned:false,dismissed:true});
  pickerWindows.get(id)?.close();
  return {status:'hidden',sessionId:id};
 }
 const selected=request.petId?assets.catalog.find(p=>[p.id,p.name,p.animal,t(p.name),t(p.animal)].includes(request.petId)):null;
 if(request.petId&&!selected)throw new Error('해당 펫이 없습니다. 이름 없이 호출해 직접 골라주세요.');
 if(!session){store.snapshot([{id,nativeId:request.sessionId,provider:request.provider,title:request.title||t('{provider} 세션',{provider:request.provider==='codex'?'Codex':'Claude'}),state:'unknown',evidence:'persisted-record',mode:'observer',petId:settings.defaultPetId}]);session=store.get(id);}
 if(request.cwd||request.surface)store.patch(id,{...(request.cwd?{cwd:request.cwd}:{}),...(request.surface?{surface:request.surface}:{})});
 if(session.ended)store.patch(id,{ended:false,state:'unknown',evidence:'persisted-record',turnId:null});
 if(selected){choosePet(id,selected.id,pickerWindows.get(id));pickerWindows.get(id)?.close();return {status:'visible',sessionId:id,petId:selected.id};}
 if(request.action==='summon'&&(session.petChosen||session.pinned)&&assets.catalog.some(p=>p.id===session.petId)){
  choosePet(id,session.petId,pickerWindows.get(id));pickerWindows.get(id)?.close();return {status:'visible',sessionId:id,petId:session.petId};
 }
 openPicker(id);return {status:'choosing',sessionId:id};
}
function bounded(pos,width,height){const area=screen.getDisplayNearestPoint({x:Math.round(pos.x),y:Math.round(pos.y)}).workArea;return {x:Math.round(Math.max(area.x,Math.min(pos.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(pos.y,area.y+area.height-height)))};}
function petFor(s){if(petWindows.has(s.id))return;const child=!!s.parentId,width=child?180:260,height=child?240:330;const area=screen.getPrimaryDisplay().workArea;let pos=positions.get(s.id)||{x:area.x+area.width-width-(petWindows.size%4)*210,y:area.y+area.height-height-20-Math.floor(petWindows.size/4)*200};
 const parent=petWindows.get(s.parentId);if(parent&&!positions.has(s.id)){const [x,y]=parent.getPosition();const siblings=store.list().filter(other=>other.parentId===s.parentId&&petWindows.has(other.id)).length;pos={x:x-90+siblings*120,y:y-120};}
 pos=bounded(pos,width,height);
 const win=newWindow('pet',{sessionId:s.id,width,height,...pos,frame:false,transparent:true,resizable:false,alwaysOnTop:true,hasShadow:false,skipTaskbar:true});
 win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});petWindows.set(s.id,win);
 win.on('closed',()=>{petWindows.delete(s.id);});
}
function syncWindows(){
 for(const record of store.list()){
  const s=store.get(record.id);
  if(s.parentId&&s.hasObservedStart&&s.evidence!=='persisted-record'&&store.get(s.parentId)?.pinned&&!s.dismissed&&!s.ended)s.pinned=true;
  if(s.pinned&&!s.ended)petFor(s);
 }
 for(const [id,win]of petWindows){const s=store.get(id);if(!s?.pinned||s.ended){win.destroy();petWindows.delete(id);}}
 broadcast();scheduleSave();
}
function scheduleSave(){if(SMOKE)return;clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{const records=store.list().filter(s=>s.pinned||s.petChosen).map(s=>({id:s.id,nativeId:s.nativeId,provider:s.provider,cwd:s.cwd,surface:s.surface,title:s.title,parentId:s.parentId,petId:s.petId,petChosen:!!s.petChosen,pinned:!!s.pinned,dismissed:!!s.dismissed,acknowledgedCompletionTurnId:s.acknowledgedCompletionTurnId,state:'unknown',mode:'observer',evidence:'persisted-record'}));
 const file=path.join(app.getPath('userData'),'preferences.json');try{await fs.writeFile(file+'.tmp',JSON.stringify({settings,records,positions:[...positions]},null,2),{mode:0o600});await fs.rename(file+'.tmp',file);}catch{}} ,500);}
function later(ms,fn){
 const timer=setTimeout(()=>{delayedTimers.delete(timer);fn();},ms);
 delayedTimers.add(timer);
}
function pulseLink({from,to}){const a=petWindows.get(from),b=petWindows.get(to);if(!a||!b)return;const area=screen.getDisplayMatching(a.getBounds()).bounds;const win=new BrowserWindow({x:area.x,y:area.y,width:area.width,height:area.height,show:!SMOKE,frame:false,transparent:true,focusable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.setIgnoreMouseEvents(true);linkWindows.add(win);win.on('closed',()=>linkWindows.delete(win));
 const [ax,ay]=a.getPosition(),[bx,by]=b.getPosition();const x1=ax-area.x+100,y1=ay-area.y+110,x2=bx-area.x+100,y2=by-area.y+110;
 const html=`<html><body style="margin:0;background:transparent;overflow:hidden"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="M${x1} ${y1} Q${(x1+x2)/2} ${Math.min(y1,y2)-110} ${x2} ${y2}" fill="none" stroke="#78a969" stroke-width="3" stroke-dasharray="7 9"/>${settings.reducedMotion?'':`<circle r="7" fill="#f5bd58"><animateMotion dur="1.2s" repeatCount="2" path="M${x1} ${y1} Q${(x1+x2)/2} ${Math.min(y1,y2)-110} ${x2} ${y2}"/></circle>`}</svg></body></html>`;
 win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));later(2600,()=>{if(!win.isDestroyed())win.destroy();});}
async function action(event,name,p={}){
 const win=BrowserWindow.fromWebContents(event.sender),meta=windows.get(win);const url=event.senderFrame?.url||'';
 if(!meta||!(url===pageURL||url.startsWith(pageURL+'?')))throw new Error('허용하지 않은 요청입니다.');
 if(meta.view==='picker'&&!['snapshot','close','picker-select','import-pet'].includes(name))throw new Error('펫 선택기에서 허용하지 않은 요청입니다.');
 if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('잘못된 요청입니다.');
 const id=p.sessionId||meta.sessionId;
 switch(name){
 case 'snapshot':return snapshot(meta.sessionId);
 case 'open-picker':if(meta.view!=='pet'||id!==meta.sessionId)throw new Error('현재 세션에서만 펫을 바꿀 수 있습니다.');openPicker(id);return true;
 case 'picker-select':{
  if(meta.view!=='picker')throw new Error('펫 선택기에서만 선택할 수 있습니다.');
  choosePet(meta.sessionId,p.petId,win);
  setImmediate(()=>{if(!win.isDestroyed())win.close();});return {selected:true,petId:p.petId,sessionId:meta.sessionId||null};
 }
 case 'close':if(meta.view==='pet'){store.patch(meta.sessionId,{pinned:false,dismissed:true});}else win.close();return true;
 case 'move':{if(meta.view!=='pet')throw new Error('펫만 움직일 수 있습니다.');const dx=Number(p.dx),dy=Number(p.dy);if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>2000||Math.abs(dy)>2000)throw new Error('잘못된 위치입니다.');const [x,y]=win.getPosition();const [w,h]=win.getSize();const pos=bounded({x:x+dx,y:y+dy},w,h);win.setPosition(pos.x,pos.y);positions.set(meta.sessionId,pos);for(const child of store.list().filter(s=>s.parentId===meta.sessionId)){const cw=petWindows.get(child.id);if(!cw)continue;const [cx,cy]=cw.getPosition(),[ww,hh]=cw.getSize();const cp=bounded({x:cx+pos.x-x,y:cy+pos.y-y},ww,hh);cw.setPosition(cp.x,cp.y);positions.set(child.id,cp);}scheduleSave();return pos;}
 case 'detach':if(meta.view!=='pet'||id!==meta.sessionId)throw new Error('현재 펫만 숨길 수 있습니다.');store.patch(id,{pinned:false,dismissed:true});return true;
 case 'open-session':if(meta.view!=='pet'||id!==meta.sessionId)throw new Error('현재 펫의 세션만 열 수 있습니다.');return openSession(meta.sessionId);
 case 'import-pet':{const local=source=>i18n.translate(viewLanguage(meta.sessionId).language,source);const selected=await dialog.showOpenDialog(win,{title:local('내 펫 파일 데려오기'),buttonLabel:local('열기'),properties:['openFile'],filters:[{name:local('펫 이미지 또는 설정'),extensions:['png','json']}]});if(selected.canceled)return null;const pet=await assets.import(selected.filePaths[0]);broadcast();return pet;}
 default:throw new Error('지원하지 않는 기능입니다. 외부 세션의 입력·모델 변경은 원래 앱에서 해주세요.');
 }
}
async function start(){
 refreshLanguage();
 if(SMOKE)await fs.rm(app.getPath('userData'),{recursive:true,force:true});
 await fs.mkdir(app.getPath('userData'),{recursive:true,mode:0o700});
 hostLanguages=createHostLanguages({dataDir:app.getPath('userData'),...(SMOKE?{home:app.getPath('userData'),codexHome:path.join(app.getPath('userData'),'.codex')}:{}),systemLanguages:()=>SMOKE&&process.env.SESSION_PETS_TEST_LANGUAGE?[process.env.SESSION_PETS_TEST_LANGUAGE]:app.getPreferredSystemLanguages()});
 refreshLanguage();
 store=new SessionStore();
 openSession=createSessionOpener({getSession:id=>store.get(id),acknowledgeCompletion:(id,turnId)=>store.acknowledgeCompletion(id,turnId),checkProtocol:SMOKE?async()=>{}:url=>app.getApplicationInfoForProtocol(url),openExternal:SMOKE?async url=>{smokeDispatches.push({url});}:url=>shell.openExternal(url),...(SMOKE?{resolveClaude:async()=>'/test/claude',run:async(binary,args,options)=>{smokeDispatches.push({binary,args,cwd:options.cwd});return {stdout:`Opening session ${args[2]} in Claude Desktop`};}}:{})});
 assets=new PetAssets({assetsDir:path.join(ROOT,'assets','pets'),dataDir:path.join(app.getPath('userData'),'pets'),decode:b=>!nativeImage.createFromBuffer(b).isEmpty()});await assets.load();
 providers=createProviders({dataDir:app.getPath('userData'),onSnapshot:rows=>store.snapshot(rows),onEvent:e=>store.ingest(e),onConnection:(provider,state)=>{connection[provider]={...connection[provider],...state};broadcast();}});
 codexStatus=createCodexStatus({codexHome:SMOKE?path.join(app.getPath('userData'),'.codex'):process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),getSessions:()=>store.list(),onEvent:e=>store.ingest(e),onConnection:state=>{connection.codex={...connection.codex,...state};broadcast();}});
 codexReadState=createCodexReadState({codexHome:SMOKE?path.join(app.getPath('userData'),'.codex'):process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),getSessions:()=>store.list(),acknowledgeCompletion:(id,turnId)=>store.acknowledgeCompletion(id,turnId)});
 control=createControlServer({dataDir:SMOKE?await fs.mkdtemp(path.join(os.tmpdir(),'pet-c-')):app.getPath('userData'),localizeError:(message,request)=>i18n.translateError(viewLanguage(request?.provider).language,message),onRequest:async request=>{
  refreshLanguage(request.provider);const result=await handleControl(request);
  const messages={choosing:'현재 세션의 펫 선택기를 열었습니다. 화살표로 고르고 캐릭터를 클릭하세요.',visible:'현재 세션의 펫을 표시했습니다.',hidden:'현재 세션의 펫이 숨겨져 있습니다.'};
  const localized=viewLanguage(request.provider);
  return {...result,language:localized.language,locale:localized.locale,message:i18n.translate(localized.language,messages[result.status]||'')};
 }});
 store.on('change',syncWindows);store.on('link',pulseLink);store.on('completed',s=>{if(s.parentId)later(1900,()=>{const cur=store.get(s.id);if(cur?.turnId===s.turnId&&cur.state==='done')store.patch(s.id,{pinned:false,ended:true});});});
 try{const prefs=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'preferences.json'),'utf8'));settings={...settings,...prefs.settings};for(const [id,pos]of prefs.positions||[])positions.set(id,pos);if(!assets.catalog.some(p=>p.id===settings.defaultPetId))settings.defaultPetId='gorilla';store.snapshot((prefs.records||[]).map(record=>({...record,petId:assets.catalog.some(p=>p.id===record.petId)?record.petId:settings.defaultPetId})));}catch{}
 ipcMain.handle('pets:call',async(...args)=>{try{return await action(...args);}catch(error){const meta=windows.get(BrowserWindow.fromWebContents(args[0].sender));throw new Error(i18n.translateError(viewLanguage(meta?.sessionId).language,error.message));}});
 if(!SMOKE){tray=new Tray(nativeImage.createEmpty());tray.setTitle('🐾');}
 updateMenus();
 if(!SMOKE){await providers.startClaude();await codexStatus.start();await codexReadState.start();await control.start();expiryTimer=setInterval(()=>{store.expire();refreshLanguage();},5000);let previous=screen.getCursorScreenPoint();cursorTimer=setInterval(()=>{const cursor=screen.getCursorScreenPoint(),speed=Math.hypot(cursor.x-previous.x,cursor.y-previous.y);previous=cursor;for(const win of petWindows.values()){if(win.isDestroyed()||!win.isVisible())continue;const box=win.getBounds(),dx=cursor.x-box.x-box.width/2,dy=cursor.y-box.y-box.height/2;win.webContents.send('pets:cursor',{x:Math.max(-1,Math.min(1,dx/260)),y:Math.max(-1,Math.min(1,dy/260)),near:Math.hypot(dx,dy)<220,speed});}},120);}
 if(!SMOKE&&!process.argv.includes('--background'))openPicker();
 if(SMOKE)await smoke();
}
async function smoke(){
 try{const report=await require('../tests/electron/smoke.cjs')({root:ROOT,store,assets,control,settings,openPicker,pickerWindows,petWindows,windows,smokeDispatches,linkWindows,app,Menu,refreshLanguage,snapshot});console.log(JSON.stringify(report));quitting=true;await providers.stop();app.exit(0);}
 catch(error){console.error('Smoke:',error);app.exit(1);}
}
app.on('second-instance',(_event,argv)=>{if(!argv.includes('--background'))openPicker();});app.on('activate',()=>{refreshLanguage();if(assets&&!process.argv.includes('--background'))openPicker();});
app.on('browser-window-focus',(_event,win)=>refreshLanguage(store?.get(windows.get(win)?.sessionId)?.provider));
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>{quitting=true;clearInterval(expiryTimer);clearInterval(cursorTimer);clearTimeout(saveTimer);for(const timer of delayedTimers)clearTimeout(timer);delayedTimers.clear();providers?.stop();codexStatus?.stop();codexReadState?.stop();control?.stop();});
