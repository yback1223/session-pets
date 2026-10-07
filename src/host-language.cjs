'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const i18n=require('../shared/i18n.js');

function readSmall(file) {
  try { if(fs.statSync(file).size>1048576)return null;return fs.readFileSync(file,'utf8'); }
  catch { return null; }
}
function readJSON(file) { try { return JSON.parse(readSmall(file)); } catch { return null; } }
function writeAtomic(file,text) {
  const temporary=file+'.session-pets-'+process.pid;
  try{fs.writeFileSync(temporary,text,{mode:0o600});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch{}}
}
function appLanguage(home,bundle) {
  const file=path.join(home,'Library/Preferences',bundle+'.plist');
  if(process.platform!=='darwin'||!fs.existsSync(file))return null;
  try{
    const values=JSON.parse(execFileSync('/usr/bin/plutil',['-extract','AppleLanguages','json','-o','-',file],{encoding:'utf8',timeout:1000,stdio:['ignore','pipe','ignore']}));
    return Array.isArray(values)?values.map(i18n.normalizeLocale).find(Boolean):null;
  }catch{return null;}
}
// Read only the desktop setting owned by Codex, without exporting unrelated config.
function codexLocale(text) {
  if(typeof text!=='string')return null;
  let section='';
  for(const line of text.split(/\r?\n/)) {
    const header=/^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if(header){section=header[1].trim();continue;}
    const setting=section==='desktop'?/^\s*localeOverride\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/:section===''?/^\s*desktop\.localeOverride\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/:null;
    const match=setting?.exec(line);
    if(match)try{return i18n.normalizeLocale(match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1));}catch{return null;}
  }
  return null;
}
function createHostLanguages({home=os.homedir(),dataDir,codexHome=process.env.CODEX_HOME||path.join(home,'.codex'),systemLanguages=()=>['en']}={}) {
  let hosts={};
  const languageDir=path.join(dataDir,'languages');
  fs.mkdirSync(languageDir,{recursive:true,mode:0o700});
  function refresh(overrides) {
    const fallback=systemLanguages().map(i18n.normalizeLocale).find(Boolean)||'en';
    const candidates={codex:codexLocale(readSmall(path.join(codexHome,'config.toml')))||appLanguage(home,'com.openai.codex'),claude:i18n.normalizeLocale(readJSON(path.join(home,'Library/Application Support/Claude/config.json'))?.locale)||appLanguage(home,'com.anthropic.claudefordesktop')};
    for(const provider of ['codex','claude']) {
      const selected=overrides?i18n.normalizeLocale(overrides[provider])||fallback:candidates[provider]||fallback;
      const source=overrides?'test':candidates[provider]?'host-setting':'system';
      const file=path.join(languageDir,selected+'.json');
      if(!['en','ko'].includes(selected.split('-')[0])) {
        const value=readJSON(file);
        try { if(value?.locale!==selected)throw Error();i18n.registerCatalog(value); }
        catch { if(!fs.existsSync(file))i18n.removeCatalog(selected); /* Keep a complete catalog during a partial write. */ }
      }
      hosts[provider]={locale:selected,source,language:i18n.resolveLanguage(selected),translationReady:i18n.hasCatalog(selected),file};
    }
    return hosts;
  }
  function get(provider) { return hosts[provider]||{locale:systemLanguages().map(i18n.normalizeLocale).find(Boolean)||'en',source:'system'}; }
  function prepare(provider) {
    const host=get(provider);
    return {status:'language',locale:host.locale,languageSource:host.source,translationReady:host.translationReady,
      ...(!host.translationReady?{translationRequest:{catalogPath:host.file,version:1,locale:host.locale,sourceLanguage:'en',messages:i18n.en}}:{})};
  }
  function syncInstalledSkills() {
    for(const [provider,folder] of [['codex',path.join(home,'.agents/skills/Session-Pets')],['claude',path.join(home,'.claude/skills/Session-Pets')]]) {
      if(readJSON(path.join(folder,'.session-pets.json'))?.owner!=='session-pets')continue;
      const host=get(provider);
      if(!host.translationReady)continue;
      const t=source=>i18n.translate(host.language,source);
      const skill=path.join(folder,'SKILL.md');
      const body=readSmall(skill);
      if(body?.startsWith('---\n')&&/^name: Session-Pets$/m.test(body)) {
        let next=body.replace(/^description:.*$/m,()=>'description: '+JSON.stringify(t('현재 세션의 바탕화면 펫을 소환하거나 고르고 숨긴다.')));
        if(provider==='claude')next=next.replace(/^argument-hint:.*$/m,()=>'argument-hint: '+JSON.stringify(t('[choose | hide | status | 펫 이름]')));
        if(next!==body)writeAtomic(skill,next);
      }
      if(provider==='codex') {
        const file=path.join(folder,'agents/openai.yaml');
        const old=readSmall(file);
        if(old) {
          const next=old.replace(/^(\s+display_name:) .*$/m,(_,key)=>key+' '+JSON.stringify('Session-Pets')).replace(/^(\s+short_description:) .*$/m,(_,key)=>key+' '+JSON.stringify(t('현재 세션의 작은 일꾼을 고르고 소환해요')));
          if(next!==old)writeAtomic(file,next);
        }
      }
    }
  }
  return {refresh,get,prepare,syncInstalledSkills};
}
module.exports={codexLocale,createHostLanguages};
