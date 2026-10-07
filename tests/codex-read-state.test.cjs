'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createCodexReadState,parseReadState,LOCAL_HOST_KEY}=require('../src/codex-read-state.cjs');
const nativeId='88888888-8888-4888-8888-888888888888';
const value=ids=>({'electron-thread-read-state-v1':{version:1,unreadByIdentity:{identity:{[LOCAL_HOST_KEY]:ids}}}});

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pets-read-'));
  const file=path.join(directory,'.codex-global-state.json');
  let now=20000;
  const session={id:'codex:'+nativeId,provider:'codex',pinned:true,state:'done',turnId:'one',evidence:'codex-lifecycle',sourceTimestamp:10000};
  const acknowledgments=[];
  const reader=createCodexReadState({codexHome:directory,getSessions:()=>[session],acknowledgeCompletion:(...args)=>{acknowledgments.push(args);session.acknowledgedCompletionTurnId=args[1];},now:()=>now});
  t.after(async()=>{await reader.stop();await fs.rm(directory,{recursive:true,force:true});});
  async function write(ids,modifiedAt=15000){await fs.writeFile(file,JSON.stringify(value(ids)));await fs.utimes(file,modifiedAt/1000,modifiedAt/1000);}
  return {file,session,reader,acknowledgments,write,advance:()=>{now+=2000;}};
}

test('Codex unread to read transition acknowledges only after the host write settles',async t=>{
  const f=await fixture(t);
  await f.write([nativeId]);await f.reader.tick();f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,0);
  await f.write([]);const before=await fs.readFile(f.file,'utf8');
  await f.reader.tick();assert.equal(f.acknowledgments.length,0);
  f.advance();await f.reader.tick();
  assert.deepEqual(f.acknowledgments,[[f.session.id,'one']]);
  assert.equal(f.session.state,'done');assert.equal(await fs.readFile(f.file,'utf8'),before,'host preferences are read only');
});

test('already read results may settle after restart, but an older host file cannot consume a new result',async t=>{
  const f=await fixture(t);
  await f.write([],9000);await f.reader.tick();f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,0);
  await f.write([]);await f.reader.tick();f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,1);
});

test('a new turn, unread reversal or invalid file cancels pending read acknowledgment',async t=>{
  for(const interruption of ['turn','unread','invalid']){
    const f=await fixture(t);
    await f.write([]);await f.reader.tick();
    if(interruption==='turn'){f.session.turnId='two';f.session.sourceTimestamp=16000;}
    if(interruption==='unread')await f.write([nativeId]);
    if(interruption==='invalid')await fs.writeFile(f.file,'{');
    f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,0,interruption);
  }
});

test('account ambiguity, logout, remote hosts and unknown schemas are unavailable, not read',()=>{
  const base=value([]);
  const invalid=[null,{},value(null),value(['invalid']),{'electron-thread-read-state-v1':{version:2,unreadByIdentity:base['electron-thread-read-state-v1'].unreadByIdentity}}, {'electron-thread-read-state-v1':{version:1,unreadByIdentity:{}}}, {'electron-thread-read-state-v1':{version:1,unreadByIdentity:{a:{[LOCAL_HOST_KEY]:[]},b:{[LOCAL_HOST_KEY]:[]}}}}, {'electron-thread-read-state-v1':{version:1,unreadByIdentity:{a:{'remote:other':[]}}}}];
  for(const input of invalid)assert.equal(parseReadState(input),null);
});

test('working, unverified, hidden and foreign-provider sessions never consume notifications',async t=>{
  for(const change of [{state:'working'},{evidence:'host-event'},{pinned:false},{provider:'claude'},{sourceTimestamp:undefined}]){
    const f=await fixture(t);Object.assign(f.session,change);
    await f.write([]);await f.reader.tick();f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,0);
  }
});

test('missing or symlinked host files and a stopped reader leave notifications untouched',async t=>{
  const f=await fixture(t);
  await f.reader.tick();
  const target=f.file+'.target';await fs.writeFile(target,JSON.stringify(value([])));await fs.symlink(target,f.file);
  await f.reader.tick();f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,0);
  await fs.unlink(f.file);await f.write([]);await f.reader.tick();await f.reader.stop();f.advance();await f.reader.tick();assert.equal(f.acknowledgments.length,0);
});
