'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SessionStore}=require('../src/store.cjs');
const id='codex:11111111-1111-4111-8111-111111111111';
function setup(){
  const store=new SessionStore();let sequence=0;
  const send=(kind,turnId='current',extra={})=>store.ingest({id:'live-'+(++sequence),provider:'codex',sessionId:id,kind,turnId,generation:1,sequence,evidence:'codex-lifecycle',payload:{},...extra});
  store.snapshot([{id,provider:'codex',pinned:true,petId:'tiger'}]);
  return{store,send};
}
test('the real Codex lifecycle completes an observer pet and a new turn clears completion',()=>{
  const {store,send}=setup();let completed=0;store.on('completed',()=>completed++);
  send('turn.started');assert.equal(store.get(id).state,'working');
  send('turn.completed');assert.equal(store.get(id).state,'done');assert.equal(completed,1);
  assert.equal(store.get(id).mode,'observer');assert.equal(store.get(id).capabilities.send,false);
  send('turn.completed');assert.equal(completed,1);
  send('turn.started','next');send('turn.completed','current');
  assert.equal(store.get(id).state,'working');assert.equal(store.get(id).turnId,'next');
});
test('a verified baseline terminal record restores status without replaying celebrations',()=>{
  const {store,send}=setup();let completed=0;store.on('completed',()=>completed++);
  send('turn.completed','historical',{baseline:true});
  assert.equal(store.get(id).state,'done');assert.equal(store.get(id).turnId,'historical');assert.equal(completed,0);
  send('turn.started','new');send('turn.completed','historical',{baseline:true});
  assert.equal(store.get(id).state,'working');assert.equal(store.get(id).turnId,'new');
});
test('generic completion and interruption never become verified Codex success',()=>{
  const {store,send}=setup();let completed=0;store.on('completed',()=>completed++);
  send('turn.started');send('turn.completed','current',{evidence:'host-event'});
  assert.equal(store.get(id).state,'observed');assert.equal(completed,0);
  send('turn.started','interrupted');send('turn.interrupted','interrupted');
  assert.equal(store.get(id).state,'idle');assert.equal(completed,0);
});
test('an old unfinished baseline starts unknown and recovers only on real activity',()=>{
  const {store,send}=setup();
  send('turn.started','old',{baseline:true,stale:true,sourceTimestamp:1000,turnStartedAt:1000});
  assert.equal(store.get(id).state,'unknown');assert.equal(store.get(id).turnId,'old');
  send('activity','old',{sourceTimestamp:2000,turnStartedAt:1000});
  assert.equal(store.get(id).state,'working');
});
test('reconnect may restore a provably newer completed turn without replaying success',()=>{
  const {store,send}=setup();let completed=0;store.on('completed',()=>completed++);
  send('turn.started','A',{sourceTimestamp:1000,turnStartedAt:1000});
  send('connection.lost','A');
  send('turn.completed','B',{baseline:true,resync:true,sourceTimestamp:4000,turnStartedAt:3000});
  assert.equal(store.get(id).state,'done');assert.equal(store.get(id).turnId,'B');assert.equal(completed,0);
});
test('a later completion timestamp cannot make an older turn replace the current one',()=>{
  const {store,send}=setup();
  send('turn.started','B',{sourceTimestamp:3000,turnStartedAt:3000});send('connection.lost','B');
  send('turn.completed','A',{baseline:true,resync:true,sourceTimestamp:4000,turnStartedAt:1000});
  assert.equal(store.get(id).turnId,'B');assert.equal(store.get(id).state,'unknown');
  send('turn.completed','C',{baseline:true,resync:true,sourceTimestamp:5000});
  assert.equal(store.get(id).turnId,'B');assert.equal(store.get(id).state,'unknown');
});
test('an older baseline start cannot retire the current turn or block its real completion',()=>{
  const {store,send}=setup();
  send('turn.started','B',{sourceTimestamp:3000,turnStartedAt:3000});send('connection.lost','B');
  send('turn.started','A',{generation:2,baseline:true,resync:true,sourceTimestamp:1000,turnStartedAt:1000});
  assert.equal(store.get(id).turnId,'B');assert.equal(store.get(id).state,'unknown');
  send('turn.completed','B',{generation:2,sourceTimestamp:4000,turnStartedAt:3000});
  assert.equal(store.get(id).state,'done');assert.equal(store.get(id).turnId,'B');
});
test('file replacement after a terminal turn accepts a provably newer baseline',()=>{
  const {store,send}=setup();
  send('turn.started','A',{sourceTimestamp:1000,turnStartedAt:1000});
  send('turn.completed','A',{sourceTimestamp:2000,turnStartedAt:1000});
  send('turn.started','B',{generation:2,baseline:true,resync:true,sourceTimestamp:4000,turnStartedAt:3000});
  assert.equal(store.get(id).turnId,'B');assert.equal(store.get(id).state,'working');
  send('turn.completed','B',{generation:2,sourceTimestamp:5000,turnStartedAt:3000});
  send('turn.completed','C',{generation:3,baseline:true,resync:true,sourceTimestamp:7000,turnStartedAt:6000});
  assert.equal(store.get(id).turnId,'C');assert.equal(store.get(id).state,'done');
});
