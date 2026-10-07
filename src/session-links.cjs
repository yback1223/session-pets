'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionTarget(session, getSession = () => null) {
  if (!session) throw new Error('연결된 세션을 찾을 수 없습니다.');
  if (!['codex', 'claude'].includes(session.provider)) throw new Error('지원하지 않는 세션입니다.');
  // Claude subagents belong to the original conversation and have no separate chat.
  let target = session;
  if (session.provider === 'claude' && session.parentId) {
    target = getSession(session.parentId);
    if (!target || target.provider !== 'claude') throw new Error('작은 일꾼의 원래 Claude 세션을 찾을 수 없습니다.');
  }
  const prefix = target.provider + ':';
  const id = target.id?.startsWith(prefix) ? target.id.slice(prefix.length) : '';
  if (!UUID.test(id) || (target.nativeId && target.nativeId.toLowerCase() !== id.toLowerCase())) throw new Error('원래 세션 ID를 확인할 수 없습니다. 해당 세션에서 펫을 다시 소환하세요.');
  const nativeId = id.toLowerCase();
  if (target.provider === 'codex') return { kind: 'url', provider: 'codex', nativeId, url: `codex://threads/${nativeId}` };
  if (target.surface === 'desktop') return { kind: 'url', provider: 'claude', nativeId, url: `claude://code/continue?session=${nativeId}` };
  if (target.surface === 'cli') return { kind: 'claude-cli', provider: 'claude', nativeId, cwd: target.cwd };
  throw new Error('Claude 실행 위치를 확인할 수 없습니다. 원래 세션에서 /Session-Pets을 다시 호출하세요.');
}

async function findClaude() {
  const candidates = [...new Set([path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...(process.env.PATH || '').split(path.delimiter).filter(p => path.isAbsolute(p)).map(p => path.join(p, 'claude'))])];
  for (const candidate of candidates) { try { await fs.access(candidate, constants.X_OK); return candidate; } catch {} }
  throw new Error('Claude Code CLI를 찾을 수 없습니다. 설치 후 다시 눌러주세요.');
}

function createSessionOpener({ getSession, openExternal, checkProtocol, acknowledgeCompletion = () => {}, run = exec, resolveClaude = findClaude }) {
  const pending = new Map();
  return function openSession(id) {
    const session = getSession(id);
    const completedTurnId = session?.state === 'done' ? session.turnId : null;
    const target = sessionTarget(session, getSession);
    const key = target.provider + ':' + target.nativeId;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      if (target.kind === 'url') {
        try { await checkProtocol(target.url); }
        catch { throw new Error(`${target.provider === 'codex' ? 'Codex' : 'Claude'} 데스크톱 앱을 찾을 수 없습니다. 앱 설치 후 다시 눌러주세요.`); }
        await openExternal(target.url);
      } else {
        const binary = await resolveClaude();
        if (!target.cwd || !path.isAbsolute(target.cwd) || /[\x00-\x1f]/.test(target.cwd)) throw new Error('Claude 작업 폴더를 확인할 수 없습니다. 원래 세션에서 /Session-Pets을 다시 호출하세요.');
        let result;
        try {
          result = await run(binary, ['--desktop', '--resume', target.nativeId], { cwd: target.cwd, timeout: 12000, maxBuffer: 65536, shell: false });
        } catch (error) {
          const output = String(error.stdout || '') + String(error.stderr || '');
          if (/running|another terminal|active session|in use/i.test(output)) throw new Error('이 Claude 세션은 터미널에서 실행 중입니다. 해당 터미널을 사용하거나 종료한 뒤 다시 눌러주세요.');
          if (error.code === 'ENOENT') throw new Error('Claude 실행 파일이나 작업 폴더를 찾을 수 없습니다. 원래 세션에서 펫을 다시 소환하세요.');
          throw new Error('Claude 세션을 열지 못했습니다. 최신 Claude Code와 데스크톱 앱의 로그인 상태를 확인하세요.');
        }
        // A zero exit code may also mean "download Desktop"; do not report it as a dispatch.
        if (!String(result.stdout).includes(`Opening session ${target.nativeId} in Claude Desktop`)) throw new Error('Claude에서 세션 열기를 확인하지 못했습니다. 실행 중인 터미널과 데스크톱 앱 설치 상태를 확인하세요.');
      }
      if (completedTurnId) acknowledgeCompletion(id, completedTurnId);
      return { dispatched: true, provider: target.provider, sessionId: target.nativeId };
    })();
    pending.set(key, task);
    task.then(() => pending.delete(key), () => pending.delete(key));
    return task;
  };
}

module.exports = { sessionTarget, createSessionOpener };
