'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const view = query.get('view') === 'pet' ? 'pet' : 'picker';
  const sessionId = query.get('sessionId');
  const api = window.pets;
  const i18n = window.PetI18n;
  let language = i18n.resolveLanguage(navigator.languages);
  let locale = i18n.formatLocale(navigator.language, language);
  const t = (source, values) => i18n.translate(language, source, values);
  const stateWords = { idle: '쉬는 중', working: '작업 중', waiting: '승인 필요', 'needs-input':'답변 필요', done: '작업 완료', error: '문제 발생', sleep: '잠시 쉬는 중', unknown: '상태 미확인', observed: '응답 도착 · 완료 미확인' };
  const providerWords = { codex: 'Codex', claude: 'Claude Code' };
  let snapshot = { catalog: [], sessions: [], settings: {}, connection: {} };
  let noticeTimer;
  let unsubscribe;
  let unsubscribeCursor;
  let disposed = false;
  let pickerPetId = null;
  let pickerBusy = false;
  let pickerAnimation = null;
  const moods = window.PetMoods;
  const wheelMoods = ['dance', 'laugh', 'angry', 'threat', 'surprised', 'blush', 'sleep', 'greeting'];
  let emotion = null, emotionUntil = 0, wheelIndex = -1, hovered = false, hoverTimer;
  let dragActive = false, gestureHeat = 0, lastGestureAt = 0, nextIdleAt = performance.now() + 5500;
  let openTimer, lastWheelAt = -Infinity;
  const sprites = new Map();
  const pending = new Set();
  const mediaMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = id => document.getElementById(id);
  document.body.dataset.view = view;
  $('app').append($(`${view}-template`).content.cloneNode(true));

  function renderLanguage() {
    document.documentElement.lang = language;
    document.documentElement.dir = i18n.direction(language);
    document.title = t('열두 일꾼');
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of document.querySelectorAll('[data-i18n-aria-label]')) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
    if ($('pet-handle')) $('pet-handle').title = t('클릭: 원래 세션 · 우클릭: 캐릭터 · 휠: 감정 · 두 번 클릭: 춤');
  }

  function notify(message, error = false) {
    const notice = $('notice');
    notice.textContent = String(message);
    notice.dataset.error = String(error);
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, error ? 7000 : 4200);
  }

  function errorMessage(error) {
    const message = error && typeof error.message === 'string' ? error.message.replace(/^Error invoking remote method 'pets:call': (?:Error: )?/, '') : '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
    return i18n.translateError(language, message);
  }

  async function call(action, payload = {}) {
    if (!api || typeof api.call !== 'function') throw new Error('앱 연결을 찾을 수 없어요. 열두 일꾼 데스크톱 앱에서 열어주세요.');
    return api.call(action, payload);
  }

  async function perform(action, payload = {}, button = null) {
    const key = `${action}:${payload.sessionId || ''}`;
    if (pending.has(key)) return undefined;
    pending.add(key);
    if (button) button.disabled = true;
    try {
      return await call(action, payload);
    } catch (error) {
      notify(errorMessage(error), true);
      return undefined;
    } finally {
      pending.delete(key);
      if (button && button.isConnected) button.disabled = false;
    }
  }

  function petById(id) {
    return snapshot.catalog.find(pet => pet.id === id) || snapshot.catalog[0];
  }

  function react(kind, duration = 2300, quiet = false) {
    if (!moods[kind] || disposed) return;
    emotion = kind;
    emotionUntil = performance.now() + duration;
    nextIdleAt = emotionUntil + 6500 + Math.random() * 4000;
    document.body.dataset.emotion = kind;
    if (view === 'pet') {
      const pet = petById(currentSession()?.petId), mood = moods[kind];
      const bubble = $('pet-reaction');
      bubble.textContent = t(mood[pet?.id] || mood.label);
      bubble.hidden = quiet;
      if (!quiet && !reducedMotion()) {
        const sparks = $('pet-sparks');sparks.replaceChildren();
        for (let i = 0; i < 3; i++) {
          const spark = document.createElement('span');spark.textContent = mood.symbol;
          spark.style.setProperty('--spark-x', `${20 + i * 30}%`);
          spark.style.setProperty('--spark-delay', `${i * 90}ms`);sparks.append(spark);
        }
      }
      renderPet();
    } else renderPicker();
  }

  function cycleEmotion(direction = 1) {
    const now = performance.now();if (now - lastWheelAt < 160) return;lastWheelAt = now;
    wheelIndex = (wheelIndex + direction + wheelMoods.length) % wheelMoods.length;
    react(wheelMoods[wheelIndex], 3100);
  }

  function trackCursor(point) {
    if (view !== 'pet' || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const x = Math.max(-1, Math.min(1, point.x)), y = Math.max(-1, Math.min(1, point.y));
    const root = document.querySelector('.floating-pet');
    root.style.setProperty('--look-x', `${reducedMotion() || dragActive ? 0 : x * 8}px`);
    root.style.setProperty('--look-y', `${reducedMotion() || dragActive ? 0 : y * 4}px`);
    root.style.setProperty('--look-turn', `${reducedMotion() || dragActive ? 0 : x * 5}deg`);
    const now = performance.now();
    if (point.near && point.speed > 65 && !dragActive && !reducedMotion() && now - lastGestureAt > 160) {
      gestureHeat = now - lastGestureAt > 1400 ? 1 : gestureHeat + 1;lastGestureAt = now;
      if (gestureHeat >= 5) { react(hovered ? 'laugh' : 'angry', 1800);gestureHeat = 0; }
      else if (!emotion && point.speed > 170) react('surprised', 1000);
    }
  }

  function tickMood() {
    const now = performance.now();
    if (emotion && now >= emotionUntil && !dragActive) {
      emotion = null;delete document.body.dataset.emotion;
      if ($('pet-reaction')) $('pet-reaction').hidden = true;
      if ($('pet-sparks')) $('pet-sparks').replaceChildren();
      if (view === 'pet') renderPet();else renderPicker();
    }
    if (view === 'pet' && !emotion && !hovered && !dragActive && !reducedMotion() && now > nextIdleAt) {
      const state = currentSession()?.state;
      if (!['working', 'waiting', 'needs-input', 'error', 'sleep'].includes(state)) {
        const idleMoods = ['curious', 'dance', 'greeting', 'blush', 'threat', 'laugh'];
        react(idleMoods[Math.floor(Math.random() * idleMoods.length)], 2600, true);
      } else nextIdleAt = now + 6500;
    }
  }

  function currentSession() {
    return snapshot.sessions.find(session => session.id === sessionId);
  }

  function stateWord(session) {
    return t(stateWords[session?.state] || stateWords.unknown);
  }

  function timestamp(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return t('관찰 시각 없음');
    return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function evidenceWord(session) {
    if (session?.evidence === 'persisted-record') return t('저장된 기록 · 현재 실행 상태 미확인');
    if (session?.state === 'observed') return t('응답 관찰 · 작업 종료 여부는 미확인');
    if (session?.state === 'unknown') return t('현재 상태를 확인할 수 없어요');
    return t('로컬 이벤트 관찰');
  }

  function safeImage(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      return url.protocol === 'file:' || (url.protocol === 'data:' && value.startsWith('data:image/png;')) ? url.href : '';
    } catch {
      return '';
    }
  }

  function setSprite(node, pet, state = 'idle', animate = false) {
    if (!node) return;
    if (!pet) {
      node.style.backgroundImage = 'none';
      node.style.clipPath = 'none';
      sprites.delete(node);
      return;
    }
    const columns = Number.isInteger(pet.columns) && pet.columns > 0 ? pet.columns : 1;
    const rows = Number.isInteger(pet.rows) && pet.rows > 0 ? pet.rows : 1;
    const requested = Array.isArray(pet.states?.[state]) ? pet.states[state] : pet.states?.idle;
    const frames = Array.isArray(requested) ? requested.filter(frame => Number.isInteger(frame) && frame >= 0 && frame < columns * rows) : [0];
    const normalized = frames.length ? frames : [0];
    const image = safeImage(pet.image);
    const key = `${pet.id}:${image}:${columns}:${rows}:${normalized.join(',')}:${animate}`;
    if (sprites.get(node)?.key === key) return;
    node.style.backgroundImage = image ? `url(${JSON.stringify(image)})` : 'none';
    node.style.backgroundSize = columns === 1 && rows === 1 ? 'contain' : `${columns * 100}% ${rows * 100}%`;
    const record = { key, petId: pet.id, frames: normalized, columns, rows, index: 0, animate, frameRects: pet.frameRects, canvasSize: pet.canvasSize, imageWidth: pet.width, imageHeight: pet.height };
    sprites.set(node, record);
    positionSprite(node, record);
  }

  function positionSprite(node, record) {
    const frame = record.frames[record.index % record.frames.length];
    const rect = record.frameRects?.[frame];
    if (rect) {
      // Source-image viewports keep unevenly spaced generated poses intact, without altering the PNG.
      const width = node.clientWidth, height = node.clientHeight;
      const scale = Math.min(width, height) / record.canvasSize;
      const left = (width - rect.width * scale) / 2, top = height * .94 - rect.height * scale;
      node.style.backgroundSize = `${record.imageWidth * scale}px ${record.imageHeight * scale}px`;
      node.style.backgroundPosition = `${left - rect.x * scale}px ${top - rect.y * scale}px`;
      node.style.clipPath = `inset(${Math.max(0,top)}px ${Math.max(0,width-left-rect.width*scale)}px ${Math.max(0,height-top-rect.height*scale)}px ${Math.max(0,left)}px)`;
      return;
    }
    node.style.clipPath = 'none';
    if (record.columns === 1 && record.rows === 1) {
      node.style.backgroundPosition = 'center';
      return;
    }
    const x = frame % record.columns;
    const y = Math.floor(frame / record.columns);
    node.style.backgroundPosition = `${record.columns === 1 ? 0 : x / (record.columns - 1) * 100}% ${record.rows === 1 ? 0 : y / (record.rows - 1) * 100}%`;
  }

  function reducedMotion() {
    return Boolean(snapshot.settings?.reducedMotion || mediaMotion.matches);
  }

  function renderMotion() {
    document.body.classList.toggle('reduced-motion', reducedMotion());
    if (reducedMotion()) {
      for (const [node, record] of sprites) {
        record.index = 0;
        positionSprite(node, record);
      }
    }
  }

  const frameTimer = setInterval(() => {
    tickMood();
    if (document.hidden || reducedMotion()) return;
    for (const [node, record] of sprites) {
      if (!node.isConnected) { sprites.delete(node); continue; }
      if (!record.animate || record.frames.length < 2 || node.closest('[hidden]')) continue;
      record.index = (record.index + 1) % record.frames.length;
      positionSprite(node, record);
    }
  }, 140);

  function setupPet() {
    $('pet-completion-open').addEventListener('click', () => perform('open-session', { sessionId }));
    $('pet-attention').addEventListener('click', () => perform('open-session', { sessionId }));
    $('pet-library').addEventListener('click', () => perform('open-picker', { sessionId }));
    $('pet-close').addEventListener('click', () => perform('detach', { sessionId }, $('pet-close')));
    const handle = $('pet-handle');
    handle.title = t('클릭: 원래 세션 · 우클릭: 캐릭터 · 휠: 감정 · 두 번 클릭: 춤');
    handle.addEventListener('pointerenter', () => {
      hovered = true;if (!dragActive) react('greeting', 1300);
      clearTimeout(hoverTimer);hoverTimer = setTimeout(() => { if (hovered && !dragActive) react('blush', 2100); }, 2800);
    });
    handle.addEventListener('pointerleave', () => { hovered = false;clearTimeout(hoverTimer); });
    handle.addEventListener('pointermove', event => {
      const box = handle.getBoundingClientRect();
      trackCursor({ x:(event.clientX-box.x-box.width/2)/(box.width/2), y:(event.clientY-box.y-box.height/2)/(box.height/2), near:true, speed:Math.hypot(event.movementX,event.movementY) });
    });
    handle.addEventListener('wheel', event => { event.preventDefault();cycleEmotion(event.deltaY < 0 ? -1 : 1); }, { passive:false });
    handle.addEventListener('dblclick', () => { clearTimeout(openTimer);react('dance', 4200); });
    handle.addEventListener('focus', () => { if (!emotion) react('greeting', 1200); });
    handle.addEventListener('contextmenu', event => { event.preventDefault(); perform('open-picker', { sessionId }); });
    let drag = null;
    let moveTimer = null;
    let suppressClickUntil = 0;
    let queue = Promise.resolve();
    const pointerPosition = event => ({ x:event.clientX + window.screenX, y:event.clientY + window.screenY });
    function flushMove() {
      clearTimeout(moveTimer);
      moveTimer = null;
      if (!drag || !drag.moved) return;
      const dx = Math.round(drag.dx);
      const dy = Math.round(drag.dy);
      drag.dx -= dx;
      drag.dy -= dy;
      if (!dx && !dy) return;
      queue = queue.then(() => call('move', { dx, dy })).catch(error => notify(errorMessage(error), true));
    }
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const point = pointerPosition(event);
      drag = { id:event.pointerId, startX:point.x, startY:point.y, lastX:point.x, lastY:point.y, dx:0, dy:0, moved:false };
      react('surprised', 900);
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const point = pointerPosition(event);
      if (!drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) < 4) return;
      if (!drag.moved) { dragActive = true;react('drag', 60000); }
      drag.moved = true;
      drag.dx += point.x - drag.lastX;
      drag.dy += point.y - drag.lastY;
      drag.lastX = point.x;
      drag.lastY = point.y;
      handle.classList.add('dragging');
      if (!moveTimer) moveTimer = setTimeout(flushMove, 32);
    });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      flushMove();
      if (drag.moved) { suppressClickUntil = performance.now() + 400;dragActive = false;react('angry', 1800); }
      drag = null;
      handle.classList.remove('dragging');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', endDrag);
    handle.addEventListener('click', event => {
      if (event.detail && performance.now() < suppressClickUntil) { event.preventDefault(); return; }
      clearTimeout(openTimer);
      if (event.detail > 1) { react('dance', 4200);return; }
      react('greeting', 1600);
      if (event.detail === 0) perform('open-session', { sessionId });
      else openTimer = setTimeout(() => perform('open-session', { sessionId }), 260);
    });
  }

  function renderPet() {
    const session = currentSession();
    const pet = petById(session?.petId);
    const root = document.querySelector('.floating-pet');
    const complete = session?.state === 'done';
    const unreadCompletion = complete && (!session.turnId || session.acknowledgedCompletionTurnId !== session.turnId);
    const working = session?.state === 'working';
    const attention = ['needs-input','waiting'].includes(session?.state);
    root.classList.toggle('is-child', Boolean(session?.parentId));
    root.classList.toggle('is-complete', unreadCompletion);
    root.classList.toggle('is-working', working);
    root.classList.toggle('needs-attention', attention);
    root.dataset.state = session?.state || 'unknown';
    // Unread completion is independent of hover, expressions, and their timers.
    $('pet-completion').hidden = !unreadCompletion;
    const completionText = unreadCompletion ? t('작업 완료') : '';
    if ($('pet-completion-label').textContent !== completionText) $('pet-completion-label').textContent = completionText;
    $('pet-completion-open').setAttribute('aria-label', t('{status}. 눌러서 원래 세션 열기', {status:completionText}));
    $('pet-attention').hidden = !attention;
    const attentionText = attention ? t(session.state==='waiting'?'승인 필요':'답변 필요') : '';
    if ($('pet-attention-label').textContent !== attentionText) $('pet-attention-label').textContent = attentionText;
    $('pet-attention-hint').textContent = t('눌러서 세션 열기');
    $('pet-attention').setAttribute('aria-label', t('{status}. 눌러서 원래 세션 열기', {status:attentionText}));
    $('child-label').hidden = !session?.parentId;
    $('floating-name').textContent = pet?.name || t('일꾼');
    $('floating-state').textContent = stateWord(session);
    $('floating-title').textContent = session?.title || t('세션을 확인할 수 없어요');
    $('floating-title').title = `${session?.title || ''} · ${evidenceWord(session)} · ${timestamp(session?.updatedAt)}`;
    $('pet-handle').setAttribute('aria-label', t('{name}, {state}. 끌어서 이동하거나 클릭해서 원래 세션 열기', {name:pet?.name || t('일꾼'), state:stateWord(session)}));
    if (emotion) $('pet-reaction').textContent = t(moods[emotion][pet?.id] || moods[emotion].label);
    setSprite($('floating-sprite'), pet, emotion || (session?.state==='needs-input'?'waiting':session?.state) || 'idle', true);
  }

  function renderPicker() {
    const session = currentSession();
    if (!pickerPetId) pickerPetId = session?.petId || snapshot.settings.defaultPetId;
    const pet = petById(pickerPetId);
    if (pet) pickerPetId = pet.id;
    const index = snapshot.catalog.findIndex(item => item.id === pickerPetId);
    $('picker-session').textContent = sessionId ? session?.title || t('이 세션의 일꾼') : t('기본 일꾼 고르기');
    $('picker-session').title = sessionId ? `${t(providerWords[session?.provider] || '')} · ${session?.title || sessionId}` : t('세션에서 소환할 때 먼저 보여줄 일꾼');
    $('picker-name').textContent = pet?.name || t('일꾼이 없어요');
    $('picker-position').textContent = pet ? `${pet.animal || t('커스텀')} · ${index + 1}/${snapshot.catalog.length}` : '';
    $('picker-choose').setAttribute('aria-label', t('{name} 선택', {name:pet?.name || t('일꾼')}));
    $('picker-choose').dataset.petId = pet?.id || '';
    $('picker-choose').disabled = !pet || pickerBusy;
    $('picker-previous').disabled = snapshot.catalog.length < 2 || pickerBusy;
    $('picker-next').disabled = snapshot.catalog.length < 2 || pickerBusy;
    $('picker-import').disabled = pickerBusy;
    $('picker-hint').textContent = session?.ended ? t('종료된 세션입니다. Esc로 닫아주세요.') : emotion ? t('{emotion} 미리보기 · 클릭하면 선택', {emotion:t(moods[emotion].label)}) : t('클릭 또는 Enter로 선택');
    for (const button of document.querySelectorAll('button[data-emotion]')) button.setAttribute('aria-pressed', String(button.dataset.emotion === emotion));
    setSprite($('picker-sprite'), pet, emotion || 'idle', true);
  }

  function stepPicker(direction) {
    if (pickerBusy || snapshot.catalog.length < 2) return;
    const index = snapshot.catalog.findIndex(pet => pet.id === pickerPetId);
    pickerPetId = snapshot.catalog[(index + direction + snapshot.catalog.length) % snapshot.catalog.length].id;
    renderPicker();
    pickerAnimation?.cancel();
    if (!reducedMotion()) pickerAnimation = $('picker-sprite').animate([
      { transform: `translateX(${direction * 13}px) scale(.98)`, opacity: .45 },
      { transform: 'translateX(0) scale(1)', opacity: 1 }
    ], { duration: 170, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }

  async function confirmPicker() {
    if (pickerBusy || !pickerPetId) return;
    pickerBusy = true;
    renderPicker();
    try { await call('picker-select', { petId: pickerPetId }); }
    catch (error) { pickerBusy = false; renderPicker(); notify(errorMessage(error), true); }
  }

  function setupPicker() {
    for (const button of document.querySelectorAll('button[data-emotion]')) button.addEventListener('click', () => react(button.dataset.emotion, 4000));
    $('picker-choose').addEventListener('pointerenter', () => react('greeting', 1400));
    $('picker-choose').addEventListener('wheel', event => { event.preventDefault();cycleEmotion(event.deltaY < 0 ? -1 : 1); }, { passive:false });
    $('picker-previous').addEventListener('click', () => stepPicker(-1));
    $('picker-next').addEventListener('click', () => stepPicker(1));
    $('picker-choose').addEventListener('click', confirmPicker);
    $('picker-close').addEventListener('click', () => perform('close'));
    $('picker-import').addEventListener('click', async () => {
      pickerBusy = true; renderPicker();
      const pet = await perform('import-pet');
      if (pet?.id) { if (!snapshot.catalog.some(item => item.id === pet.id)) snapshot.catalog.push(i18n.localizePet(language, pet)); pickerPetId = pet.id; }
      pickerBusy = false; renderPicker();
    });
    document.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter' && event.target.closest('button[data-emotion]')) return;
      event.preventDefault();
      if (event.key === 'Enter') { if (!event.repeat) confirmPicker(); }
      else stepPicker(event.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  function receive(value) {
    if (disposed || !value || typeof value !== 'object') return;
    if(value.translations&&value.locale)try{i18n.registerCatalog({version:1,locale:value.locale,messages:value.translations});}catch{}
    language = i18n.resolveLanguage(value.language || navigator.languages);
    locale = i18n.formatLocale(value.locale || navigator.language, language);
    snapshot = {
      catalog: Array.isArray(value.catalog) ? value.catalog.map(pet => i18n.localizePet(language, pet)) : [],
      sessions: Array.isArray(value.sessions) ? value.sessions : [],
      settings: value.settings || {},
      connection: value.connection || {}
    };
    renderLanguage();
    renderMotion();
    if (view === 'pet') renderPet();
    if (view === 'picker') renderPicker();
    document.body.dataset.ready = 'true';
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    perform('close');
  });
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('is-hidden', document.hidden));
  mediaMotion.addEventListener('change', renderMotion);
  window.addEventListener('beforeunload', () => {
    disposed = true;
    clearInterval(frameTimer);
    clearTimeout(noticeTimer);
    clearTimeout(hoverTimer);
    clearTimeout(openTimer);
    if (typeof unsubscribeCursor === 'function') unsubscribeCursor();
    if (typeof unsubscribe === 'function') unsubscribe();
  });

  renderLanguage();
  if (view === 'pet') setupPet();
  if (view === 'picker') setupPicker();
  renderMotion();

  async function start() {
    try {
      if (api && typeof api.onState === 'function') unsubscribe = api.onState(receive);
      if (view === 'pet' && typeof api?.onCursor === 'function') unsubscribeCursor = api.onCursor(trackCursor);
      receive(await call('snapshot'));
    } catch (error) {
      notify(errorMessage(error), true);

    }
  }

  start();
})();
