'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCodexStatus } = require('../src/codex-status.cjs');
const { SessionStore } = require('../src/store.cjs');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BASE = Date.parse('2026-10-07T00:00:00.000Z');
const header = (id = A, extra = {}) => JSON.stringify({ type: 'session_meta', payload: { id, ...extra } }) + '\n';
const record = (type, turn_id, time = BASE, extra = {}) => JSON.stringify({ timestamp: new Date(time).toISOString(), type: 'event_msg', payload: { type, turn_id, ...extra } }) + '\n';

async function fixture(t, { initial = header(), sessions, pollMs = 1000 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-status-'));
  const file = id => path.join(directory, 'sessions', '2026', '10', '07', `rollout-2026-10-07T00-00-00-${id}.jsonl`);
  await fs.mkdir(path.dirname(file(A)), { recursive: true });
  if (initial !== null) await fs.writeFile(file(A), initial);
  let time = BASE;
  const events = [], connections = [];
  const store = new SessionStore({ now: () => time });
  let selected = sessions || [{ id: 'codex:' + A, provider: 'codex', pinned: true }];
  store.snapshot(selected);
  let completed = 0;
  store.on('completed', () => completed++);
  const observer = createCodexStatus({
    codexHome: directory, getSessions: () => selected, now: () => time, pollMs,
    onEvent: event => { events.push(event); store.ingest(event); },
    onConnection: state => connections.push(state)
  });
  t.after(async () => { await observer.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return {
    directory, file, observer, store, events, connections,
    setTime: value => { time = value; }, setSessions: value => { selected = value; },
    completed: () => completed, state: (id = A) => store.get('codex:' + id),
    append: async (type, turn = T1, at = time, extra = {}, id = A) => {
      await fs.appendFile(file(id), record(type, turn, at, extra));
      await observer.tick();
    }
  };
}

test('real append pipeline distinguishes turn completion, messages, late turns and explicit interruption', async t => {
  const f = await fixture(t);
  await f.observer.tick();
  assert.equal(f.events.length, 0);
  await f.append('task_started');
  assert.equal(f.state().state, 'working');
  assert.equal(f.events.at(-1).evidence, 'codex-lifecycle');
  assert.equal(f.events.at(-1).turnStartedAt, BASE);
  assert.equal(f.events.at(-1).sourceTimestamp, BASE);
  const count = f.events.length;
  await f.observer.tick();
  assert.equal(f.events.length, count);
  await f.append('item_completed', T1, BASE + 1000);
  await f.append('agent_message', T1, BASE + 2000, { message: 'PRIVATE ANSWER' });
  assert.equal(f.state().state, 'working');
  assert.equal(f.completed(), 0);
  await f.append('task_complete', T1, BASE + 3000, { last_agent_message: 'PRIVATE ANSWER' });
  assert.equal(f.state().state, 'done');
  assert.equal(f.completed(), 1);
  const terminalCount = f.events.length;
  await f.append('agent_message', T1, BASE + 4000);
  await f.append('task_complete', T1, BASE + 5000);
  assert.equal(f.events.length, terminalCount);
  await f.append('task_started', T2, BASE + 6000);
  await f.append('task_complete', T1, BASE + 7000);
  assert.equal(f.state().turnId, T2);
  assert.equal(f.state().state, 'working');
  await f.append('turn_aborted', null, BASE + 8000);
  assert.equal(f.state().state, 'working', 'an interruption without a matching explicit ID is not inferred');
  await f.append('turn_aborted', T2, BASE + 9000);
  assert.equal(f.state().state, 'idle');
  await f.append('agent_message', T2, BASE + 10000);
  assert.equal(f.state().state, 'idle');
  assert.equal(f.completed(), 1);
  assert.equal(JSON.stringify(f.events).includes('PRIVATE'), false);
  assert.equal(new Set(f.events.map(event => event.id)).size, f.events.length);
  assert.ok(f.events.every((event, i) => !i || event.sequence > f.events[i - 1].sequence));
});

test('initial history emits only its latest confirmed turn and does not replay old completion', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1, BASE - 4000) + record('task_complete', T1, BASE - 3000) + record('task_started', T2, BASE - 2000) + record('agent_message', T2, BASE - 1000) });
  await f.observer.tick();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, 'turn.started');
  assert.equal(f.events[0].turnId, T2);
  assert.equal(f.events[0].baseline, true);
  assert.equal(f.events[0].sourceTimestamp, BASE - 1000);
  assert.equal(f.events[0].turnStartedAt, BASE - 2000);
  assert.equal(f.completed(), 0);
});

