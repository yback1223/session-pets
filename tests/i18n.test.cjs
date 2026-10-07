'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const i18n=require('../shared/i18n.js');

test('language follows OS preference order, not its region',()=>{
  assert.equal(i18n.resolveLanguage(['en-KR','ko-KR']),'en');
  assert.equal(i18n.resolveLanguage(['ko_US','en-US']),'ko');
  assert.equal(i18n.resolveLanguage(['ja-JP','KO-kr','en']),'ko');
  assert.equal(i18n.resolveLanguage(['fr-FR','ja-JP']),'en');
  assert.equal(i18n.resolveLanguage([null,42,'']),'en');
  assert.equal(i18n.resolveLanguage([], 'ko-KR'),'ko');
});
test('date region stays independent of the UI language and invalid tags fall back',()=>{
  assert.equal(i18n.formatLocale('en_KR','ko'),'en-KR');
  assert.equal(i18n.formatLocale('ko_KR','en'),'ko-KR');
  assert.equal(i18n.formatLocale('bad_locale_!','ko'),'ko');
});
test('built-in display names change without changing identity or custom names',()=>{
  const raw={id:'gorilla',name:'고릴대장',animal:'고릴라',tagline:'주먹은 크고, 마음은 말랑.'};
  assert.equal(i18n.localizePet('en',raw).name,'Gorilla Boss');
  assert.equal(i18n.localizePet('en',raw).id,'gorilla');
  assert.equal(raw.name,'고릴대장');
  const custom={id:'custom-123',name:'고릴대장',animal:'커스텀'};
  assert.equal(i18n.localizePet('en',custom).name,'고릴대장');
  assert.equal(i18n.localizePet('en',custom).animal,'Custom');
});
test('dynamic user values are inserted literally, never translated or re-interpolated',()=>{
  assert.equal(i18n.translate('en','{name} 선택',{name:'고릴대장 {state} <b>'}),'Choose 고릴대장 {state} <b>');
  assert.equal(i18n.translate('ko','{name} 선택',{name:'내 펫'}),'내 펫 선택');
  assert.equal(i18n.translateError('en','idle의 프레임 번호를 확인하세요.'),'Check the frame numbers for idle.');
  assert.equal(i18n.translateError('en','Codex 데스크톱 앱을 찾을 수 없습니다. 앱 설치 후 다시 눌러주세요.'),'Codex desktop app could not be found. Install it and try again.');
  assert.equal(i18n.translateError('en','ENOENT: custom path'),'ENOENT: custom path');
});
test('all declarative UI labels and pet expressions have English translations',()=>{
  const markup=fs.readFileSync(path.join(__dirname,'../renderer/index.html'),'utf8');
  const labels=[...markup.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(m=>m[1]);
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/moods.js'),'utf8'),context);
  for(const mood of Object.values(context.window.PetMoods))labels.push(mood.label,mood.gorilla,mood.tiger);
  for(const source of labels){
    assert.ok(Object.hasOwn(i18n.en,source),`Missing English: ${source}`);
    assert.doesNotMatch(i18n.translate('en',source),/[가-힣]/);
  }
});
