'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const {createQuestions,copyQuestions,reconcileQuestions,hasQuestions,hasConfirmedQuestions,questionSnapshot,finishQuestions,consumeQuestionRecord}=require('./codex-questions.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_ID = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const CHUNK_BYTES = 64 * 1024;
const TAIL_BYTES = 4 * 1024 * 1024;
const MAX_BASELINE_BYTES = 16 * 1024 * 1024;
const HEADER_BYTES = 256 * 1024;
const LINE_BYTES = 1024 * 1024;
const STALE_MS = 90000;
const LIFECYCLE = new Map([['task_started', 'turn.started'], ['task_complete', 'turn.completed'], ['turn_aborted', 'turn.interrupted']]);
const decoder = new TextDecoder('utf-8', { fatal: true });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const startedTime = value => Number.isFinite(value) && value > 0 && value * 1000 <= 8640000000000000 ? value * 1000 : null;
const turnId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value) ? value : null;
const inside = (root, file) => file.startsWith(root + path.sep);
const failure = () => new Error('Codex session record unavailable');
const withQuestions = (view, fact) => ({...fact,...questionSnapshot(view.questions)});

// Check every component, not only the final filename. O_NOFOLLOW below also
// rejects a leaf replaced by a symlink between validation and open.
async function safePath(root, file, directory = false) {
  if (!inside(root, file)) throw failure();
  let cursor = root;
  for (const part of path.relative(root, file).split(path.sep)) {
    cursor = path.join(cursor, part);
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink() || (cursor !== file && !info.isDirectory())) throw failure();
    if (cursor === file && !(directory ? info.isDirectory() : info.isFile())) throw failure();
  }
  if (await fs.realpath(file) !== file) throw failure();
}

async function findFiles(root, ids) {
  const result = new Map([...ids].map(id => [id, []]));
  const directories = [root];
  const deadline = Date.now() + 1500;
  let entries = 0;
  for (let i = 0; i < directories.length; i++) {
    if (directories.length > 4096 || Date.now() > deadline) throw failure();
    const directory = directories[i];
    if (directory !== root) await safePath(root, directory, true);
    const handle = await fs.opendir(directory);
    for await (const entry of handle) {
      if (++entries > 25000 || Date.now() > deadline) throw failure();
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(file);
      else if (entry.isFile()) {
        const id = FILE_ID.exec(entry.name)?.[1].toLowerCase();
        if (result.has(id)) {
          const candidates = result.get(id);
          if (candidates.length >= 8) throw failure();
          candidates.push(file);
        }
      }
    }
  }
  for (const files of result.values()) files.sort().reverse();
  return result;
}

async function readHeader(handle, id) {
  let data = Buffer.alloc(0);
  while (data.length < HEADER_BYTES) {
    const buffer = Buffer.alloc(Math.min(4096, HEADER_BYTES - data.length));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, data.length);
    if (!bytesRead) throw failure();
    data = Buffer.concat([data, buffer.subarray(0, bytesRead)]);
    const newline = data.indexOf(10);
    if (newline < 0) continue;
    let header;
    try { header = JSON.parse(decoder.decode(data.subarray(0, newline))); } catch { throw failure(); }
    if (header?.type !== 'session_meta' || typeof header.payload?.id !== 'string' || header.payload.id.toLowerCase() !== id) throw failure();
    return newline + 1;
  }
  throw failure();
}

async function anchor(handle, offset) {
  const buffer = Buffer.alloc(Math.min(128, offset));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset - buffer.length);
  if (bytesRead !== buffer.length) throw failure();
  return createHash('sha256').update(buffer).digest('hex');
}

function retire(view, id) {
  view.retired.add(id);
  if (view.retired.size > 8000) view.retired.delete(view.retired.values().next().value);
}

function provablyNewer(next, previous) {
  return next.turnStartedAt !== null && previous.turnStartedAt !== null &&
    next.sourceTimestamp !== null && previous.sourceTimestamp !== null &&
    next.turnStartedAt > previous.turnStartedAt && next.turnStartedAt <= next.sourceTimestamp &&
    next.sourceTimestamp >= previous.sourceTimestamp;
}