test('a terminal baseline without a visible start preserves execution facts but leaves question state unknown', async t => {
  const f = await fixture(t, { initial: header() + record('task_complete', T1, BASE - 1000, { started_at: (BASE - 10000) / 1000, last_agent_message: 'DO NOT EXPOSE' }) });
  await f.observer.tick();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, 'turn.completed');
  assert.equal(f.events[0].turnStartedAt, BASE - 10000);
  assert.equal(f.state().executionState, 'done');
  assert.equal(f.state().state, 'unknown');
  assert.equal(f.state().questionsKnown, false);
  assert.equal(f.completed(), 0);
  assert.equal(JSON.stringify(f.events).includes('DO NOT EXPOSE'), false);
  f.setTime(BASE + 7200000);
  await f.observer.tick();
  assert.equal(f.state().executionState, 'done');
  assert.equal(f.state().state, 'unknown');
});

test('old baselines start unknown; touch, malformed lines and unrecognized records do not refresh them', async t => {
  const old = BASE - 7200000;
  const f = await fixture(t, { initial: header() + record('task_started', T1, old) });
  const renders = [];
  f.store.on('change', () => renders.push(f.state().state));
  await f.observer.tick();
  assert.equal(f.events[0].stale, true);
  assert.equal(f.state().state, 'unknown');
  assert.ok(!renders.includes('working'));
  const count = f.events.length;
  await fs.utimes(f.file(A), new Date(), new Date());
  await fs.appendFile(f.file(A), '{broken}\n' + JSON.stringify({ timestamp: new Date(BASE).toISOString(), random: 'not a record' }) + '\n');
  await f.observer.tick();
  assert.equal(f.events.length, count);
  assert.equal(f.state().state, 'unknown');
  await f.append('agent_message', T1, BASE);
  assert.equal(f.state().state, 'working');
  f.setTime(BASE + 90000);
  await f.observer.tick();
  assert.equal(f.state().state, 'unknown');
  assert.equal(f.events.at(-1).kind, 'connection.lost');
  assert.equal(f.events.at(-1).turnStartedAt, old);
  assert.equal(f.events.at(-1).sourceTimestamp, BASE);
  const lostCount = f.events.length;
  await f.observer.tick();
  assert.equal(f.events.length, lostCount);
  await f.append('agent_message', T1, BASE + 90000);
  assert.equal(f.state().state, 'working');
  await f.append('task_complete', T1, BASE + 91000);
  assert.equal(f.state().state, 'done');
});

test('two selected sessions stay independent and unselected/invalid/provider-mismatched files are never opened', async t => {
  const sessions = [
    { id: 'codex:' + A, provider: 'codex', pinned: true },
    { id: 'codex:' + B, provider: 'codex', petChosen: true },
    { id: 'codex:' + C, provider: 'codex', pinned: false },
    { id: 'codex:../../outside', provider: 'codex', pinned: true },
    { id: 'codex:' + C, provider: 'claude', pinned: true }
  ];
  const f = await fixture(t, { sessions, initial: header() + record('task_started', T1) });
  await fs.writeFile(f.file(B), header(B) + record('task_started', T2) + record('task_complete', T2));
  await fs.writeFile(f.file(C), header(C) + record('task_started', T3, BASE, { prompt: 'UNSELECTED SECRET' }));
  const opened = [];
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => { opened.push(String(file)); return open(file, ...args); });
  await f.observer.tick();
  assert.equal(f.state(A).state, 'working');
  assert.equal(f.state(B).state, 'done');
  assert.ok(opened.every(file => file.endsWith(A + '.jsonl') || file.endsWith(B + '.jsonl')));
  await f.append('task_complete', T1, BASE + 1000);
  assert.equal(f.state(A).state, 'done');
  assert.equal(f.state(B).state, 'done');
  f.setSessions([sessions[1]]);
  const count = f.events.length;
  await f.append('task_started', T3, BASE + 2000);
  assert.equal(f.events.length, count);
  assert.equal(JSON.stringify(f.events).includes('UNSELECTED'), false);
});

