'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {SessionStore}=require('../src/store.cjs');
const {createCodexStatus}=require('../src/codex-status.cjs');
const ID='99999999-9999-4999-8999-999999999999', KEY='codex:'+ID;
const T1='turn-one',T2='turn-two';
const BASE=Date.parse('2026-10-07T09:00:00Z');
const row=(type,payload,time=BASE)=>({timestamp:new Date(time).toISOString(),type,payload});
const event=(type,turn_id=T1)=>row('event_msg',{type,turn_id});
const question=(call_id='q1',count=1,sync=false)=>row('response_item',{type:'function_call',name:sync?'request_user_input':'request_user_input_async',call_id,arguments:JSON.stringify({questions:Array.from({length:count},(_,i)=>sync?{id:'question'+i,header:'Choose',question:'Private question?',options:[{label:'Yes',description:'Private option'}]}:{title:'Private question?',options:['Yes','No']})})});
const result=(call_id='q1',output={accepted:true})=>row('response_item',{type:'function_call_output',call_id,output:JSON.stringify(output)});
const answer=(call_id='q1',indices=[0],role='user')=>row('response_item',{type:'message',role,content:[{type:'input_text',text:'<send_user_message_question_reply>\n'+JSON.stringify(indices.map(i=>({questionItemId:JSON.stringify(['request_user_input_async',call_id,i]),question:'Private question?',answer:'Private answer'})))+'\n</send_user_message_question_reply>'}]});
const encode=rows=>rows.map(value=>JSON.stringify(value)+'\n').join('');
async function fixture(t,initial=[event('task_started')]){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'pet-questions-'));
 const file=path.join(home,'sessions/2026/10/07',`rollout-2026-10-07T09-00-00-${ID}.jsonl`);
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,encode([{type:'session_meta',payload:{id:ID}},...initial]));
 let now=BASE;
 const store=new SessionStore({now:()=>now});store.snapshot([{id:KEY,provider:'codex',pinned:true}]);
 const events=[];
 const observer=createCodexStatus({codexHome:home,getSessions:()=>store.list(),now:()=>now,onEvent:e=>{events.push(e);store.ingest(e);}});
 t.after(async()=>{await observer.stop();await fs.rm(home,{recursive:true,force:true});});
 await observer.tick();
 return {file,home,store,observer,events,state:()=>store.get(KEY),time:value=>{now=value;},append:async(...rows)=>{await fs.appendFile(file,encode(rows));await observer.tick();}};
}

test('live async question waits through acceptance and activity, then only its matching reply clears it',async t=>{
 const f=await fixture(t);
 await f.append(question('q1',2),result());
 assert.equal(f.state().state,'needs-input');assert.equal(f.state().pendingRequests.length,2);
 await f.append(event('token_count'),result('unrelated',{done:true}),answer('another'));
 assert.equal(f.state().state,'needs-input');assert.equal(f.state().pendingRequests.length,2);
 await f.append(answer('q1',[0]));assert.equal(f.state().state,'needs-input');assert.equal(f.state().pendingRequests.length,1);
 await f.append(answer('q1',[1]));assert.equal(f.state().state,'working');assert.equal(f.state().pendingRequests.length,0);
 assert.ok(!JSON.stringify(f.events).includes('Private'),'question/answer text never leaves the parser');
});

test('synchronous questions stop waiting when the blocking tool returns and failed async dispatch clears',async t=>{
 const f=await fixture(t);
 await f.append(question('sync',1,true));assert.equal(f.state().state,'needs-input');
 await f.append(result('sync',{answers:{question0:{answers:['Private answer']}}}));assert.equal(f.state().state,'working');
 await f.append(question('rejected'));assert.equal(f.state().state,'needs-input');
 await f.append(result('rejected',{accepted:false}));assert.equal(f.state().state,'working');
});

test('async input outlives execution completion and restores the result after the reply',async t=>{
 const f=await fixture(t);
 await f.append(question(),result(),event('task_complete'));
 assert.equal(f.state().state,'needs-input');assert.equal(f.state().executionState,'done');
 assert.equal(f.store.acknowledgeCompletion(KEY,T1),false);
 await f.append(answer());assert.equal(f.state().state,'done');assert.equal(f.state().pendingRequests.length,0);
 await f.append(question(),result());assert.equal(f.state().state,'done','a completed turn cannot start a fresh question');
});

test('new turns and explicit interruption clear old requests without letting old replies clear new ones',async t=>{
 const f=await fixture(t);
 await f.append(question(),result());assert.equal(f.state().state,'needs-input');
 await f.append(event('task_started',T2));assert.equal(f.state().state,'working');
 await f.append(question('q2'),result('q2'),answer('q1'));
 assert.equal(f.state().state,'needs-input');assert.equal(f.state().pendingRequests.length,1);
 await f.append(event('turn_aborted',T2));assert.equal(f.state().state,'idle');assert.equal(f.state().pendingRequests.length,0);
});