// Only lifecycle identifiers and clocks survive parsing. Generic error/message
// records are activity, never evidence that a turn ended successfully.
function consume(view, row, offset, baseline, changes) {
  if (!isObject(row) || !isObject(row.payload)) return;
  const type = row.payload.type;
  if (!['event_msg', 'response_item', 'turn_context', 'compacted'].includes(row.type)) return;
  if (['event_msg', 'response_item'].includes(row.type) && (typeof type !== 'string' || !type)) return;
  const timestamp = sourceTime(row.timestamp);
  const id = turnId(row.payload.turn_id);
  const current = view.current;
  const kind = row.type === 'event_msg' ? LIFECYCLE.get(type) : null;
  const remember = fact => {
    view.current = fact;
    view.active = true;
    if (!baseline) changes.push(withQuestions(view,fact));
  };
  if (kind) {
    if (!id || view.retired.has(id)) return;
    if (current?.turnId === id && current.kind !== 'turn.started') return;
    let began = startedTime(row.payload.started_at);
    if (kind === 'turn.started') {
      began ??= timestamp;
      if (current?.turnId === id) {
        if (timestamp !== null && (current.sourceTimestamp === null || timestamp >= current.sourceTimestamp)) {
          current.sourceTimestamp = timestamp;
          current.offset = offset;
          view.active = true;
          if (!baseline) changes.push(withQuestions(view,{ ...current, kind: 'activity' }));
        }
        return;
      }
      // Append order establishes successive turns in the same verified file,
      // even when started_at is rounded to the same second. Resync below still
      // requires a strictly newer start time before replacing a known turn.
      if (current && ((began !== null && current.turnStartedAt !== null && began < current.turnStartedAt) ||
        (timestamp !== null && current.sourceTimestamp !== null && timestamp < current.sourceTimestamp))) return;
      if (current) retire(view, current.turnId);
      view.questions = createQuestions(true,timestamp);
    } else {
      began ??= current?.turnId === id ? current.turnStartedAt : null;
      if (current && current.turnId !== id) {
        if (!baseline || current.kind === 'turn.started' || !provablyNewer({ turnStartedAt: began, sourceTimestamp: timestamp }, current)) return;
        retire(view, current.turnId);
        view.questions = createQuestions(false,timestamp);
      }
      if (!current && !baseline) return;
      if (current?.turnId === id && timestamp !== null && current.sourceTimestamp !== null && timestamp < current.sourceTimestamp) return;
      if (kind === 'turn.completed') finishQuestions(view.questions);
      else view.questions = createQuestions(true,timestamp);
    }
    remember({ turnId: id, kind, turnStartedAt: began, sourceTimestamp: timestamp, offset });
    return;
  }
  if (!view.active || !current || timestamp === null || (id && id !== current.turnId)) return;
  if (current.sourceTimestamp !== null && timestamp < current.sourceTimestamp) return;
  const questionsChanged=consumeQuestionRecord(view.questions,row,{active:current.kind==='turn.started',timestamp});
  if (current.kind !== 'turn.started') {
    if (questionsChanged && !baseline) changes.push(withQuestions(view,{...current,kind:'attention.updated',offset}));
    return;
  }
  current.sourceTimestamp = timestamp;
  current.offset = offset;
  if (!baseline) {
    const activity = withQuestions(view,{ ...current, kind: 'activity' });
    if (changes.at(-1)?.kind === 'activity' && changes.at(-1).turnId === current.turnId) changes[changes.length - 1] = activity;
    else changes.push(activity);
  }
}

async function readRows(handle, state, size, baseline, limit = TAIL_BYTES) {
  const view = { current: baseline ? null : state.current && { ...state.current }, retired: new Set(state.retired), active: baseline || state.active, questions:baseline?createQuestions():copyQuestions(state.questions) };
  const changes = [];
  let position = state.offset;
  let pending = state.pending;
  let skip = state.skip;
  let oversized = false;
  let count = 0;
  if (size - position > limit) throw failure();
  while (position < size) {
    const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, size - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw failure();
    let data = buffer.subarray(0, bytesRead);
    let beginning = position - pending.length;
    position += bytesRead;
    if (skip) {
      const newline = data.indexOf(10);
      if (newline < 0) continue;
      beginning += newline + 1;
      data = data.subarray(newline + 1);
      skip = false;
      oversized = false;
    }
    data = pending.length ? Buffer.concat([pending, data]) : data;
    let start = 0;
    let newline;
    while ((newline = data.indexOf(10, start)) >= 0) {
      if (++count > 25000) throw failure();
      if (newline - start > LINE_BYTES) { start = newline + 1; continue; }
      let row;
      try { row = JSON.parse(decoder.decode(data.subarray(start, newline))); } catch { /* incomplete/malformed records do not refresh state */ }
      if (row) consume(view, row, beginning + start, baseline, changes);
      start = newline + 1;
    }
    pending = Buffer.from(data.subarray(start));
    // A complete large compaction/tool-output record is not a lifecycle signal.
    // Discard it without allocating the rest or losing the known current turn.
    if (pending.length > LINE_BYTES) { pending = Buffer.alloc(0); skip = true; oversized = true; }
  }
  if (oversized && skip) throw failure();
  return { view, changes, offset: position, pending, skip };
}