test('incorrect headers and filename IDs are rejected and can be retried after correction', async t => {
  const f = await fixture(t, { initial: header(B) + record('task_started', T1) });
  await fs.writeFile(f.file(C), header(A) + record('task_started', T1));
  await f.observer.tick();
  assert.equal(f.events.length, 0);
  assert.equal(f.connections.at(-1).status, 'error');
  await fs.writeFile(f.file(A), header() + record('task_started', T1));
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  assert.equal(f.connections.at(-1).status, 'connected');
});

test('symlink files, nested directories and the sessions root do not cross the read boundary', async t => {
  const f = await fixture(t, { initial: null });
  const outside = path.join(f.directory, 'outside');
  await fs.mkdir(outside);
  const external = path.join(outside, `rollout-${A}.jsonl`);
  await fs.writeFile(external, header() + record('task_started', T1));
  await fs.symlink(external, f.file(A));
  await fs.symlink(outside, path.join(f.directory, 'sessions', 'linked'));
  const opened = [];
  const open = fs.open;
  t.mock.method(fs, 'open', async (file, ...args) => { opened.push(file); return open(file, ...args); });
  await f.observer.tick();
  assert.equal(f.events.length, 0);
  assert.deepEqual(opened, []);
  await fs.rm(path.join(f.directory, 'sessions'), { recursive: true });
  await fs.symlink(outside, path.join(f.directory, 'sessions'));
  await f.observer.tick();
  assert.deepEqual(opened, []);
  assert.equal(f.connections.at(-1).status, 'error');
});

test('partial JSON and split UTF-8 are buffered until a complete line, without exposing content', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  const line = Buffer.from(record('task_complete', T1, BASE + 1000, { last_agent_message: 'PRIVATE 비밀😀 RESPONSE' }));
  const split = line.indexOf(Buffer.from('😀')) + 2;
  await fs.appendFile(f.file(A), line.subarray(0, split));
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  await fs.appendFile(f.file(A), line.subarray(split, -1));
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  await fs.appendFile(f.file(A), '\n');
  await f.observer.tick();
  assert.equal(f.state().state, 'done');
  assert.equal(f.completed(), 1);
  assert.equal(JSON.stringify(f.events).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(f.events).includes('비밀'), false);
});

test('malformed UTF-8 and JSON do not block subsequent complete valid records', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  const malformed = Buffer.concat([Buffer.from('{"type":"event_msg","payload":{"type":"agent_message","message":"'), Buffer.from([255]), Buffer.from('"}}\n{broken}\n')]);
  await fs.appendFile(f.file(A), malformed);
  const count = f.events.length;
  await f.observer.tick();
  assert.equal(f.events.length, count);
  await f.append('task_complete', T1, BASE + 1000);
  assert.equal(f.state().state, 'done');
});

