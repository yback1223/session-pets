'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SessionStore}=require('../src/store.cjs');
const {normalizeHook}=require('../src/providers.cjs');
let serial=0;
function hook(type,extra={}){return normalizeHook({event_id:'input-test-'+(++serial),session_id:'input-session',hook_event_name:type,...extra},{sequence:serial});}
function question(id='question-1'){return hook('PreToolUse',{tool_name:'AskUserQuestion',tool_use_id:id,tool_input:{questions:[{question:'private question'}]}});}
function answer(id='question-1'){return hook('PostToolUse',{tool_name:'AskUserQuestion',tool_use_id:id,tool_response:{answers:{secret:'private answer'}}});}

test('question and answer metadata work without a prompt ID and exclude their text',()=>{
 const q=question(),a=answer();
 assert.equal(q.kind,'input.requested');assert.equal(a.kind,'input.resolved');
 assert.equal(q.turnId,null);assert.equal(q.payload.requestId,a.payload.requestId);
 assert.equal(JSON.stringify(q).includes('private'),false);assert.equal(JSON.stringify(a).includes('private'),false);
 const s=new SessionStore();s.ingest(q);assert.equal(s.get(q.sessionId).state,'needs-input');
 s.ingest(a);assert.equal(s.get(q.sessionId).state,'unknown');assert.equal(s.get(q.sessionId).pendingRequests.length,0);
});
test('unrelated tool results and a duplicate question do not dismiss or multiply pending input',()=>{
 const s=new SessionStore();const q=question();s.ingest(q);s.ingest(question());
 assert.equal(s.get(q.sessionId).pendingRequests.length,1);
 s.ingest(hook('PostToolUse',{tool_name:'Bash',tool_use_id:'other-tool'}));
 assert.equal(s.get(q.sessionId).state,'needs-input');
 s.ingest(question('question-2'));s.ingest(answer());assert.equal(s.get(q.sessionId).state,'needs-input');
 s.ingest(answer('question-2'));assert.equal(s.get(q.sessionId).state,'unknown');
});
test('input persists during silence and clears on cancellation, a new prompt, or session end',()=>{
 let now=0;const s=new SessionStore({now:()=>now});const q=question();s.ingest(q);now=180000;s.expire();assert.equal(s.get(q.sessionId).state,'needs-input');
 s.ingest(hook('PostToolUseFailure',{tool_name:'AskUserQuestion',tool_use_id:'question-1'}));assert.equal(s.get(q.sessionId).pendingRequests.length,0);
 s.ingest(question());s.ingest(hook('UserPromptSubmit'));assert.equal(s.get(q.sessionId).state,'unknown');
 s.ingest(question());s.ingest(hook('SessionEnd'));assert.equal(s.get(q.sessionId).state,'sleep');assert.equal(s.get(q.sessionId).pendingRequests.length,0);
});
test('plan approval is distinct from questions, and input takes priority',()=>{
 const s=new SessionStore();const p=hook('PreToolUse',{tool_name:'ExitPlanMode',tool_use_id:'plan-1'});s.ingest(p);assert.equal(s.get(p.sessionId).state,'waiting');
 s.ingest(question());assert.equal(s.get(p.sessionId).state,'needs-input');s.ingest(answer());assert.equal(s.get(p.sessionId).state,'waiting');
 s.ingest(hook('PostToolUse',{tool_name:'ExitPlanMode',tool_use_id:'plan-1'}));assert.equal(s.get(p.sessionId).state,'unknown');
});
test('MCP forms without request IDs are counted until each result arrives',()=>{
 const s=new SessionStore();const form=()=>hook('Elicitation',{mcp_server_name:'forms'});
 const q=form();s.ingest(q);s.ingest(form());assert.equal(s.get(q.sessionId).pendingRequests.length,2);
 s.ingest(hook('ElicitationResult',{mcp_server_name:'forms'}));assert.equal(s.get(q.sessionId).state,'needs-input');
 s.ingest(hook('ElicitationResult',{mcp_server_name:'forms'}));assert.equal(s.get(q.sessionId).state,'unknown');
});
test('notifications do not duplicate identified input or turn idle status into a question',()=>{
 const s=new SessionStore();const q=question();s.ingest(q);
 s.ingest(hook('Notification',{notification_type:'elicitation_dialog'}));assert.equal(s.get(q.sessionId).pendingRequests.length,1);
 s.ingest(answer());assert.equal(s.get(q.sessionId).state,'unknown');
 s.ingest(hook('Notification',{notification_type:'idle_prompt'}));assert.equal(s.get(q.sessionId).pendingRequests.length,0);
});
test('a delayed generic form notification cannot reopen an answered request',()=>{
 const s=new SessionStore();const q=hook('Elicitation',{elicitation_id:'form-1',mcp_server_name:'forms'});s.ingest(q);
 s.ingest(hook('ElicitationResult',{elicitation_id:'form-1',mcp_server_name:'forms'}));
 s.ingest(hook('Notification',{notification_type:'elicitation_dialog'}));
 assert.equal(s.get(q.sessionId).pendingRequests.length,0);assert.equal(s.get(q.sessionId).state,'unknown');
});
