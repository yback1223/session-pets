'use strict';
const TOOLS=new Map([
 ['request_user_input','sync'],['functions.request_user_input','sync'],
 ['request_user_input_async','async'],['functions.request_user_input_async','async']
]);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
function createQuestions(known=false,updatedAt=null){return {known,updatedAt,calls:new Map()};}
function copyQuestions(state=createQuestions()){
 return {...state,calls:new Map([...state.calls].map(([id,call])=>[id,{...call,remaining:new Set(call.remaining),resolved:new Set(call.resolved)}]))};
}
// A replacement log may omit an answer we already observed. Same-turn answers
// are monotonic: replay can discover calls, but cannot reopen resolved indices.
function reconcileQuestions(previous,next){
 const merged=copyQuestions(previous);
 if(previous.updatedAt!==null&&(next.updatedAt===null||next.updatedAt<previous.updatedAt)){
  merged.known=previous.known&&next.known;
  return merged;
 }
 merged.known=next.known;
 merged.updatedAt=next.updatedAt;
 for(const [id,call] of next.calls){
  const prior=merged.calls.get(id);
  if(prior){
   prior.resolved=new Set([...prior.resolved,...call.resolved]);
   prior.remaining=new Set(Array.from({length:prior.count},(_,index)=>index).filter(index=>!prior.resolved.has(index)));
   prior.accepted ||= call.accepted;
   prior.returned ||= call.returned;
  }else{
   const count=[...merged.calls.values()].reduce((sum,item)=>sum+item.remaining.size,0);
   if(merged.calls.size>=512||count+call.remaining.size>128){merged.known=false;continue;}
   merged.calls.set(id,{...call,remaining:new Set(call.remaining),resolved:new Set(call.resolved)});
  }
 }
 if([...merged.calls.values()].reduce((sum,call)=>sum+call.remaining.size,0)>128)merged.known=false;
 return merged;
}
function hasQuestions(state){return Boolean(state&&[...state.calls.values()].some(call=>call.remaining.size));}
function hasConfirmedQuestions(state){return Boolean(state?.known&&[...state.calls.values()].some(call=>call.remaining.size&&call.accepted));}
function questionSnapshot(state=createQuestions()){
 const pendingRequests=[];
 if(state.known)for(const [id,call] of state.calls)for(const index of call.remaining)pendingRequests.push({id:`codex-input:${id}:${index}`,source:'codex-request-user-input',kind:'input',generic:false,identified:true});
 return {questionsKnown:state.known,waitingConfirmed:hasConfirmedQuestions(state),...(state.known?{pendingRequests}:{}),attentionTimestamp:state.updatedAt??undefined};
}
function finishQuestions(state){
 for(const call of state.calls.values())if(call.mode!=='async'||!call.accepted)call.remaining.clear();
}
// This state contains identifiers only. Never retain question, option or answer text.
function consumeQuestionRecord(state,row,{active,timestamp}){
 if(row.type!=='response_item'||!object(row.payload)||!Number.isFinite(timestamp)||(state.updatedAt!==null&&timestamp<state.updatedAt))return false;
 const payload=row.payload;
 let changed=false;
 if(payload.type==='function_call'&&active){
  const mode=TOOLS.get(payload.name),id=payload.call_id;
  if(!mode||!identifier(id)||state.calls.has(id))return false;
  const args=parse(payload.arguments),questions=args?.questions;
  if(!Array.isArray(questions)||!questions.length||questions.length>64||questions.some(q=>!object(q)||typeof q[mode==='async'?'title':'question']!=='string'||!q[mode==='async'?'title':'question'].trim()||(mode==='sync'&&!identifier(q.id))))return false;
  const count=[...state.calls.values()].reduce((sum,call)=>sum+call.remaining.size,0);
  if(state.calls.size>=512||count+questions.length>128){state.known=false;changed=true;}
  else {state.calls.set(id,{mode,count:questions.length,accepted:mode==='sync',returned:false,remaining:new Set(questions.map((_,i)=>i)),resolved:new Set()});changed=true;}
 }else if(payload.type==='function_call_output'){
  const call=state.calls.get(payload.call_id);
  if(!call||call.returned)return false;
  call.returned=true;changed=true;
  if(call.mode==='async'&&parse(payload.output)?.accepted===true)call.accepted=true;
  else {for(let index=0;index<call.count;index++)call.resolved.add(index);call.remaining.clear();}
 }else if(payload.type==='message'&&payload.role==='user'&&Array.isArray(payload.content)){
  if(!payload.content.every(part=>object(part)&&['input_text','text'].includes(part.type)&&typeof part.text==='string'))return false;
  const text=payload.content.map(part=>part.text).join('\n').trim();
  const match=/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/.exec(text);
  const replies=match?parse(match[1]):null;
  if(!Array.isArray(replies)||replies.length>128)return false;
  for(const reply of replies){
   if(!object(reply)||!Object.hasOwn(reply,'answer'))continue;
   const key=parse(reply.questionItemId);
   if(!Array.isArray(key)||key.length!==3||TOOLS.get(key[0])!=='async'||!identifier(key[1])||!Number.isInteger(key[2])||key[2]<0||key[2]>=64)continue;
   const call=state.calls.get(key[1]);
   if(call?.mode==='async'&&key[2]<call.count&&!call.resolved.has(key[2])){call.remaining.delete(key[2]);call.resolved.add(key[2]);changed=true;}
  }
 }
 if(changed)state.updatedAt=timestamp;
 return changed;
}
module.exports={createQuestions,copyQuestions,reconcileQuestions,hasQuestions,hasConfirmedQuestions,questionSnapshot,finishQuestions,consumeQuestionRecord};