test('a 146 MiB file uses a bounded tail and then only incremental bytes', async t => {
  const f = await fixture(t, { initial: header(A, { instructions: 'x'.repeat(22000) }) });
  const handle = await fs.open(f.file(A), 'r+');
  await handle.truncate(146 * 1024 * 1024);
  await handle.close();
  await fs.appendFile(f.file(A), '\n' + record('task_complete', T1, BASE, { started_at: (BASE - 1000) / 1000 }));
  const reads = [];
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const file = await open(...args);
    const read = file.read.bind(file);
    file.read = async (...values) => { const result = await read(...values); reads.push({ length: values[2], position: values[3], bytes: result.bytesRead }); return result; };
    return file;
  });
  await f.observer.tick();
  assert.equal(f.state().executionState, 'done');
  assert.equal(f.state().state, 'unknown');
  assert.equal(f.state().questionsKnown, false);
  assert.equal(f.completed(), 0);
  assert.ok(reads.every(read => read.length <= 64 * 1024));
  assert.ok(reads.reduce((sum, read) => sum + read.bytes, 0) <= 28 * 1024 * 1024 + 256 * 1024 + 128);
  assert.ok(reads.some(read => read.position > 140 * 1024 * 1024));
  reads.length = 0;
  await f.append('task_started', T2, BASE + 1000);
  assert.equal(f.state().state, 'working');
  assert.ok(reads.reduce((sum, read) => sum + read.bytes, 0) < 4096);
});

test('oversized headers and partial rows fail boundedly and resume after replacement', async t => {
  const f = await fixture(t, { initial: header(A, { instructions: 'x'.repeat(260 * 1024) }) + record('task_started', T1) });
  await f.observer.tick();
  assert.equal(f.events.length, 0);
  assert.equal(f.connections.at(-1).status, 'error');
  await fs.writeFile(f.file(A), header() + record('task_started', T1));
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  await fs.appendFile(f.file(A), 'x'.repeat(1024 * 1024 + 1));
  await f.observer.tick();
  assert.equal(f.state().state, 'unknown');
  assert.equal(f.events.at(-1).kind, 'connection.lost');
  await fs.writeFile(f.file(A), header() + record('task_started', T2, BASE + 1000));
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  assert.equal(f.state().turnId, T2);
});

test('a complete oversized compaction does not break later activity and completion', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  const compaction = JSON.stringify({ type: 'compacted', timestamp: new Date(BASE + 1000).toISOString(), payload: { summary: 'private'.repeat(180000) } }) + '\n';
  await fs.appendFile(f.file(A), compaction + record('item_completed', T1, BASE + 2000));
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  assert.equal(f.state().sourceTimestamp, BASE + 2000);
  assert.ok(!f.events.some(event => event.kind === 'connection.lost'));
  assert.ok(!JSON.stringify(f.events).includes('private'));
  await f.append('task_complete', T1, BASE + 3000);
  assert.equal(f.state().state, 'done');
});

test('startup expands its bounded lookback when a long current turn starts before the ordinary tail', async t => {
  const compaction = JSON.stringify({ type: 'compacted', payload: { summary: 'x'.repeat(6 * 1024 * 1024) } }) + '\n';
  const f = await fixture(t, { initial: header() + record('task_started', T1) + compaction + record('item_completed', T1, BASE + 1000) });
  await f.observer.tick();
  assert.equal(f.state().state, 'working');
  assert.equal(f.state().turnId, T1);
  assert.equal(f.state().sourceTimestamp, BASE + 1000);
  await f.append('task_complete', T1, BASE + 2000);
  assert.equal(f.state().state, 'done');
});

test('file disappearance preserves causal metadata and resync accepts a newer terminal-only baseline', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  await fs.unlink(f.file(A));
  await f.observer.tick();
  assert.equal(f.state().state, 'unknown');
  assert.equal(f.events.at(-1).kind, 'connection.lost');
  assert.equal(f.events.at(-1).turnStartedAt, BASE);
  assert.equal(f.events.at(-1).sourceTimestamp, BASE);
  const connectionCount = f.connections.length;
  await f.observer.tick();
  assert.equal(f.connections.length, connectionCount);
  await fs.writeFile(f.file(A), header() + record('task_complete', T2, BASE + 2000, { started_at: (BASE + 1000) / 1000 }));
  await f.observer.tick();
  assert.equal(f.events.at(-1).baseline, true);
  assert.equal(f.events.at(-1).resync, true);
  assert.equal(f.state().state, 'unknown');
  assert.equal(f.state().executionState, 'done');
  assert.equal(f.state().questionsKnown, false);
  assert.equal(f.state().turnId, T2);
  assert.equal(f.completed(), 0);
  await fs.unlink(f.file(A));
  await f.observer.tick();
  assert.equal(f.state().executionState, 'done', 'losing a file cannot erase a confirmed execution completion');
  assert.equal(f.state().state, 'unknown');
});