test('waiting is stable through silence and can be restored from initial history',async t=>{
 const f=await fixture(t,[event('task_started'),question(),result()]);
 assert.equal(f.state().state,'needs-input');
 f.time(BASE+240000);await f.observer.tick();assert.equal(f.state().state,'needs-input');
 await f.append(answer());assert.equal(f.state().state,'unknown','an old answer timestamp cannot establish fresh execution activity');
});

test('file failure and same-turn reconnect restore pending input, including an already completed turn',async t=>{
 for(const terminal of [false,true]){
  const f=await fixture(t,[event('task_started'),question(),result(),...(terminal?[event('task_complete')]:[])]);
  assert.equal(f.state().state,'needs-input');
  const saved=await fs.readFile(f.file);await fs.unlink(f.file);await f.observer.tick();assert.equal(f.state().state,'unknown');
  await fs.writeFile(f.file,saved);await f.observer.tick();assert.equal(f.state().state,'needs-input');
  await f.append(answer());assert.equal(f.state().state,terminal?'done':'working');
 }
});

test('quoted replies, assistant text, malformed calls and duplicate records cannot invent or reopen input',async t=>{
 const f=await fixture(t);
 const fake=question();fake.payload.name='unrelated_request_user_input_async';
 const malformed=question('bad');malformed.payload.arguments='{"questions":[{}]}';
 await f.append(fake,malformed,answer());assert.equal(f.state().state,'working');
 await f.append(question(),result(),answer('q1',[0],'assistant'));
 assert.equal(f.state().state,'needs-input');
 const quoted=answer();quoted.payload.content[0].text='Quoted example:\n'+quoted.payload.content[0].text;
 await f.append(quoted);assert.equal(f.state().state,'needs-input');
 await f.append(answer(),question(),result());assert.equal(f.state().state,'working');
});

test('async calls without acceptance become unknown when stale and a late acceptance restores waiting',async t=>{
 const f=await fixture(t);
 await f.append(question());assert.equal(f.state().state,'needs-input');
 f.time(BASE+120000);await f.observer.tick();assert.equal(f.state().state,'unknown');
 const accepted=result();accepted.timestamp=new Date(BASE+120000).toISOString();
 await f.append(accepted);assert.equal(f.state().state,'needs-input');
 f.time(BASE+240000);await f.observer.tick();assert.equal(f.state().state,'needs-input');
});

test('completion discards unaccepted calls but retains accepted asynchronous input',async t=>{
 const f=await fixture(t);
 await f.append(question('unaccepted'),event('task_complete'));
 assert.equal(f.state().state,'done');assert.equal(f.state().pendingRequests.length,0);
});

test('restart searches back to the current turn start to recover questions before a large output',async t=>{
 const padding=row('compacted',{summary:'x'.repeat(6*1024*1024)});
 const f=await fixture(t,[event('task_started'),question(),result(),padding,event('task_complete')]);
 assert.equal(f.state().state,'needs-input');assert.equal(f.state().executionState,'done');
 assert.equal(f.state().pendingRequests.length,1);
 await f.append(answer());assert.equal(f.state().state,'done');
});

test('a terminal without a start inside the bounded history confirms execution but not absence of questions',async t=>{
 const padding=row('compacted',{summary:'x'.repeat(17*1024*1024)});
 const f=await fixture(t,[event('task_started'),question(),result(),padding,event('task_complete')]);
 assert.equal(f.state().executionState,'done');assert.equal(f.state().state,'unknown');assert.equal(f.state().questionsKnown,false);
 await f.append(event('task_started',T2));assert.equal(f.state().state,'working');assert.equal(f.state().questionsKnown,true);
});

test('a later terminal-only turn cannot inherit known questions from an earlier completed turn',async t=>{
 const later=row('event_msg',{type:'task_complete',turn_id:T2,started_at:(BASE+1000)/1000},BASE+2000);
 const f=await fixture(t,[event('task_started'),question(),result(),event('task_complete'),later]);
 assert.equal(f.state().turnId,T2);
 assert.equal(f.state().executionState,'done');
 assert.equal(f.state().state,'unknown');
 assert.equal(f.state().questionsKnown,false);
 assert.deepEqual(f.state().pendingRequests,[]);
});

