'use strict';
const { EventEmitter } = require('node:events');
const OFF = Object.freeze({ send: false, model: false, interrupt: false });
function codexAttention(payload) {
  if(payload?.questionsKnown===false)return {known:false};
  const requests=payload?.pendingRequests;
  if(payload?.questionsKnown!==true||!Array.isArray(requests)||requests.length>128||requests.some(r=>!r||typeof r.id!=='string'||!r.id||r.id.length>256||r.source!=='codex-request-user-input'||r.kind!=='input'||r.generic!==false||r.identified!==true))return null;
  return {known:true,requests:requests.map(r=>({id:r.id,source:r.source,kind:r.kind,generic:false,identified:true})),confirmed:payload.waitingConfirmed===true};
}
function updateAttention(session,event) {
  if(['turn.started','subagent.started','session.started','session.ended','connection.lost','turn.failed','turn.interrupted','turn.completed','subagent.completed','response.observed'].includes(event.kind)) {
    session.pendingRequests=[];return;
  }
  let requests=session.pendingRequests||[];
  const payload=event.payload||{};
  if(['input.requested','approval.pending'].includes(event.kind)) {
    const kind=event.kind==='approval.pending'||payload.requestKind==='approval'?'approval':'input';
    const source=payload.requestSource||'notification:'+kind;
    const generic=source.startsWith('notification:');
    const id=payload.requestId||(generic?source:event.id);
    // Delayed notifications must not duplicate a request already identified by its tool ID.
    if(generic&&requests.some(request=>request.kind===kind&&!request.generic))return;
    requests=requests.filter(request=>request.id!==id&&(generic||!request.generic||request.kind!==kind));
    requests.push({id,source,kind,generic,identified:Boolean(payload.requestId)});
  } else if(['input.resolved','approval.resolved'].includes(event.kind)) {
    if(event.kind==='approval.resolved'&&!payload.requestId&&!payload.requestSource)requests=requests.filter(request=>request.kind!=='approval');
    else {
      const index=payload.requestId?requests.findIndex(request=>request.id===payload.requestId):requests.findIndex(request=>!request.identified&&request.source===payload.requestSource);
      if(index>=0)requests=requests.filter((_,i)=>i!==index);
    }
  }
  session.pendingRequests=requests;
}
class SessionStore extends EventEmitter {
  constructor({ now = () => Date.now(), staleMs = 90000 } = {}) {
    super(); this.now = now; this.staleMs = staleMs; this.sessions = new Map();
    this.seen = new Set(); this.completed = new Set(); this.retired = new Set(); this.serial = new Map();
  }
  list() { return [...this.sessions.values()].map(s => ({ ...s })); }
  get(id) { return this.sessions.get(id); }
  publish() { this.emit('change', this.list()); }
  acknowledgeCompletion(id, turnId) {
    const session = this.get(id);
    // Opening an older result must never dismiss a newer turn's notification.
    if (!turnId || session?.state !== 'done' || session.turnId !== turnId || session.acknowledgedCompletionTurnId === turnId) return false;
    session.acknowledgedCompletionTurnId = turnId;
    this.publish();
    return true;
  }
  patch(id, values) {
    const s = this.get(id); if (!s) throw new Error('세션을 찾을 수 없습니다.');
    Object.assign(s, values, { capabilities: OFF }); this.publish(); return s;
  }
  snapshot(records) {
    for (const r of records) {
      if (!r.id || !['codex', 'claude'].includes(r.provider)) continue;
      const prev = this.get(r.id);
      const s = { id:r.id, provider:r.provider, title:r.title || '이름 없는 세션', parentId:null, state:'unknown', evidence:'persisted-record', lastMessage:'', updatedAt:new Date(this.now()).toISOString(), mode:'observer', petId:'gorilla', pinned:false, ...r, ...prev };
      // Metadata snapshots must never turn an external session into a live success.
      if (r.title) s.title = r.title;
      if (r.parentId !== undefined) s.parentId = r.parentId;
      if (r.cwd) s.cwd = r.cwd;
      if (r.surface) s.surface = r.surface;
      if (!prev || prev.evidence === 'persisted-record') { s.state='unknown'; s.updatedAt=r.updatedAt || s.updatedAt; }
      s.capabilities=OFF; this.sessions.set(s.id,s);
    }
    this.publish();
  }
  ingest(e) {
    if (!e || !e.id || !e.sessionId || !['codex','claude'].includes(e.provider)) return false;
    const eventKey = `${e.provider}:${e.id}`;
    if (this.seen.has(eventKey)) return false;
    this.seen.add(eventKey); if (this.seen.size > 8000) this.seen.delete(this.seen.values().next().value);
    let s=this.get(e.sessionId);
    if (!s) {
      s={id:e.sessionId,provider:e.provider,title:e.payload?.title || (e.provider==='claude'?'Claude 세션':'작업 세션'),state:'unknown',parentId:e.payload?.parentSessionId||null,petId:'gorilla',pinned:false,lastMessage:'',mode:'observer',capabilities:OFF};
      this.sessions.set(s.id,s);
    }
    const generation=Number.isFinite(e.generation)?e.generation:0;
    const sequence=Number.isFinite(e.sequence)?e.sequence:0;
    if (generation < (s.generation || 0)) return false;
    if (e.provider !== 'claude' && generation === s.generation && sequence && sequence <= (s.sequence || 0)) return false;
    const turn=e.turnId || null;
    const current=s.turnId || null;
    const terminalKey=`${s.id}:${turn}`;
    const begins=['turn.started','subagent.started'].includes(e.kind);
    const codexLifecycle=e.provider==='codex'&&e.evidence==='codex-lifecycle'&&Boolean(turn);
    const attention=codexLifecycle?codexAttention(e.payload):null;
    const attentionUpdate=attention&&e.kind==='attention.updated'&&current===turn;
    const closedConnectionLoss=attention&&e.kind==='connection.lost'&&current===turn;
    if(e.kind==='attention.updated'&&!attentionUpdate)return false;
    if(attention&&current===turn&&Number.isFinite(e.payload.attentionTimestamp)&&Number.isFinite(s.attentionTimestamp)&&e.payload.attentionTimestamp<s.attentionTimestamp)return false;
    const terminal=['turn.completed','turn.failed','turn.interrupted'].includes(e.kind);
    const baselineTerminal=codexLifecycle&&e.baseline&&terminal;
    const baselineState=codexLifecycle&&e.baseline&&(terminal||begins);
    const newerBaseline=baselineState&&e.resync&&(s.state==='unknown'||this.completed.has(`${s.id}:${current}`))&&
      Number.isFinite(e.sourceTimestamp)&&Number.isFinite(s.sourceTimestamp)&&e.sourceTimestamp>=s.sourceTimestamp&&
      Number.isFinite(e.turnStartedAt)&&Number.isFinite(s.turnStartedAt)&&e.turnStartedAt>s.turnStartedAt&&
      !this.retired.has(terminalKey)&&!this.completed.has(terminalKey);
    if(baselineState&&current&&turn!==current&&!newerBaseline)return false;
    // A late start for a retired/completed turn cannot resurrect it.
    if (begins && turn && (this.retired.has(terminalKey)||this.completed.has(terminalKey))) return false;
    if (begins && turn && current && current !== turn) this.retired.add(`${s.id}:${current}`);
    if (turn && current && turn !== current && !begins && !newerBaseline) return false;
    if (turn && this.completed.has(terminalKey) && e.kind !== 'session.ended'&&!attentionUpdate&&!closedConnectionLoss) return false;
    s.generation=generation; s.sequence=sequence;
    if(codexLifecycle){
      if(Number.isFinite(e.sourceTimestamp))s.sourceTimestamp=Math.max(s.sourceTimestamp||0,e.sourceTimestamp);
      if(Number.isFinite(e.turnStartedAt)&&(!Number.isFinite(s.turnStartedAt)||turn!==current))s.turnStartedAt=e.turnStartedAt;
      if(baselineTerminal&&(!current||newerBaseline)){
        if(current&&current!==turn)this.retired.add(`${s.id}:${current}`);
        s.turnId=turn;s.ended=false;
      }
    }
    s.updatedAt=new Date(this.now()).toISOString(); s.lastObservedAt=this.now(); s.evidence=e.evidence || 'host-event';
    if (e.payload?.title) s.title=String(e.payload.title).slice(0,180);
    if (e.payload?.parentSessionId) s.parentId=e.payload.parentSessionId;
    if (e.payload?.cwd) s.cwd=e.payload.cwd;
    if (e.payload?.surface) s.surface=e.payload.surface;
    if (begins) { s.turnId=turn; s.ended=false; }
    if(attention){
      s.questionsKnown=attention.known;
      if(attention.known)s.pendingRequests=attention.requests;
      else if(current!==turn)s.pendingRequests=[];
      if(Number.isFinite(e.payload.attentionTimestamp))s.attentionTimestamp=e.payload.attentionTimestamp;
    }else updateAttention(s,e);
    if (e.kind==='subagent.started') s.hasObservedStart=true;
    if (e.kind==='session.started') { s.state='unknown'; s.ended=false; s.turnId=null; }
    else if (e.kind==='connection.lost') s.state='unknown';
    else if (attentionUpdate) s.state=s.executionState||'unknown';
    else if (e.kind==='session.ended') { s.state='sleep'; s.ended=true; }
    else if (!turn || (!current && !begins && !baselineTerminal)) { s.state='unknown'; }
    else if (begins || ['activity','input.resolved','approval.resolved'].includes(e.kind)) s.state=codexLifecycle&&e.stale?'unknown':'working';
    else if (e.kind==='approval.pending') s.state='waiting';
    else if (e.kind==='response.observed') { s.state='observed'; if (e.payload?.text) s.lastMessage=String(e.payload.text).slice(0,60000); }
    else if (['turn.completed','subagent.completed'].includes(e.kind)) {
      // An explicit Codex turn terminal record also verifies execution completion.
      // Generic hook notifications and assistant message text cannot grant it.
      if (s.mode==='managed'||codexLifecycle) {
        s.state='done'; this.completed.add(terminalKey);
        if (e.payload?.text) s.lastMessage=String(e.payload.text).slice(0,60000);
        if (!e.baseline) this.emit('completed',{...s});
      } else { s.state='observed'; if (e.payload?.text) s.lastMessage=String(e.payload.text).slice(0,60000); }
    } else if (['turn.failed','turn.interrupted'].includes(e.kind)) { s.state=e.kind==='turn.failed'?'error':'idle'; this.completed.add(terminalKey); }
    if(codexLifecycle&&!attentionUpdate&&!closedConnectionLoss&&e.kind!=='connection.lost')s.executionState=s.state;
    if(attention&&(!attention.known||e.kind==='connection.lost'||(e.stale&&!attention.confirmed)))s.state='unknown';
    else if(s.pendingRequests?.length)s.state=s.pendingRequests.some(request=>request.kind==='input')?'needs-input':'waiting';
    if (e.kind==='message.sent' && e.payload?.receiverSessionId) this.emit('link',{from:s.id,to:e.payload.receiverSessionId});
    this.publish(); return true;
  }
  expire() {
    let changed=false;
    for (const s of this.sessions.values()) {
      if(s.provider==='claude' && !s.ended && !s.pendingRequests?.length && !['unknown','done'].includes(s.state) && this.now()-(s.lastObservedAt||0)>this.staleMs) { s.state='unknown'; changed=true; }
    }
    if(changed)this.publish();
  }
}
module.exports={SessionStore};