test('a later timestamp on an older completion cannot replace the current turn during resync', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T2, BASE + 2000) });
  await f.observer.tick();
  await fs.unlink(f.file(A));
  await f.observer.tick();
  await fs.writeFile(f.file(A), header() + record('task_complete', T1, BASE + 4000, { started_at: BASE / 1000 }));
  await f.observer.tick();
  assert.equal(f.state().turnId, T2);
  assert.equal(f.state().state, 'unknown');
  await f.append('agent_message', T1, BASE + 5000);
  assert.equal(f.state().state, 'unknown');
  await f.append('task_started', T3, BASE + 6000);
  assert.equal(f.state().state, 'working');
  assert.equal(f.state().turnId, T3);
});

test('rotation and same-inode truncation/regrowth revalidate the header and do not replay stale bytes', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  const firstGeneration = f.events[0].generation;
  await fs.rename(f.file(A), f.file(A) + '.old');
  await fs.writeFile(f.file(A), header() + record('task_started', T2, BASE + 1000));
  await f.observer.tick();
  assert.equal(f.state().turnId, T2);
  assert.ok(f.events.at(-1).generation > firstGeneration);
  assert.equal(f.events.at(-1).resync, true);
  await fs.writeFile(f.file(A), header(A, { instructions: 'regrown'.repeat(100) }) + record('task_started', T3, BASE + 2000));
  await f.observer.tick();
  assert.equal(f.state().turnId, T3);
  assert.equal(f.state().state, 'working');
  assert.equal(f.events.filter(event => event.kind === 'connection.lost').length, 2);
  assert.equal(f.completed(), 0);
});

test('an inaccessible selected session does not erase another selected session state', async t => {
  const f = await fixture(t, { sessions: [{ id: 'codex:' + A, provider: 'codex', pinned: true }, { id: 'codex:' + B, provider: 'codex', pinned: true }], initial: header() + record('task_started', T1) });
  await fs.writeFile(f.file(B), header(B) + record('task_started', T2));
  await f.observer.tick();
  await fs.unlink(f.file(A));
  await f.observer.tick();
  assert.equal(f.state(A).state, 'unknown');
  assert.equal(f.state(B).state, 'working');
  await f.append('task_complete', T2, BASE + 1000, {}, B);
  assert.equal(f.state(B).state, 'done');
  assert.equal(f.state(A).state, 'unknown');
});

test('concurrent ticks share one read and stop closes resources and polling', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1), pollMs: 10 });
  const open = fs.open;
  let opened = 0, closed = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    opened++;
    const close = handle.close.bind(handle);
    handle.close = async () => { closed++; return close(); };
    return handle;
  });
  const first = f.observer.tick();
  const second = f.observer.tick();
  assert.equal(first, second);
  await first;
  assert.equal(f.events.length, 1);
  await f.observer.start();
  await f.observer.stop();
  const total = opened;
  await fs.appendFile(f.file(A), record('task_complete', T1, BASE + 1000));
  await f.observer.tick();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(opened, total);
  assert.equal(opened, closed);
  assert.equal(f.events.length, 1);
});

test('sequential turns in one file may share a seconds-resolution start time', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1, BASE, { started_at: BASE / 1000 }) });
  await f.observer.tick();
  await f.append('task_complete', T1, BASE + 100, { started_at: BASE / 1000 });
  await f.append('task_started', T2, BASE + 200, { started_at: BASE / 1000 });
  assert.equal(f.state().turnId, T2);
  assert.equal(f.state().state, 'working');
  await f.append('task_complete', T1, BASE + 300, { started_at: BASE / 1000 });
  assert.equal(f.state().turnId, T2);
  assert.equal(f.state().state, 'working');
});

