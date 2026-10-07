'use strict';
// Runs only inside --smoke-test, against this app's isolated renderer and socket.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

module.exports = async function({ root, store, assets, control, settings, openPicker, pickerWindows, petWindows }) {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const aid = 'codex:' + first, bid = 'claude:' + second;
  const originalDefault = settings.defaultPetId;
  const out = path.join(root, 'work/smoke');
  await fs.mkdir(out, { recursive: true });
  const until = async test => {
    const deadline = Date.now() + 6000;
    while (!await test()) { if (Date.now() > deadline) throw new Error('펫 선택기 검사 시간 초과'); await new Promise(r => setTimeout(r, 35)); }
  };
  const command = async (provider, command = 'summon') => {
    const args = [path.join(root, 'scripts/pet.py'), '--provider', provider, '--socket', control.socketPath, '--no-launch', command];
    if (provider === 'claude') args.push('--session', second);
    const result = await exec('python3', args, { env: { ...process.env, CODEX_THREAD_ID: first }, timeout: 6000 });
    const reply = JSON.parse(result.stdout); assert.equal(reply.ok, true); return reply;
  };
  const ready = async win => until(async () => !win.webContents.isLoading() && await win.webContents.executeJavaScript(`Boolean(document.getElementById('picker-choose')?.dataset.petId)`));
  const selected = win => win.webContents.executeJavaScript(`document.getElementById('picker-choose').dataset.petId`);
  const click = (win, id) => win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);
  const key = (win, keyCode) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); };
  await control.start();
  try {
    assert.equal((await command('codex')).status, 'choosing');
    const a = pickerWindows.get(aid); assert.ok(a); await ready(a);
    for (const mood of ['dance','laugh','angry','threat']) {
      await a.webContents.executeJavaScript(`document.querySelector('button[data-emotion="${mood}"]').click()`);
      assert.equal(await a.webContents.executeJavaScript('document.body.dataset.emotion'),mood);
      assert.equal(store.get(aid).petChosen,undefined);
    }
    const initial = await selected(a);
    assert.equal((await command('codex')).status, 'choosing'); assert.equal(pickerWindows.get(aid), a);
    const png = await a.webContents.capturePage();
    assert.equal(png.toBitmap()[3], 0, 'picker corner must be fully transparent');
    await fs.writeFile(path.join(out, 'picker.png'), png.toPNG());
    await click(a, 'picker-next'); const next = await selected(a); assert.notEqual(next, initial);
    assert.equal(store.get(aid).petChosen, undefined, 'browsing must not commit');
    key(a, 'Left'); await until(async () => await selected(a) === initial);
    await click(a, 'picker-previous'); assert.equal(await selected(a), assets.catalog.at(-1).id);
    await click(a, 'picker-next'); assert.equal(await selected(a), initial);
    await click(a, 'picker-next'); const choice = await selected(a);
    assert.equal((await command('claude')).status, 'choosing');
    const b = pickerWindows.get(bid); await ready(b); assert.equal(pickerWindows.size, 2);
    key(a, 'Return'); await until(() => !pickerWindows.has(aid));
    assert.equal(store.get(aid).petId, choice); assert.equal(store.get(aid).pinned, true); assert.ok(petWindows.has(aid));
    assert.equal(store.get(bid).petChosen, undefined);
    const rejected = await b.webContents.executeJavaScript(`window.pets.call('attach',{sessionId:${JSON.stringify(aid)},petId:'tiger'}).then(()=>false,()=>true)`);
    assert.equal(rejected, true);
    await b.webContents.executeJavaScript(`window.pets.call('picker-select',{sessionId:${JSON.stringify(aid)},petId:'gorilla'})`);
    await until(() => !pickerWindows.has(bid));
    assert.equal(store.get(bid).petId, 'gorilla'); assert.equal(store.get(aid).petId, choice, 'selection must remain bound to its own window');
    await command('codex', 'choose'); const cancel = pickerWindows.get(aid); await ready(cancel);
    await click(cancel, 'picker-next'); key(cancel, 'Escape'); await until(() => !pickerWindows.has(aid));
    assert.equal(store.get(aid).petId, choice); assert.equal(store.get(aid).pinned, true);
    await command('codex', 'hide'); assert.equal(store.get(aid).pinned, false); assert.equal(store.get(aid).petChosen, true);
    assert.equal((await command('codex')).status, 'visible'); assert.equal(pickerWindows.has(aid), false); assert.equal(store.get(aid).petId, choice);
    await command('claude', 'choose'); const clickable = pickerWindows.get(bid); await ready(clickable);
    await click(clickable, 'picker-next'); const clickedChoice = await selected(clickable); await click(clickable, 'picker-choose');
    await until(() => !pickerWindows.has(bid)); assert.equal(store.get(bid).petId, clickedChoice);
    const count = store.list().length;
    const defaultPicker = openPicker(); await ready(defaultPicker); await click(defaultPicker, 'picker-next'); const defaultChoice = await selected(defaultPicker);
    await click(defaultPicker, 'picker-choose'); await until(() => !pickerWindows.has('default'));
    assert.equal(settings.defaultPetId, defaultChoice); assert.equal(store.list().length, count, 'default selection must not create a fake session');
    return { transparentCorner: true, arrowsAndWrap: true, keyboardSelectCancel: true, clickSelect: true, previewDoesNotCommit: true, sessionIsolation: true, duplicateSummonReused: true, recalledAfterHide: true, bothProviderHelpers: true };
  } finally {
    for (const id of [aid, bid]) { store.sessions.delete(id); pickerWindows.get(id)?.destroy(); }
    pickerWindows.get('default')?.destroy(); settings.defaultPetId = originalDefault; store.publish(); await control.stop(); await fs.rmdir(path.dirname(control.socketPath));
  }
};
