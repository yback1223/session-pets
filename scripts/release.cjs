'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {version}=require('../package.json');
const privatePart=/^(?:\.git|node_modules|__pycache__|work|design|dist|release|\.env(?:\..*)?|runtime\.json|\.DS_Store)$|\.(?:py[co]|log|pem|p12|mobileprovision)$/;
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Build this release on macOS Apple Silicon.');
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Expected a semantic release version.');
const out=path.join(root,'release');
if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())throw Error('Release directory must not be a symlink.');
fs.mkdirSync(out,{recursive:true});
execFileSync(process.execPath,[path.join(__dirname,'package.cjs'),'--release'],{cwd:root,stdio:'inherit'});
const prefix=`Session-Pets-v${version}`;
const appSource=path.join(out,'staging','Session Pets-darwin-arm64','Session Pets.app');
const desktop=path.join(out,`${prefix}-macos-arm64`);
fs.rmSync(desktop,{recursive:true,force:true});fs.mkdirSync(desktop);
execFileSync('/usr/bin/ditto',['--noextattr',appSource,path.join(desktop,'Session Pets.app')]);
// Local ad-hoc signing is not a Developer ID signature or Apple notarization.
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',path.join(desktop,'Session Pets.app')],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',path.join(desktop,'Session Pets.app')],{stdio:'inherit'});
const command=String.raw`#!/bin/zsh
set -eu
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  print 'Python 3 is required. Install it from https://www.python.org/downloads/macos/ and try again.'
  read '?Press Return to close.'
  exit 1
fi
if python3 "$INSTALL_DIR/Session Pets.app/Contents/Resources/app/scripts/install-integrations.py" --app "$INSTALL_DIR/Session Pets.app" --install-app; then
  print 'Installed. Open ~/Applications/Session Pets.app, then use Session-Pets in your session.'
else
  print 'Installation failed. Review the message above; your existing installation was preserved where rollback succeeded.'
  read '?Press Return to close.'
  exit 1
fi
read '?Press Return to close.'
`;
fs.writeFileSync(path.join(desktop,'Install Session Pets.command'),command,{mode:0o755});
fs.writeFileSync(path.join(desktop,'START-HERE.txt'),`Session-Pets ${version} — by yback\n\nmacOS 13 or later on Apple Silicon. Python 3 is required to install the skills.\nDouble-click Install Session Pets.command. It installs the app in\n~/Applications and the Session-Pets skills for Codex and Claude Code.\nThen open the app. In Claude use /Session-Pets; in Codex use $Session-Pets.\n\nThis build is not Developer ID signed or notarized. If macOS blocks it,\nreview Apple's Open Anyway guidance: https://support.apple.com/en-us/102445\nOnly proceed if you trust this download and its checksum.\n\nClaude hook setup and full instructions:\nhttps://github.com/yback1223/session-pets\n\nNo Node.js installation is required to run this app.\n`);
fs.copyFileSync(path.join(root,'LICENSE'),path.join(desktop,'LICENSE'));
const archives=[];
function zip(folder,name){
 const target=path.join(out,name);fs.rmSync(target,{force:true});
 execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr','--keepParent',folder,target]);
 const entries=execFileSync('/usr/bin/unzip',['-Z1',target],{encoding:'utf8',maxBuffer:16*1024*1024}).trim().split('\n');
 if(entries.some(entry=>entry.startsWith('/')||entry.split('/').some(part=>part==='..'||privatePart.test(part)))){
  fs.rmSync(target,{force:true});
  throw Error('Release archive contains an excluded path: '+name);
 }
 archives.push(target);
}
zip(desktop,`${prefix}-macos-arm64.zip`);
const integrationRoot=path.join(out,'staging','integration-archives');
fs.rmSync(integrationRoot,{recursive:true,force:true});fs.mkdirSync(integrationRoot,{recursive:true});
function copyIntegration(source,destination){
 fs.cpSync(source,destination,{recursive:true,filter:file=>path.relative(source,file).split(path.sep).every(part=>!privatePart.test(part))});
}
const claude=path.join(integrationRoot,'claude','session-pets');
copyIntegration(path.join(root,'plugins/claude-session-pets'),claude);
fs.copyFileSync(path.join(root,'LICENSE'),path.join(claude,'LICENSE'));
zip(claude,`${prefix}-claude-plugin.zip`);
const openai=path.join(integrationRoot,'openai','session-pets');
copyIntegration(path.join(root,'plugins/openai-session-pets'),openai);
zip(openai,`${prefix}-openai-plugin.zip`);
const codex=path.join(integrationRoot,'codex','Session-Pets');
copyIntegration(path.join(root,'integrations/codex/Session-Pets'),codex);
fs.mkdirSync(path.join(codex,'scripts'),{recursive:true});
fs.copyFileSync(path.join(__dirname,'pet.py'),path.join(codex,'scripts/pet.py'));
fs.copyFileSync(path.join(root,'LICENSE'),path.join(codex,'LICENSE'));
zip(codex,`${prefix}-codex-skill.zip`);
fs.writeFileSync(path.join(out,'SHA256SUMS.txt'),archives.map(file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')+'  '+path.basename(file)).join('\n')+'\n');
console.log('Release files:',...archives.map(file=>path.basename(file)));