test('arbitrary payload type strings never acquire terminal lifecycle meaning', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  await f.append('toString', T1, BASE + 1000);
  await f.append('task_complete', T1, BASE + 2000);
  assert.equal(f.state().state, 'done');
  assert.ok(f.events.every(event => typeof event.kind === 'string'));
});

test('a scan failure for a missing session does not invalidate an already tracked readable session', async t => {
  const sessions = [{ id: 'codex:' + B, provider: 'codex', pinned: true }];
  const f = await fixture(t, { sessions });
  await fs.writeFile(f.file(B), header(B) + record('task_started', T2));
  await f.observer.tick();
  f.setSessions([...sessions, { id: 'codex:' + A, provider: 'codex', pinned: true }]);
  t.mock.method(fs, 'opendir', async () => { throw Object.assign(new Error('fixture denial'), { code: 'EACCES' }); });
  await f.observer.tick();
  assert.equal(f.state(B).state, 'working');
  assert.equal(f.events.filter(event => event.sessionId === 'codex:' + B && event.kind === 'connection.lost').length, 0);
  assert.equal(f.connections.at(-1).status, 'error');
});

test('resync rejects an older start, an equal start, and missing or contradictory causal clocks', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T2, BASE + 2000) });
  await f.observer.tick();
  const rejected = [
    record('task_started', T1, BASE + 1000),
    record('task_complete', T3, BASE + 4000, { started_at: (BASE + 2000) / 1000 }),
    record('task_complete', T3, BASE + 4000),
    record('task_complete', T3, BASE + 4000, { started_at: (BASE + 5000) / 1000 })
  ];
  for (const contents of rejected) {
    await fs.unlink(f.file(A));
    await f.observer.tick();
    await fs.writeFile(f.file(A), header() + contents);
    await f.observer.tick();
    assert.equal(f.state().state, 'unknown');
    assert.equal(f.state().turnId, T2);
    await f.observer.tick();
    assert.equal(f.connections.at(-1).status, 'error');
  }
  await fs.unlink(f.file(A));
  await f.observer.tick();
  await fs.writeFile(f.file(A), header() + record('task_started', T3, BASE + 6000));
  await f.observer.tick();
  assert.equal(f.state().turnId, T3);
  assert.equal(f.state().state, 'working');
});

test('newly appended but stale records never briefly render working', async t => {
  const old = BASE - 7200000;
  const f = await fixture(t, { initial: header() + record('task_started', T1, old) });
  await f.observer.tick();
  const renders = [];
  f.store.on('change', () => renders.push(f.state().state));
  await f.append('agent_message', T1, old + 1000);
  assert.equal(f.state().state, 'unknown');
  assert.ok(!renders.includes('working'));
});

test('an oversized incremental backlog loses certainty, then retries with a bounded terminal baseline', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  await f.observer.tick();
  await fs.appendFile(f.file(A), 'x'.repeat(4 * 1024 * 1024 + 1) + '\n' + record('task_complete', T1, BASE + 1000));
  await f.observer.tick();
  assert.equal(f.state().state, 'unknown');
  await f.observer.tick();
  assert.equal(f.state().state, 'done');
  assert.equal(f.events.at(-1).baseline, true);
  assert.equal(f.events.at(-1).resync, true);
  assert.equal(f.events.at(-1).turnStartedAt, BASE);
  assert.equal(f.completed(), 0);
});

test('stop during an in-flight read suppresses events and waits for the open file to close', async t => {
  const f = await fixture(t, { initial: header() + record('task_started', T1) });
  const open = fs.open;
  let opened, release;
  const entered = new Promise(resolve => { opened = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let closed = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => { closed++; return close(); };
    opened();
    await gate;
    return handle;
  });
  const pending = f.observer.tick();
  await entered;
  const stopped = f.observer.stop();
  release();
  await Promise.all([pending, stopped]);
  assert.equal(closed, 1);
  assert.equal(f.events.length, 0);
  assert.equal(f.connections.length, 0);
});
