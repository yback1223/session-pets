'use strict';
const path=require('node:path');
const {packager}=require('@electron/packager');
require('./sync-plugins.cjs').syncPlugins();
const release=process.argv.includes('--release');
const roots=['src','renderer','shared','assets','integrations','plugins','scripts','package.json','README.md','README.ko.md','LICENSE'];
const excludedRoot=new RegExp('^/(?!(?:'+roots.map(name=>name.replaceAll('.','\\.')).join('|')+')(?:/|$)).+');
packager({
 dir:path.resolve(__dirname,'..'),name:release?'Session Pets':'열두 일꾼',platform:'darwin',arch:'arm64',
 appBundleId:'local.sessionpets',appCategoryType:'public.app-category.productivity',
 extendInfo:{CFBundleLocalizations:['en','ko'],CFBundleDevelopmentRegion:'en'},
 out:path.resolve(__dirname,release?'../release/staging':'../dist'),overwrite:true,
 // Claude reads the plugin with its own process, outside Electron's virtual ASAR filesystem.
 asar:false,ignore:[excludedRoot,/(^|\/)(__pycache__|node_modules|work|design|dist|release|\.git)(\/|$)/,/\.(py[co]|log|pem|p12|mobileprovision)$/,/\/(\.env(?:\.[^/]*)?|runtime\.json|\.DS_Store)$/]
}).then(paths=>console.log('Built:',paths.join('\n'))).catch(error=>{console.error(error.message);process.exitCode=1;});
