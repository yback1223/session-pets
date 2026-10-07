'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {codexLocale,createHostLanguages}=require('../src/host-language.cjs');
const i18n=require('../shared/i18n.js');
function setup(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pet-language-'));
  t.after(()=>{fs.rmSync(home,{recursive:true,force:true});for(const locale of ['fr-FR','ar-SA'])i18n.removeCatalog(locale);});
  const write=(relative,contents)=>{const file=path.join(home,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof contents==='string'?contents:JSON.stringify(contents));return file;};
  const manager=createHostLanguages({home,dataDir:path.join(home,'data'),codexHome:path.join(home,'.codex'),systemLanguages:()=>['de-DE','ko-KR']});
  return{home,write,manager};
}
test('Codex language is read only from its desktop locale setting',()=>{
  assert.equal(codexLocale('[desktop]\nlocaleOverride = "ko-KR" # interface\n'),'ko-KR');
  assert.equal(codexLocale("desktop.localeOverride = 'fr-FR'"),'fr-FR');
  assert.equal(codexLocale('[projects.sample]\nlocaleOverride="ja-JP"'),null);
  assert.equal(codexLocale('[desktop]\nlocaleOverride="../../wrong"'),null);
});
test('each app overrides the system language independently and missing settings follow the system',t=>{
  const {manager,write}=setup(t);
  const config=write('.codex/config.toml','[desktop]\nlocaleOverride="ko-KR"\n');
  write('Library/Application Support/Claude/config.json',{locale:'en-US',private:'not exported'});
  manager.refresh();assert.equal(manager.get('codex').locale,'ko-KR');assert.equal(manager.get('claude').locale,'en-US');
  assert.equal(manager.get('codex').language,'ko');assert.equal(manager.get('claude').language,'en');
  assert.equal(JSON.stringify(manager.prepare('claude')).includes('not exported'),false);
  fs.writeFileSync(config,'[desktop]\n');manager.refresh();
  assert.equal(manager.get('codex').locale,'de-DE');assert.equal(manager.get('codex').source,'system');assert.equal(manager.get('codex').translationReady,false);
});
test('a new locale requests all UI strings and a valid local catalog is reused',t=>{
  const {manager,write}=setup(t);
  write('.codex/config.toml','[desktop]\nlocaleOverride="fr-FR"');manager.refresh();
  const first=manager.prepare('codex');assert.equal(first.translationReady,false);
  assert.deepEqual(first.translationRequest.messages,i18n.en);
  // The fixture validates the transport, not the quality of every translation.
  const messages={...i18n.en,'펫 소환':'Invoquer un compagnon','작업 완료':'Travail terminé'};
  fs.writeFileSync(first.translationRequest.catalogPath,JSON.stringify({version:1,locale:'fr-FR',messages}));
  manager.refresh();assert.equal(manager.prepare('codex').translationReady,true);
  assert.equal(manager.prepare('codex').translationRequest,undefined);
  assert.equal(i18n.translate(manager.get('codex').language,'작업 완료'),'Travail terminé');
  fs.writeFileSync(first.translationRequest.catalogPath,'{');manager.refresh();
  assert.equal(i18n.translate(manager.get('codex').language,'작업 완료'),'Travail terminé');
});
test('incomplete, malformed, multiline metadata and broken placeholders are rejected',t=>{
  setup(t);
  const pack={version:1,locale:'ar-SA',messages:{...i18n.en}};
  for(const change of [{messages:{}},{locale:'../ar'},{messages:{...pack.messages,'{name} 선택':'اختيار'}},{messages:{...pack.messages,'펫 소환':'bad\nmetadata'}}])assert.throws(()=>i18n.registerCatalog({...pack,...change}));
  assert.equal(i18n.hasCatalog('ar-SA'),false);
  assert.equal(i18n.direction('ar-SA'),'rtl');assert.equal(i18n.direction('he-IL'),'rtl');assert.equal(i18n.direction('ja-JP'),'ltr');
});
test('only owned installed skill labels change; policy, instructions and host settings survive',t=>{
  const {manager,write,home}=setup(t);
  const config=write('.codex/config.toml','[desktop]\nlocaleOverride="en-US"');
  write('Library/Application Support/Claude/config.json',{locale:'ko-KR'});
  write('.agents/skills/Session-Pets/.session-pets.json',{owner:'session-pets'});
  write('.agents/skills/Session-Pets/SKILL.md','---\nname: Session-Pets\ndescription: 이전 설명\n---\nKeep instructions.\n');
  const yaml=write('.agents/skills/Session-Pets/agents/openai.yaml','interface:\n  display_name: "펫 소환"\n  short_description: "이전 설명"\npolicy:\n  allow_implicit_invocation: false\n');
  const other=write('.claude/skills/Session-Pets/SKILL.md','Unrelated skill.');
  manager.refresh();manager.syncInstalledSkills();
  assert.match(fs.readFileSync(yaml,'utf8'),/display_name: "Session-Pets"/);assert.match(fs.readFileSync(yaml,'utf8'),/allow_implicit_invocation: false/);
  assert.match(fs.readFileSync(path.join(home,'.agents/skills/Session-Pets/SKILL.md'),'utf8'),/Keep instructions/);
  assert.equal(fs.readFileSync(other,'utf8'),'Unrelated skill.');assert.equal(fs.readFileSync(config,'utf8'),'[desktop]\nlocaleOverride="en-US"');
});
