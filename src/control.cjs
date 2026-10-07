'use strict';
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { removeStaleSocket } = require('./providers.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 16384;

function validateRequest(raw) {
  if (!raw || Array.isArray(raw) || raw.version !== 1) throw new Error('지원하지 않는 소환 요청입니다.');
  if (!['summon', 'choose', 'hide', 'status', 'prepare-language'].includes(raw.action)) throw new Error('지원하지 않는 소환 동작입니다.');
  if (!['codex', 'claude'].includes(raw.provider)) throw new Error('Codex 또는 Claude 세션이 필요합니다.');
  if (typeof raw.sessionId !== 'string' || !UUID.test(raw.sessionId)) throw new Error('현재 세션 ID를 확인할 수 없습니다.');
  if (raw.petId !== undefined && (typeof raw.petId !== 'string' || !raw.petId || raw.petId.length > 80)) throw new Error('펫 이름을 확인하세요.');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > 180 || /[\x00-\x1f]/.test(raw.title))) throw new Error('세션 이름을 확인하세요.');
  if (raw.cwd !== undefined && (typeof raw.cwd !== 'string' || raw.cwd.length > 4096 || !path.isAbsolute(raw.cwd) || /[\x00-\x1f]/.test(raw.cwd))) throw new Error('작업 폴더를 확인하세요.');
  if (raw.surface !== undefined && !['desktop', 'cli'].includes(raw.surface)) throw new Error('실행 위치를 확인하세요.');
  return { action: raw.action, provider: raw.provider, sessionId: raw.sessionId.toLowerCase(), petId: raw.petId, title: raw.title, cwd: raw.cwd, surface: raw.surface };
}

function createControlServer({ dataDir, onRequest, localizeError = message => message }) {
  const socketPath = path.join(dataDir, 'control.sock');
  const sockets = new Set();
  let server;
  let owned = false;
  return {
    socketPath,
    async start() {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      await removeStaleSocket(socketPath);
      server = net.createServer(socket => {
        sockets.add(socket);
        let input = Buffer.alloc(0), dispatched = false;
        socket.setTimeout(2000, () => socket.destroy());
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
        const finish = value => { if (!socket.destroyed) socket.end(JSON.stringify(value) + '\n'); };
        socket.on('data', chunk => {
          if (dispatched) return;
          input = Buffer.concat([input, chunk]);
          if (input.length > LIMIT) { dispatched = true; finish({ ok: false, error: localizeError('소환 요청이 너무 큽니다.') }); return; }
          const end = input.indexOf(10);
          if (end < 0) return;
          dispatched = true;
          let request;
          Promise.resolve().then(() => {request=validateRequest(JSON.parse(input.subarray(0, end).toString('utf8')));return request;})
            .then(onRequest)
            .then(result => finish({ ok: true, ...result }), error => finish({ ok: false, error: localizeError(error.message || '소환하지 못했습니다.',request) }));
        });
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
      owned = true;
      await fs.chmod(socketPath, 0o600);
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      if (owned) { owned = false; await fs.unlink(socketPath).catch(() => {}); }
    }
  };
}
module.exports = { createControlServer, validateRequest };
