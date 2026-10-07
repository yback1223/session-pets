'use strict';

// Korean source strings are stable message keys, shared by the native app and renderer.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetI18n = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const en = Object.freeze({
    '펫 소환': 'Summon a pet',
    '현재 세션의 작은 일꾼을 고르고 소환해요': 'Choose and summon a pet for this session',
    '현재 세션의 바탕화면 펫을 소환하거나 고르고 숨긴다.': 'Summon, choose, or hide a desktop pet for the current session.',
    '[choose | hide | status | 펫 이름]': '[choose | hide | status | pet name]',
    '언어 파일을 확인하세요.': 'Check the language file.',
    '열두 일꾼': 'Session Pets',
    '일꾼': 'Pet',
    '고릴대장': 'Gorilla Boss',
    '호들갑': 'Roary',
    '고릴라': 'Gorilla',
    '호랑이': 'Tiger',
    '커스텀': 'Custom',
    '주먹은 크고, 마음은 말랑.': 'Big fists. Soft heart.',
    '험악한 얼굴로 귀여운 짓.': 'Fierce face. Adorable antics.',
    '내가 데려온 나만의 일꾼.': 'Your very own companion.',
    '쉬는 중': 'Resting',
    '작업 중': 'Working',
    '기다리는 중': 'Waiting',
    '작업 완료': 'Task complete',
    '답변 필요': 'Answer needed',
    '승인 필요': 'Approval needed',
    '눌러서 세션 열기': 'Click to open session',
    '{status}. 눌러서 원래 세션 열기': '{status}. Click to open the original session',
    '문제 발생': 'Needs attention',
    '잠시 쉬는 중': 'Sleeping',
    '상태 미확인': 'Status unknown',
    '응답 확인 · 종료 미확인': 'Replied · end unconfirmed',
    '응답 도착 · 완료 미확인': 'Reply received · completion unconfirmed',
    '상태 확인 중': 'Checking status',
    '다 했어요!': 'All done!',
    '작은 일꾼': 'Little helper',
    '관찰 시각 없음': 'No observation time',
    '저장된 기록 · 현재 실행 상태 미확인': 'Saved record · live status unknown',
    '응답 관찰 · 작업 종료 여부는 미확인': 'Response observed · completion unconfirmed',
    '현재 상태를 확인할 수 없어요': 'Current status is unavailable',
    '로컬 이벤트 관찰': 'Local event observed',
    '세션을 확인할 수 없어요': 'Session unavailable',
    '일꾼 고르기': 'Choose a pet',
    '기본 일꾼 고르기': 'Choose default pet',
    '이 세션의 일꾼': 'Pet for this session',
    '세션에서 소환할 때 먼저 보여줄 일꾼': 'The first pet shown when summoning in a session',
    '선택 취소': 'Cancel selection',
    '이전 일꾼': 'Previous pet',
    '다음 일꾼': 'Next pet',
    '이 일꾼 선택': 'Choose this pet',
    '{name} 선택': 'Choose {name}',
    '불러오는 중': 'Loading',
    '일꾼이 없어요': 'No pets available',
    '클릭 또는 Enter로 선택': 'Click or press Enter to choose',
    '종료된 세션입니다. Esc로 닫아주세요.': 'This session has ended. Press Esc to close.',
    '{emotion} 미리보기 · 클릭하면 선택': '{emotion} preview · click to choose',
    '표정과 동작 미리보기': 'Preview expressions and moves',
    '♪ 춤': '♪ Dance',
    '웃음': 'Laugh',
    '버럭': 'Angry',
    '으르렁': 'Grrr',
    '＋ 내 펫 추가': '＋ Add my pet',
    '← → 이동 · Esc 취소': '← → Move · Esc Cancel',
    '펫 바꾸기': 'Change pet',
    '이 일꾼 숨기기': 'Hide this pet',
    '일꾼을 끌어서 이동하거나 클릭해서 원래 세션 열기': 'Drag to move the pet, or click to open its session',
    '{name}, {state}. 끌어서 이동하거나 클릭해서 원래 세션 열기': '{name}, {state}. Drag to move, or click to open the original session',
    '클릭: 원래 세션 · 우클릭: 캐릭터 · 휠: 감정 · 두 번 클릭: 춤': 'Click: session · Right-click: change pet · Scroll: emotion · Double-click: dance',
    '종료': 'Quit',
    '열두 일꾼 종료': 'Quit Session Pets',
    '편집': 'Edit',
    '실행 취소': 'Undo',
    '다시 실행': 'Redo',
    '잘라내기': 'Cut',
    '복사': 'Copy',
    '붙여넣기': 'Paste',
    '전체 선택': 'Select All',
    '내 펫 파일 데려오기': 'Import your pet',
    '펫 이미지 또는 설정': 'Pet image or manifest',
    '열기': 'Open',
    '인사': 'Hello',
    '호기심': 'Curious',
    '댄스': 'Dance',
    '분노': 'Angry',
    '깜짝': 'Surprised',
    '둥둥': 'Dangling',
    '쑥스러움': 'Shy',
    '꾸벅': 'Sleepy',
    '대장 등장.': 'Boss has arrived.',
    '어흥. 왔냥?': 'Roar. Hey, you!',
    '거기 뭐 있냐?': 'What have you got there?',
    '그거 내 거냥?': 'Is that mine?',
    '크하하! 간지럽다!': 'Ha! That tickles!',
    '아하핫! 그만 간질여!': 'Haha! Stop tickling!',
    '근육 말고 리듬.': 'Less muscle. More groove.',
    '호랑나비 말고 호랑댄스.': 'Eye of the dance floor.',
    '바나나 압수다.': 'Your bananas are confiscated.',
    '간식으로 합의하자.': 'We can settle this with snacks.',
    '한 번만 더… 춤춘다.': 'One more time… and I dance.',
    '나 무섭다? 진짜다?': "I'm scary. Right? RIGHT?",
    '어어? 근육 놀랐다!': 'Whoa! Even my muscles jumped!',
    '어흥?! 깜짝이냥!': 'Roar?! You startled me!',
    '근손실 온다! 내려줘!': 'My gains! Put me down!',
    '발바닥은 보지 마!': 'No peeking at my toe beans!',
    '귀엽단 말은… 더 해.': 'Cute, you say? Keep going.',
    '무섭게 생겼다며… 헤헤.': 'But you said I was scary… hehe.',
    '근육도 충전 중.': 'Recharging the muscles.',
    '5분만 고양이 할게.': 'Just five minutes as a kitten.',
    '{provider} 세션': '{provider} session',
    '현재 세션의 펫 선택기를 열었습니다. 화살표로 고르고 캐릭터를 클릭하세요.': 'Pet picker opened for this session. Use the arrows, then click a pet.',
    '현재 세션의 펫을 표시했습니다.': 'The pet for this session is visible.',
    '현재 세션의 펫이 숨겨져 있습니다.': 'The pet for this session is hidden.',
    '처리하지 못했어요. 잠시 후 다시 시도해 주세요.': 'Something went wrong. Please try again shortly.',
    '앱 연결을 찾을 수 없어요. 열두 일꾼 데스크톱 앱에서 열어주세요.': 'App connection unavailable. Open this in the Session Pets desktop app.',
    '연결된 세션을 찾을 수 없습니다.': 'The linked session could not be found.',
    '지원하지 않는 세션입니다.': 'This session is not supported.',
    '작은 일꾼의 원래 Claude 세션을 찾을 수 없습니다.': "The little helper's original Claude session could not be found.",
    '원래 세션 ID를 확인할 수 없습니다. 해당 세션에서 펫을 다시 소환하세요.': 'Original session ID unavailable. Summon the pet again from that session.',
    'Claude 실행 위치를 확인할 수 없습니다. 원래 세션에서 /Session-Pets을 다시 호출하세요.': 'Claude session location unavailable. Run /Session-Pets again in the original session.',
    'Claude Code CLI를 찾을 수 없습니다. 설치 후 다시 눌러주세요.': 'Claude Code CLI could not be found. Install it and try again.',
    '{provider} 데스크톱 앱을 찾을 수 없습니다. 앱 설치 후 다시 눌러주세요.': '{provider} desktop app could not be found. Install it and try again.',
    'Claude 작업 폴더를 확인할 수 없습니다. 원래 세션에서 /Session-Pets을 다시 호출하세요.': 'Claude working directory unavailable. Run /Session-Pets again in the original session.',
    '이 Claude 세션은 터미널에서 실행 중입니다. 해당 터미널을 사용하거나 종료한 뒤 다시 눌러주세요.': 'This Claude session is active in a terminal. Use that terminal or end the session there, then try again.',
    'Claude 실행 파일이나 작업 폴더를 찾을 수 없습니다. 원래 세션에서 펫을 다시 소환하세요.': 'Claude executable or working directory not found. Summon the pet again from the original session.',
    'Claude 세션을 열지 못했습니다. 최신 Claude Code와 데스크톱 앱의 로그인 상태를 확인하세요.': 'Could not open the Claude session. Check that Claude Code is up to date and the desktop app is signed in.',
    'Claude에서 세션 열기를 확인하지 못했습니다. 실행 중인 터미널과 데스크톱 앱 설치 상태를 확인하세요.': 'Claude did not confirm opening the session. Check your active terminal and desktop app installation.',
    '지원하지 않는 화면입니다.': 'This view is not supported.',
    '연결할 세션을 찾을 수 없습니다.': 'The session to link could not be found.',
    '선택한 펫을 찾을 수 없습니다.': 'The selected pet could not be found.',
    '종료되었거나 찾을 수 없는 세션입니다.': 'This session has ended or could not be found.',
    '해당 펫이 없습니다. 이름 없이 호출해 직접 골라주세요.': 'Pet not found. Summon without a name to choose one.',
    '허용하지 않은 요청입니다.': 'This request is not allowed.',
    '펫 선택기에서 허용하지 않은 요청입니다.': 'This request is not allowed in the pet picker.',
    '잘못된 요청입니다.': 'Invalid request.',
    '현재 세션에서만 펫을 바꿀 수 있습니다.': 'You can only change the pet for this session.',
    '펫 선택기에서만 선택할 수 있습니다.': 'Choose a pet from the pet picker.',
    '펫만 움직일 수 있습니다.': 'Only a pet can be moved.',
    '잘못된 위치입니다.': 'Invalid position.',
    '현재 펫만 숨길 수 있습니다.': 'You can only hide this pet.',
    '현재 펫의 세션만 열 수 있습니다.': "You can only open this pet's session.",
    '지원하지 않는 기능입니다. 외부 세션의 입력·모델 변경은 원래 앱에서 해주세요.': 'This action is not supported. Use the original app to enter prompts or change models.',
    '올바른 PNG 파일이 아닙니다.': 'This is not a valid PNG file.',
    '이미지는 가로·세로 8192px, 총 2400만 화소 이하여야 합니다.': 'Images must be at most 8192px per side and 24 megapixels in total.',
    '펫 파일 version은 1이어야 합니다.': 'Pet manifest version must be 1.',
    '펫 이름은 1~40자로 입력하세요.': 'Pet names must contain 1–40 characters.',
    '행·열과 이미지 크기가 맞지 않습니다. 최대 256칸까지 지원합니다.': 'The grid does not match the image size. Up to 256 frames are supported.',
    '기본 idle 프레임이 필요합니다.': 'At least one idle frame is required.',
    '{state}의 프레임 번호를 확인하세요.': 'Check the frame numbers for {state}.',
    'PNG 또는 .pet.json 파일을 선택하세요.': 'Choose a PNG or .pet.json file.',
    '설정 파일은 64KB 이하여야 합니다.': 'The manifest must be at most 64KB.',
    'JSON 문법을 확인하세요.': 'Check the JSON syntax.',
    'image는 같은 폴더의 상대 PNG 경로여야 합니다.': 'image must be a relative PNG path within the same folder.',
    '이미지가 펫 파일 폴더 밖에 있습니다.': 'The image is outside the pet manifest folder.',
    'PNG 파일은 12MB 이하여야 합니다.': 'The PNG must be at most 12MB.',
    '손상되어 읽을 수 없는 PNG 이미지입니다.': 'The PNG image is damaged or unreadable.',
    '세션을 찾을 수 없습니다.': 'Session not found.',
    '지원하지 않는 소환 요청입니다.': 'Unsupported summon request.',
    '지원하지 않는 소환 동작입니다.': 'Unsupported summon action.',
    'Codex 또는 Claude 세션이 필요합니다.': 'A Codex or Claude session is required.',
    '현재 세션 ID를 확인할 수 없습니다.': 'Current session ID unavailable.',
    '펫 이름을 확인하세요.': 'Check the pet name.',
    '세션 이름을 확인하세요.': 'Check the session name.',
    '작업 폴더를 확인하세요.': 'Check the working directory.',
    '실행 위치를 확인하세요.': 'Check the session location.',
    '소환 요청이 너무 큽니다.': 'The summon request is too large.',
    '소환하지 못했습니다.': 'Could not summon the pet.'
  });
  const supported = Object.freeze(['ko', 'en']);
  const catalogs = new Map();
  function normalizeLocale(value) {
    if (typeof value !== 'string' || value.length > 64) return null;
    try { return Intl.getCanonicalLocales(value.trim().replace(/_/g, '-'))[0] || null; }
    catch { return null; }
  }
  function catalogKey(value) {
    const locale = normalizeLocale(value);
    if (!locale) return null;
    const base = locale.split('-')[0];
    if (supported.includes(base)) return base;
    if (catalogs.has(locale)) return locale;
    return null;
  }
  function registerCatalog(value) {
    const locale = normalizeLocale(value?.locale);
    if (value?.version !== 1 || !locale || supported.includes(locale.split('-')[0]) || !value.messages || typeof value.messages !== 'object' || Array.isArray(value.messages)) throw new Error('언어 파일을 확인하세요.');
    const messages = {};
    const tokens = text => [...text.matchAll(/\{[a-zA-Z]+\}/g)].map(match=>match[0]).sort().join('|');
    for (const key of Object.keys(en)) {
      const text = value.messages[key];
      if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) || tokens(text) !== tokens(key)) throw new Error('언어 파일을 확인하세요.');
      messages[key] = text;
    }
    for (const key of ['펫 소환','현재 세션의 작은 일꾼을 고르고 소환해요','[choose | hide | status | 펫 이름]']) if (/[\r\n\t]/.test(messages[key]) || Array.from(messages[key]).length > 64) throw new Error('언어 파일을 확인하세요.');
    if (/[\r\n\t]/.test(messages['현재 세션의 바탕화면 펫을 소환하거나 고르고 숨긴다.'])) throw new Error('언어 파일을 확인하세요.');
    catalogs.set(locale, Object.freeze(messages));
    return locale;
  }
  function removeCatalog(locale) { catalogs.delete(normalizeLocale(locale)); }
  function catalogFor(locale) { return catalogs.get(catalogKey(locale)) || null; }
  function hasCatalog(locale) { return catalogKey(locale) !== null; }
  function direction(locale) {
    try { const value = new Intl.Locale(locale).maximize(); return ['Arab','Hebr','Thaa','Nkoo','Adlm','Rohg','Syrc'].includes(value.script) ? 'rtl' : 'ltr'; }
    catch { return 'ltr'; }
  }
  function resolveLanguage(preferred, fallback = 'en') {
    const values = Array.isArray(preferred) ? preferred : [preferred];
    for (const value of [...values, fallback]) {
      if (typeof value !== 'string') continue;
      const language = catalogKey(value);
      if (language) return language;
    }
    return 'en';
  }
  function formatLocale(value, language) {
    try { return Intl.getCanonicalLocales(String(value).replace(/_/g, '-'))[0] || language; }
    catch { return resolveLanguage(language); }
  }
  function translate(language, source, values = {}) {
    const resolved = resolveLanguage(language);
    const translated = resolved === 'ko' ? null : resolved === 'en' ? en : catalogs.get(resolved);
    const text = translated && Object.hasOwn(translated, source) ? translated[source] : source;
    return String(text).replace(/\{([a-zA-Z]+)\}/g, (token, key) => Object.hasOwn(values, key) ? String(values[key]) : token);
  }
  function translateError(language, source) {
    const message = String(source || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    const frame = /^([a-z]+)의 프레임 번호를 확인하세요\.$/.exec(message);
    if (frame) return translate(language, '{state}의 프레임 번호를 확인하세요.', {state:frame[1]});
    const app = /^(Codex|Claude) 데스크톱 앱을 찾을 수 없습니다\. 앱 설치 후 다시 눌러주세요\.$/.exec(message);
    if (app) return translate(language, '{provider} 데스크톱 앱을 찾을 수 없습니다. 앱 설치 후 다시 눌러주세요.', {provider:app[1]});
    return translate(language, message);
  }
  function localizePet(language, pet) {
    const builtin = pet.id === 'gorilla' || pet.id === 'tiger';
    return {...pet, name:builtin ? translate(language, pet.name) : pet.name, animal:translate(language, pet.animal || '커스텀'), tagline:translate(language, pet.tagline || '')};
  }
  return Object.freeze({en, supported, normalizeLocale, registerCatalog, removeCatalog, catalogFor, hasCatalog, direction, resolveLanguage, formatLocale, translate, translateError, localizePet});
});