test('a later question answer does not invalidate an earlier read of the completed execution',async t=>{
 const {createCodexReadState,LOCAL_HOST_KEY}=require('../src/codex-read-state.cjs');
 const f=await fixture(t);
 const complete=event('task_complete');complete.timestamp=new Date(BASE+10000).toISOString();
 await f.append(question(),result(),complete);
 assert.equal(f.state().state,'needs-input');
 const file=path.join(f.home,'.codex-global-state.json');
 await fs.writeFile(file,JSON.stringify({'electron-thread-read-state-v1':{version:1,unreadByIdentity:{fixture:{[LOCAL_HOST_KEY]:[]}}}}));
 await fs.utimes(file,(BASE+11000)/1000,(BASE+11000)/1000);
 const reply=answer();reply.timestamp=new Date(BASE+12000).toISOString();f.time(BASE+12000);await f.append(reply);
 assert.equal(f.state().state,'done');assert.equal(f.state().sourceTimestamp,BASE+10000);assert.equal(f.state().attentionTimestamp,BASE+12000);
 let readTime=BASE+12000;
 const read=createCodexReadState({codexHome:f.home,getSessions:()=>f.store.list(),acknowledgeCompletion:(id,turn)=>f.store.acknowledgeCompletion(id,turn),now:()=>readTime});
 try{await read.tick();readTime+=2000;await read.tick();assert.equal(f.state().acknowledgedCompletionTurnId,T1);}finally{await read.stop();}
});

test('same-turn reconnect cannot revive answered questions through a newer activity timestamp',async t=>{
 const at=(entry,offset)=>({...entry,timestamp:new Date(BASE+offset).toISOString()});
 const initial=[event('task_started'),at(question(),1000),at(result(),2000)];
 const f=await fixture(t,initial);
 await f.append(at(answer(),3000));assert.equal(f.state().state,'working');
 await fs.writeFile(f.file,encode([{type:'session_meta',payload:{id:ID}},...initial,at(event('token_count'),4000)]));
 await f.observer.tick();assert.equal(f.state().state,'working');assert.equal(f.state().pendingRequests.length,0);
 assert.equal(f.state().attentionTimestamp,BASE+3000);
 await f.append(at(event('token_count'),5000));assert.equal(f.state().state,'working');
});

test('completed-turn reconnect preserves partial answers even if another call advances question time',async t=>{
 const at=(entry,offset)=>({...entry,timestamp:new Date(BASE+offset).toISOString()});
 const initial=[event('task_started'),at(question('q1',2),1000),at(result(),2000)];
 const tail=[at(question('q2'),4000),at(result('q2'),5000),at(event('task_complete'),6000)];
 const f=await fixture(t,initial);
 await f.append(at(answer('q1',[0]),3000),...tail);
 assert.equal(f.state().pendingRequests.length,2);
 await fs.writeFile(f.file,encode([{type:'session_meta',payload:{id:ID}},...initial,...tail]));
 await f.observer.tick();assert.equal(f.state().pendingRequests.length,2);
 await f.append(at(answer('q1',[1]),7000),at(answer('q2'),8000));
 assert.equal(f.state().state,'done');assert.equal(f.state().pendingRequests.length,0);
});

test('the store rejects older same-turn question snapshots on lifecycle baseline events',async t=>{
 const f=await fixture(t);
 await f.append(question(),result());
 const stale=f.events.at(-1);
 const reply=answer();reply.timestamp=new Date(BASE+1000).toISOString();await f.append(reply);
 assert.equal(f.state().state,'working');
 const accepted=f.store.ingest({...stale,id:'old-question-new-execution',kind:'turn.started',generation:stale.generation+1,baseline:true,resync:true,sourceTimestamp:BASE+2000});
 assert.equal(accepted,false);assert.equal(f.state().state,'working');assert.equal(f.state().pendingRequests.length,0);
});

test('reconnect with a missing acceptance record cannot silently resolve a confirmed question',async t=>{
 const at=(entry,offset)=>({...entry,timestamp:new Date(BASE+offset).toISOString()});
 const first=[event('task_started'),at(question('q1'),1000)];
 const tail=[at(question('q2'),3000),at(result('q2'),4000),at(event('task_complete'),5000)];
 const f=await fixture(t,[...first,at(result('q1'),2000),...tail]);
 assert.equal(f.state().pendingRequests.length,2);
 await fs.writeFile(f.file,encode([{type:'session_meta',payload:{id:ID}},...first,...tail]));
 await f.observer.tick();assert.equal(f.state().pendingRequests.length,2);
 await f.append(at(answer('q2'),6000));
 assert.equal(f.state().state,'needs-input');assert.equal(f.state().pendingRequests.length,1);
 await f.append(at(answer('q1'),7000));assert.equal(f.state().state,'done');
});

test('an explicit post-completion reply remains resolved when replay lacks its acceptance',async t=>{
 const at=(entry,offset)=>({...entry,timestamp:new Date(BASE+offset).toISOString()});
 const first=[event('task_started'),at(question('q1'),1000)];
 const tail=[at(question('q2'),3000),at(result('q2'),4000),at(event('task_complete'),5000)];
 const f=await fixture(t,[...first,at(result('q1'),2000),...tail]);
 await fs.writeFile(f.file,encode([{type:'session_meta',payload:{id:ID}},...first,...tail,at(answer('q1'),6000)]));
 await f.observer.tick();assert.equal(f.state().pendingRequests.length,1);
 assert.ok(f.state().pendingRequests[0].id.includes('q2'));
 await f.append(at(answer('q2'),7000));assert.equal(f.state().state,'done');
});
