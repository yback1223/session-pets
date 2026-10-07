'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const os=require('node:os');
const crypto=require('node:crypto');
const KINDS=['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'];
class CodexReader {
 constructor({env=process.env,spawnProcess=spawn}={}){this.env=env;this.spawnProcess=spawnProcess;this.pending=new Map();this.next=1;this.child=null;this.opening=null;}
 async open(){if(this.opening)return this.opening;const opening=this.initialize();this.opening=opening;opening.catch(()=>{if(this.opening===opening)this.opening=null;});return opening;}
 async initialize(){
  let binary='codex';for(const candidate of ['/opt/homebrew/bin/codex','/usr/local/bin/codex',path.join(os.homedir(),'.local','bin','codex')]){try{await fs.access(candidate);binary=candidate;break;}catch{}}
  const child=this.spawnProcess(binary,['app-server','--stdio'],{env:this.env,stdio:['pipe','pipe','pipe']});this.child=child;
  let buf='',failed=false;const fail=()=>{if(failed)return;failed=true;for(const [key,req]of this.pending){if(req.child!==child)continue;clearTimeout(req.timer);req.reject(new Error('Codex 연결이 종료되었습니다.'));this.pending.delete(key);}if(this.child===child){this.child=null;this.opening=null;}child.kill('SIGTERM');};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);child.stdout.on('error',fail);child.stderr.on('error',fail);
  child.stderr.on('data',()=>{});
  child.stdout.on('data',chunk=>{if(this.child!==child)return;buf+=chunk.toString('utf8');if(buf.length>16*1024*1024){fail();return;}let end;while((end=buf.indexOf('\n'))>=0){const line=buf.slice(0,end);buf=buf.slice(end+1);let msg;try{msg=JSON.parse(line);}catch{continue;}
    if(msg.id!==undefined&&this.pending.has(msg.id)){const req=this.pending.get(msg.id);this.pending.delete(msg.id);clearTimeout(req.timer);msg.error?req.reject(new Error('Codex 조회를 처리하지 못했습니다. CLI와 로그인 상태를 확인하세요.')):req.resolve(msg.result);}
    else if(msg.id!==undefined&&msg.method)this.write(child,{id:msg.id,error:{code:-32601,message:'Read-only observer does not handle execution requests'}});
  }});
  await this.request('initialize',{clientInfo:{name:'session-pets',title:'Session-Pets',version:require('../package.json').version},capabilities:{experimentalApi:true}});
  this.write(child,{method:'initialized',params:{}});
 }
 write(child,value){if(!child||child.stdin.destroyed||child.stdin.writableEnded){if(child)child.stdin.emit('error',new Error('closed'));return;}try{child.stdin.write(JSON.stringify(value)+'\n',error=>{if(error)child.stdin.emit('error',error);});}catch(error){child.stdin.emit('error',error);}}
 request(method,params){if(!this.child)return Promise.reject(new Error('Codex CLI를 실행할 수 없습니다.'));const id=this.next++,child=this.child;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex 조회 시간이 초과되었습니다.'));},15000);this.pending.set(id,{resolve,reject,timer,child});this.write(child,{id,method,params});});}
 async list(){await this.open();const all=[];let cursor;for(let i=0;i<4;i++){const r=await this.request('thread/list',{limit:60,sortKey:'updated_at',sourceKinds:KINDS,useStateDbOnly:true,...(cursor?{cursor}:{})});all.push(...r.data||[]);cursor=r.nextCursor;if(!cursor)break;}return all.map(t=>({id:'codex:'+t.id,nativeId:t.id,provider:'codex',title:String(t.name||t.title||t.preview||'이름 없는 Codex 세션').slice(0,180),parentId:t.parentThreadId?'codex:'+t.parentThreadId:t.source?.subAgent?.thread_spawn?.parent_thread_id?'codex:'+t.source.subAgent.thread_spawn.parent_thread_id:null,state:'unknown',evidence:'persisted-record',mode:'observer',updatedAt:new Date((t.updatedAt||0)*1000).toISOString(),lastMessage:''}));}
 async read(id){if(typeof id!=='string'||!id||id.length>200)throw new Error('세션 ID가 잘못되었습니다.');await this.open();const r=await this.request('thread/turns/list',{threadId:id,limit:5,sortDirection:'desc',itemsView:'full'});for(const turn of r.data||[]){const messages=(turn.items||[]).filter(i=>i.type==='agentMessage'&&typeof i.text==='string');const final=messages.findLast(i=>i.phase==='final_answer')||messages.at(-1);if(final)return final.text.slice(0,60000);}return '아직 저장된 응답이 없습니다.';}
 close(){if(this.child){this.child.kill('SIGTERM');this.child=null;}for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('연결이 닫혔습니다.'));}this.pending.clear();this.opening=null;}
}
function normalizeHook(raw,{generation=1,sequence=1}={}){
 if(!raw||typeof raw.session_id!=='string'||!raw.session_id||raw.session_id.length>200)return null;
 const map={SessionStart:'session.started',UserPromptSubmit:'turn.started',PreToolUse:'activity',PostToolUse:'activity',Notification:raw.notification_type==='permission_prompt'?'approval.pending':'notification.observed',Stop:'response.observed',StopFailure:'turn.failed',SessionEnd:'session.ended',SubagentStart:'subagent.started',SubagentStop:'response.observed'};
 let kind=map[raw.hook_event_name];
 const text=value=>typeof value==='string'&&value.length<=200?value:undefined;
 const tool=text(raw.tool_name),toolId=text(raw.tool_use_id),elicitationId=text(raw.elicitation_id),serverName=text(raw.mcp_server_name);
 let requestId,requestSource,requestKind;
 if(raw.hook_event_name==='PreToolUse'&&['AskUserQuestion','ExitPlanMode'].includes(tool)&&toolId){
  kind='input.requested';requestId='tool:'+toolId;requestSource='tool:'+tool;requestKind=tool==='ExitPlanMode'?'approval':'input';
 }else if(['PostToolUse','PostToolUseFailure'].includes(raw.hook_event_name)&&toolId){
  kind='input.resolved';requestId='tool:'+toolId;requestSource='tool:'+tool;
 }else if(['Elicitation','ElicitationResult'].includes(raw.hook_event_name)){
  kind=raw.hook_event_name==='Elicitation'?'input.requested':'input.resolved';
  requestId=elicitationId?'elicitation:'+elicitationId:undefined;requestSource='elicitation:'+(serverName||'unknown');requestKind='input';
 }else if(raw.hook_event_name==='Notification'){
  // MCP forms use their direct Elicitation/Result pair. Delayed generic notifications
  // have no request ID and could otherwise reopen a form after it was answered.
  if(raw.notification_type==='agent_needs_input'){
   kind='input.requested';requestId='notification:agent-input';requestSource='notification:agent-input';requestKind='input';
  }else if(raw.notification_type==='agent_completed'){
   kind='input.resolved';requestId='notification:agent-input';requestSource='notification:agent-input';
  }else if(raw.notification_type==='permission_prompt'){
   requestId='notification:approval';requestSource='notification:approval';requestKind='approval';
  }
 }
 if(!kind)return null;
 const parent='claude:'+raw.session_id;const agent=typeof raw.agent_id==='string'?raw.agent_id.slice(0,200):null;
 return {id:typeof raw.event_id==='string'?raw.event_id.slice(0,200):crypto.randomUUID(),provider:'claude',sessionId:agent?parent+':agent:'+agent:parent,turnId:typeof raw.prompt_id==='string'?raw.prompt_id.slice(0,200):null,generation,sequence,kind,evidence:'host-event',timestamp:new Date().toISOString(),payload:{requestId,requestSource,requestKind,cwd:typeof raw.cwd==='string'&&path.isAbsolute(raw.cwd)&&raw.cwd.length<=4096&&!/[\x00-\x1f]/.test(raw.cwd)?raw.cwd:undefined,surface:['desktop','cli'].includes(raw.surface)?raw.surface:undefined,title:agent?(raw.agent_type||'Claude 작은 일꾼'):'Claude · '+path.basename(String(raw.cwd||'작업')),parentSessionId:agent?parent:null,text:typeof raw.last_assistant_message==='string'?raw.last_assistant_message.slice(0,60000):undefined}};
}
async function removeStaleSocket(socketPath){
 let info;try{info=await fs.lstat(socketPath);}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(!info.isSocket()||(process.getuid&&info.uid!==process.getuid()))throw new Error('소켓 경로를 사용할 수 없습니다.');
 const active=await new Promise(resolve=>{const s=net.createConnection(socketPath);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',e=>{s.destroy();resolve(e.code!=='ECONNREFUSED'&&e.code!=='ENOENT');});s.setTimeout(250,()=>{s.destroy();resolve(true);});});
 if(active)throw new Error('다른 열두 일꾼 앱이 연결을 사용 중입니다.');await fs.unlink(socketPath);
}
function createProviders({onSnapshot=()=>{},onEvent=()=>{},onConnection=()=>{},dataDir,env}={}){
 const reader=new CodexReader({env:env||process.env});let server,poll,refreshing=false,seq=0;const sockets=new Set();const generation=Date.now();const hookSocketPath=path.join(dataDir,'hooks.sock');
 async function discoverCodex(){if(refreshing)return [];refreshing=true;try{const rows=await reader.list();onSnapshot(rows);onConnection('codex',{status:'connected',error:''});if(!poll){poll=setInterval(()=>discoverCodex().catch(()=>{}),20000);poll.unref();}return rows;}catch(e){onConnection('codex',{status:'error',error:e.message});throw e;}finally{refreshing=false;}}
 async function startClaude(){try{
  await fs.mkdir(dataDir,{recursive:true,mode:0o700});await removeStaleSocket(hookSocketPath);
  server=net.createServer(socket=>{sockets.add(socket);let data='';socket.setTimeout(800,()=>socket.destroy());socket.on('data',chunk=>{data+=chunk.toString('utf8');if(Buffer.byteLength(data)>256*1024)socket.destroy();});socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.on('end',()=>{if(Buffer.byteLength(data)>256*1024)return;try{const raw=JSON.parse(data);const e=normalizeHook(raw,{generation,sequence:++seq});if(e){onEvent(e);onConnection('claude',{status:'connected',error:''});}}catch{}});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(hookSocketPath,resolve);});await fs.chmod(hookSocketPath,0o600);onConnection('claude',{status:'idle',error:''});
 }catch(e){onConnection('claude',{status:'error',error:e.message});}}
 async function stop(){clearInterval(poll);reader.close();for(const s of sockets)s.destroy();if(server?.listening){await new Promise(resolve=>server.close(resolve));try{await fs.unlink(hookSocketPath);}catch{}}}
 return {discoverCodex,readCodex:id=>reader.read(id),startClaude,stop,hookSocketPath};
}
module.exports={createProviders,CodexReader,normalizeHook,removeStaleSocket};
