'use strict';
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');

// Codex's standard local host key; remote/websocket hosts are deliberately excluded.
const LOCAL_HOST_KEY='local:'+createHash('sha256').update(JSON.stringify(['local','local',null])).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES=16*1024*1024;

function parseReadState(value) {
  const state=value?.['electron-thread-read-state-v1'];
  if(state?.version!==1||!state.unreadByIdentity||typeof state.unreadByIdentity!=='object'||Array.isArray(state.unreadByIdentity))return null;
  // Do not guess the active account if the host retains more than one identity.
  const identities=Object.entries(state.unreadByIdentity);
  if(identities.length!==1)return null;
  const [identity,hosts]=identities[0];
  const unread=hosts?.[LOCAL_HOST_KEY];
  if(!Array.isArray(unread)||unread.some(id=>typeof id!=='string'||!UUID.test(id)))return null;
  return {identity,unread:new Set(unread.map(id=>id.toLowerCase()))};
}

function createCodexReadState({codexHome,getSessions,acknowledgeCompletion,now=()=>Date.now(),pollMs=750,settleMs=1500}) {
  const file=path.join(codexHome,'.codex-global-state.json');
  const candidates=new Map();
  let timer=null,inFlight=null,stopped=false,cache=null,cacheKey=null;
  async function read() {
    let handle;
    try{
      handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('Unsupported read state');
      const key=[stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
      if(key!==cacheKey){
        const buffer=Buffer.alloc(stat.size+1);
        let length=0;
        while(length<buffer.length){
          const result=await handle.read(buffer,length,buffer.length-length,length);
          if(!result.bytesRead)break;
          length+=result.bytesRead;
        }
        const after=await handle.stat();
        if(length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Read state changed');
        const parsed=parseReadState(JSON.parse(buffer.subarray(0,length).toString('utf8')));
        cache=parsed?{...parsed,modifiedAt:stat.mtimeMs}:null;cacheKey=key;
      }
      return cache;
    }catch{cache=null;cacheKey=null;return null;}
    finally{await handle?.close();}
  }
  async function poll() {
    const state=await read();
    if(stopped)return;
    if(!state){candidates.clear();return;}
    const retained=new Set();
    for(const session of getSessions()){
      if(session.provider!=='codex'||!(session.pinned||session.petChosen)||session.evidence!=='codex-lifecycle'||session.state!=='done'||!session.turnId)continue;
      const nativeId=session.id.startsWith('codex:')?session.id.slice(6).toLowerCase():'';
      if(!UUID.test(nativeId)||session.acknowledgedCompletionTurnId===session.turnId)continue;
      // An older saved read state cannot consume a result produced after it.
      if(!Number.isFinite(session.sourceTimestamp)||state.modifiedAt<session.sourceTimestamp||state.unread.has(nativeId))continue;
      retained.add(session.id);
      const key=JSON.stringify([state.identity,session.turnId,session.sourceTimestamp]);
      const candidate=candidates.get(session.id);
      if(candidate?.key!==key)candidates.set(session.id,{key,since:now()});
      else if(now()-candidate.since>=settleMs)acknowledgeCompletion(session.id,session.turnId);
    }
    for(const id of candidates.keys())if(!retained.has(id))candidates.delete(id);
  }
  function tick(){if(stopped)return Promise.resolve();if(!inFlight)inFlight=poll().finally(()=>{inFlight=null;});return inFlight;}
  async function start(){stopped=false;await tick();if(!timer&&!stopped)timer=setInterval(()=>{void tick();},pollMs);}
  async function stop(){stopped=true;clearInterval(timer);timer=null;await inFlight;candidates.clear();}
  return {start,stop,tick};
}
module.exports={createCodexReadState,parseReadState,LOCAL_HOST_KEY};
