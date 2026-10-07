'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {PetAssets,validateManifest}=require('../src/assets.cjs');
test('two built-in pets have 16 complete viewports and expressive states',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pet-expressions-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
 const assets=new PetAssets({assetsDir:path.resolve('assets/pets'),dataDir});await assets.load();
 assert.deepEqual(assets.catalog.map(p=>p.id),['gorilla','tiger']);
 for(const pet of assets.catalog){
  assert.equal(pet.frameRects.length,16);
  for(const frame of pet.frameRects){assert.ok(frame.x>=0&&frame.y>=0&&frame.width>0&&frame.height>0);assert.ok(frame.x+frame.width<=pet.width&&frame.y+frame.height<=pet.height);}
  for(const mood of ['dance','laugh','angry','threat','surprised','curious','drag','blush','greeting','sleep']) assert.ok(pet.states[mood].length>0);
  assert.ok(new Set(pet.states.dance).size>=4);
 }
});
test('custom pets keep static fallback and reject invalid emotion frames',()=>{
 const base={version:1,name:'Custom',columns:1,rows:1,states:{idle:[0]}};
 assert.deepEqual(validateManifest(base,{width:10,height:10}).states.threat,[0]);
 assert.throws(()=>validateManifest({...base,states:{idle:[0],threat:[1]}},{width:10,height:10}));
});
