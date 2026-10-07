'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionTarget, createSessionOpener } = require('../src/session-links.cjs');
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const codex = { id: `codex:${a}`, nativeId: a, provider: 'codex' };
const claude = { id: `claude:${b}`, provider: 'claude', surface: 'desktop', cwd: '/tmp' };

test('native links target exact conversations and Claude children open their own parent', () => {
  assert.equal(sessionTarget(codex).url, `codex://threads/${a}`);
  assert.equal(sessionTarget(claude).url, `claude://code/continue?session=${b}`);
  const child = { ...claude, id: `${claude.id}:agent:worker`, parentId: claude.id };
  assert.equal(sessionTarget(child, id => id === claude.id ? claude : null).url, sessionTarget(claude).url);
  assert.throws(() => sessionTarget(child), /원래 Claude 세션/);
  const codexChild = { ...codex, parentId: `codex:${b}` };
  assert.equal(sessionTarget(codexChild).nativeId, a);
});

test('invalid, mismatched and demo targets never fall back to a different conversation', () => {
  for (const value of [null, { provider: 'demo' }, { ...codex, id: 'codex:latest' }, { ...codex, nativeId: b }, { ...codex, id: `codex:${a}?prompt=run` }, { ...claude, surface: undefined }]) assert.throws(() => sessionTarget(value));
});

test('URL dispatch is deduplicated, checks installation and can retry after failure', async () => {
  let count = 0, release;
  const opening = new Promise(resolve => { release = resolve; });
  const open = createSessionOpener({ getSession: () => codex, checkProtocol: async url => assert.equal(url, `codex://threads/${a}`), openExternal: async () => { count++; await opening; } });
  const one = open(codex.id), two = open(codex.id);
  assert.equal(one, two); release();
  assert.equal((await one).dispatched, true); assert.equal(count, 1);
  await open(codex.id); assert.equal(count, 2);
  let attempts = 0;
  const fail = createSessionOpener({ getSession: () => codex, checkProtocol: async () => { attempts++; throw Error('missing'); }, openExternal: () => assert.fail('must not dispatch') });
  await assert.rejects(fail(codex.id), /데스크톱 앱을 찾을 수/);
  await assert.rejects(fail(codex.id), /데스크톱 앱을 찾을 수/);
  assert.equal(attempts, 2);
});

test('Claude CLI resumes only the exact ID, with no prompt, shell, or fork', async () => {
  const cwd = '/tmp/folder with spaces; $(not a command)';
  const open = createSessionOpener({ getSession: () => ({ ...claude, surface: 'cli', cwd }), resolveClaude: async () => '/test/claude', run: async (binary, args, options) => {
    assert.equal(binary, '/test/claude'); assert.deepEqual(args, ['--desktop', '--resume', b]);
    assert.equal(options.cwd, cwd); assert.equal(options.shell, false); assert.equal(options.timeout, 12000);
    return { stdout: `Opening session ${b} in Claude Desktop\n` };
  } });
  assert.deepEqual(await open(claude.id), { dispatched: true, provider: 'claude', sessionId: b });
});

test('Claude active-session errors and download-only responses remain errors', async () => {
  const options = { getSession: () => ({ ...claude, surface: 'cli' }), resolveClaude: async () => '/test/claude' };
  const active = createSessionOpener({ ...options, run: async () => { throw Object.assign(Error('exit'), { stderr: 'session is already running in another terminal' }); } });
  await assert.rejects(active(claude.id), /터미널에서 실행 중/);
  const missing = createSessionOpener({ ...options, run: async () => ({ stdout: 'Download Claude Desktop' }) });
  await assert.rejects(missing(claude.id), /세션 열기를 확인하지 못/);
});