function createCodexStatus({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), getSessions = () => [], onEvent = () => {}, onConnection = () => {}, now = () => Date.now(), pollMs = 1000 } = {}) {
  const home = path.resolve(codexHome);
  const states = new Map();
  let generation = Math.max(Date.now(), now());
  let timer, inFlight, stopped = false, started = false, connection;
  const emit = (state, fact, extra = {}) => {
    if (stopped) return;
    const sequence = ++state.sequence;
    const attention=fact.questionsKnown===undefined?questionSnapshot(state.questions):fact;
    const stale = ['turn.started', 'activity'].includes(fact.kind) && !attention.waitingConfirmed && (fact.sourceTimestamp === null || now() - fact.sourceTimestamp >= STALE_MS);
    onEvent({
      id: `codex-status:${state.id}:${state.fileKey || 'missing'}:${state.generation}:${fact.offset}:${fact.kind}${fact.kind === 'connection.lost' ? ':' + sequence : ''}`,
      provider: 'codex', sessionId: 'codex:' + state.id, turnId: fact.turnId,
      generation: state.generation, sequence, kind: fact.kind, evidence: 'codex-lifecycle',
      timestamp: new Date(now()).toISOString(), sourceTimestamp: fact.sourceTimestamp ?? undefined,
      turnStartedAt: fact.turnStartedAt ?? undefined,
      payload: {questionsKnown:attention.questionsKnown,waitingConfirmed:attention.waitingConfirmed,...(attention.pendingRequests?{pendingRequests:attention.pendingRequests}:{}),attentionTimestamp:attention.attentionTimestamp},
      ...(stale ? { stale: true } : {}), ...extra
    });
  };
  const lose = (state, reset = false) => {
    state.issue = true;
    if (state.current && (state.current.kind === 'turn.started'||hasQuestions(state.questions)) && !state.lost) {
      emit(state, { ...state.current, kind: 'connection.lost' });
      state.lost = true;
    }
    if (reset) {
      state.path = null;
      state.initialized = false;
      state.active = false;
      state.pending = Buffer.alloc(0);
      state.resync = true;
    }
  };
  const report = () => {
    const next = !states.size ? { status: 'idle', error: '' } : [...states.values()].some(state => state.issue) ?
      { status: 'error', error: '일부 Codex 세션의 상태를 확인할 수 없습니다.' } : { status: 'connected', error: '' };
    if (!stopped && JSON.stringify(next) !== connection) { connection = JSON.stringify(next); onConnection(next); }
  };
  async function readFile(state, root, file) {
    await safePath(root, file);
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      await safePath(root, file);
      const live = await fs.lstat(file);
      if (!stat.isFile() || live.ino !== stat.ino || live.dev !== stat.dev) throw failure();
      const fileKey = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      let baseline = !state.initialized || fileKey !== state.fileKey || stat.size < state.offset;
      if (!baseline && state.anchor !== await anchor(handle, state.offset)) baseline = true;
      let baselineStart = 0;
      if (baseline) {
        if (state.initialized) lose(state, true);
        const end = await readHeader(handle, state.id);
        baselineStart = end;
        state.generation = ++generation;
        state.fileKey = fileKey;
        state.offset = Math.max(end, stat.size - TAIL_BYTES);
        state.skip = state.offset > end;
        state.pending = Buffer.alloc(0);
      }
      let result = await readRows(handle, state, stat.size, baseline);
      // A terminal record alone cannot rule out pending asynchronous questions.
      // Expand back to the current turn's start, still in bounded chunks.
      for (let limit = TAIL_BYTES * 2; baseline && (!result.view.current||!result.view.questions.known) && state.offset > baselineStart && limit <= MAX_BASELINE_BYTES; limit *= 2) {
        state.offset = Math.max(baselineStart, stat.size - limit);
        state.skip = state.offset > baselineStart;
        state.pending = Buffer.alloc(0);
        result = await readRows(handle, state, stat.size, true, limit);
      }
      const fingerprint = await anchor(handle, result.offset);
      if (stopped) return;
      state.path = file;
      state.initialized = true;
      state.offset = result.offset;
      state.pending = result.pending;
      state.skip = result.skip;
      state.anchor = fingerprint;
      state.issue = false;
      if (baseline) {
        const candidate = result.view.current;
        const previous = state.current;
        const same = candidate && previous?.turnId === candidate.turnId;
        const terminalAttention=same&&previous.kind!=='turn.started'&&candidate.kind===previous.kind&&candidate.sourceTimestamp>=previous.sourceTimestamp;
        const accepted = candidate && (!previous ||
          (same && previous.kind === 'turn.started' && (previous.sourceTimestamp === null || candidate.sourceTimestamp >= previous.sourceTimestamp)) ||
          (!same && !state.retired.has(candidate.turnId) && provablyNewer(candidate, previous)) || terminalAttention);
        if (accepted) {
          if (same) candidate.turnStartedAt ??= previous.turnStartedAt;
          else if (previous) retire(result.view, previous.turnId);
          if(same&&candidate.kind!=='turn.interrupted'){
            result.view.questions=reconcileQuestions(state.questions,result.view.questions);
            if(candidate.kind==='turn.completed')finishQuestions(result.view.questions);
          }
          state.current = candidate;
          state.active = true;
          state.retired = result.view.retired;
          state.questions = result.view.questions;
          const stale = candidate.kind === 'turn.started' && !hasConfirmedQuestions(state.questions) && (candidate.sourceTimestamp === null || now() - candidate.sourceTimestamp >= STALE_MS);
          emit(state, withQuestions(result.view,terminalAttention?{...candidate,kind:'attention.updated'}:candidate), { baseline: true, resync: state.resync || Boolean(previous), ...(stale ? { stale: true } : {}) });
          state.lost = stale;
          state.issue = stale;
        } else if (previous?.kind === 'turn.started') {
          state.active = false;
          lose(state);
        }
        state.resync = false;
      } else {
        state.current = result.view.current;
        state.active = result.view.active;
        state.retired = result.view.retired;
        state.questions = result.view.questions;
        for (const change of result.changes) emit(state, change);
        if (result.changes.length) state.lost = false;
      }
      if (state.current?.kind === 'turn.started' && !hasConfirmedQuestions(state.questions) && (state.current.sourceTimestamp === null || now() - state.current.sourceTimestamp >= STALE_MS)) lose(state);
      if (state.lost) state.issue = true;
    } finally { await handle.close(); }
  }
  async function runTick() {
    const selected = new Set();
    for (const session of getSessions() || []) {
      if (session?.provider !== 'codex' || !(session.pinned || session.petChosen) || typeof session.id !== 'string') continue;
      const id = session.id.startsWith('codex:') ? session.id.slice(6) : '';
      if (UUID.test(id)) selected.add(id.toLowerCase());
    }
    for (const id of states.keys()) if (!selected.has(id)) states.delete(id);
    for (const id of selected) if (!states.has(id)) states.set(id, {
      id, sequence: 0, generation: ++generation, path: null, initialized: false, current: null,
      retired: new Set(), questions:createQuestions(), active: false, lost: false, issue: false, resync: false, pending: Buffer.alloc(0)
    });
    if (!states.size || stopped) { report(); return; }
    let root;
    try {
      const homeInfo = await fs.lstat(home);
      const rootPath = path.join(home, 'sessions');
      const rootInfo = await fs.lstat(rootPath);
      if (homeInfo.isSymbolicLink() || !homeInfo.isDirectory() || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw failure();
      root = await fs.realpath(rootPath);
    } catch {
      for (const state of states.values()) lose(state, true);
      report(); return;
    }
    const missing = new Set([...states.values()].filter(state => !state.path).map(state => state.id));
    let candidates = new Map();
    try {
      if (missing.size) candidates = await findFiles(root, missing);
    } catch {
      for (const id of missing) lose(states.get(id), true);
    }
    for (const state of states.values()) {
      if (stopped) break;
      const files = state.path ? [state.path] : candidates.get(state.id) || [];
      let read = false;
      for (const file of files) {
        try { await readFile(state, root, file); read = true; break; } catch { lose(state, true); }
      }
      if (!read) lose(state, true);
    }
    report();
  }
  function tick() {
    if (stopped) return Promise.resolve();
    if (!inFlight) inFlight = runTick().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function start() {
    if (started) return tick();
    started = true;
    stopped = false;
    await tick();
    if (!stopped && !timer) {
      timer = setInterval(() => { tick().catch(() => {}); }, Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 1000);
      timer.unref?.();
    }
  }
  async function stop() {
    stopped = true;
    started = false;
    clearInterval(timer);
    timer = null;
    await inFlight;
    states.clear();
  }
  return { start, tick, stop };
}

module.exports = { createCodexStatus };
