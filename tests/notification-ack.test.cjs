'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SessionStore}=require('../src/store.cjs');
const {createSessionOpener}=require('../src/session-links.cjs');
const nativeId='77777777-7777-4777-8777-777777777777';
const id='codex:'+nativeId;

function fixture(state='done') {
  const store=new SessionStore();
  store.snapshot([{id,provider:'codex',nativeId}]);
  let serial=0;
  const emit=(kind,turnId,extra={})=>store.ingest({id:'ack-'+ ++serial,provider:'codex',sessionId:id,kind,turnId,sequence:serial,evidence:'codex-lifecycle',...extra});
  emit('turn.started','one');
  if(state==='done')emit('turn.completed','one');
  const opener=overrides=>createSessionOpener({getSession:key=>store.get(key),checkProtocol:async()=>{},openExternal:async()=>{},acknowledgeCompletion:(key,turn)=>store.acknowledgeCompletion(key,turn),...overrides});
  return {store,emit,opener};
}

test('opening a completed session acknowledges its notification without changing the task result',async()=>{
  const {store,opener}=fixture();
  const before={...store.get(id)};
  assert.equal((await opener()(id)).dispatched,true);
  assert.deepEqual(store.get(id),{...before,acknowledgedCompletionTurnId:'one'});
  assert.equal(store.acknowledgeCompletion(id,'one'),false,'acknowledgment is idempotent');
});

test('failed session dispatch preserves the unread completion',async()=>{
  const {store,opener}=fixture();
  const open=opener({openExternal:async()=>{throw Error('dispatch failed');}});
  await assert.rejects(open(id),/dispatch failed/);
  assert.equal(store.get(id).acknowledgedCompletionTurnId,undefined);
});

test('a slow open of a previous result cannot acknowledge a newer completed turn',async()=>{
  const {store,emit,opener}=fixture();
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const open=opener({openExternal:()=>pending});
  const dispatched=open(id);
  emit('turn.started','two');emit('turn.completed','two');
  release();await dispatched;
  assert.equal(store.get(id).state,'done');
  assert.equal(store.get(id).turnId,'two');
  assert.equal(store.get(id).acknowledgedCompletionTurnId,undefined);
});

test('opening an active task never consumes a completion that arrives during dispatch',async()=>{
  const {store,emit,opener}=fixture('working');
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const dispatched=opener({openExternal:()=>pending})(id);
  emit('turn.completed','one');release();await dispatched;
  assert.equal(store.get(id).acknowledgedCompletionTurnId,undefined);
});

test('restored acknowledgment applies only to the same source turn',async()=>{
  const {store,opener}=fixture();
  await opener()(id);
  const restored=new SessionStore();
  restored.snapshot([{id,provider:'codex',acknowledgedCompletionTurnId:store.get(id).acknowledgedCompletionTurnId}]);
  assert.equal(restored.get(id).state,'unknown','preferences do not restore a live success');
  restored.ingest({id:'baseline',provider:'codex',sessionId:id,turnId:'one',kind:'turn.completed',evidence:'codex-lifecycle',baseline:true});
  assert.equal(restored.get(id).acknowledgedCompletionTurnId,restored.get(id).turnId);
  restored.ingest({id:'next-start',provider:'codex',sessionId:id,turnId:'two',kind:'turn.started',evidence:'codex-lifecycle'});
  restored.ingest({id:'next-end',provider:'codex',sessionId:id,turnId:'two',kind:'turn.completed',evidence:'codex-lifecycle'});
  assert.equal(restored.get(id).state,'done');
  assert.notEqual(restored.get(id).acknowledgedCompletionTurnId,restored.get(id).turnId);
});

test('missing, stale and active turns cannot be acknowledged',()=>{
  const {store}=fixture('working');
  for(const [key,turn] of [[id,'one'],[id,'old'],[id,null],['missing','one']])assert.equal(store.acknowledgeCompletion(key,turn),false);
});
