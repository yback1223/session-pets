'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const LIMIT=12*1024*1024;
const stateNames=['idle','working','waiting','done','error','sleep','unknown','observed','dance','laugh','angry','threat','surprised','curious','drag','blush','greeting'];
const defaultStates={idle:[0,0,0,0,1,0,0,0],working:[0,0,1,0],waiting:[12,12,0,12],done:[7,7,2,3],error:[8],sleep:[11],unknown:[0,0,0,1,0,0],observed:[0,0,1,0],dance:[2,3,4,5,2,3,5,4],laugh:[6],angry:[8],threat:[9],surprised:[10],curious:[12],drag:[13],blush:[14],greeting:[15]};
const species=[
 ['gorilla','고릴대장','고릴라','주먹은 크고, 마음은 말랑.'],
 ['tiger','호들갑','호랑이','험악한 얼굴로 귀여운 짓.']
];
function pngInfo(buf) {
 if(buf.length<33||!buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||buf.toString('ascii',12,16)!=='IHDR') throw new Error('올바른 PNG 파일이 아닙니다.');
 const w=buf.readUInt32BE(16),h=buf.readUInt32BE(20);
 if(!w||!h||w>8192||h>8192||w*h>24000000)throw new Error('이미지는 가로·세로 8192px, 총 2400만 화소 이하여야 합니다.');
 return {width:w,height:h};
}
function validateManifest(raw,info) {
 if(!raw||raw.version!==1)throw new Error('펫 파일 version은 1이어야 합니다.');
 if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>40)throw new Error('펫 이름은 1~40자로 입력하세요.');
 const {columns,rows}=raw;
 if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows>256||info.width%columns||info.height%rows)throw new Error('행·열과 이미지 크기가 맞지 않습니다. 최대 256칸까지 지원합니다.');
 if(!raw.states||!Array.isArray(raw.states.idle)||!raw.states.idle.length)throw new Error('기본 idle 프레임이 필요합니다.');
 const states={};
 for(const key of stateNames) {
   const value=raw.states[key] || raw.states.idle;
   if(!Array.isArray(value)||!value.length||value.length>256||value.some(n=>!Number.isInteger(n)||n<0||n>=columns*rows))throw new Error(`${key}의 프레임 번호를 확인하세요.`);
   states[key]=value;
 }
 return {name:raw.name.trim(),animal:'커스텀',tagline:'내가 데려온 나만의 일꾼.',columns,rows,states};
}
class PetAssets {
 constructor({assetsDir,dataDir,decode}) { this.assetsDir=assetsDir; this.dataDir=dataDir; this.decode=decode; this.catalog=[]; }
 async load() {
  this.catalog=[];
  for(const [id,name,animal,tagline] of species) {
   const file=path.join(this.assetsDir,`${id}-expressions.png`);
   try { const buf=await fs.readFile(file);const info=pngInfo(buf);const atlas=JSON.parse(await fs.readFile(path.join(this.assetsDir,`${id}-frames.json`),'utf8'));this.catalog.push({id,name,animal,tagline,frameRects:atlas.frames,canvasSize:atlas.canvasSize,image:pathToFileURL(file).href,columns:4,rows:4,states:defaultStates,...info}); }catch{}
  }
  await fs.mkdir(this.dataDir,{recursive:true,mode:0o700});
  for(const ent of await fs.readdir(this.dataDir,{withFileTypes:true}))if(ent.isDirectory()&&/^custom-[a-f0-9]{16}$/.test(ent.name)) {
   try {
    const dir=path.join(this.dataDir,ent.name), raw=JSON.parse(await fs.readFile(path.join(dir,'pet.json'),'utf8'));
    const buf=await fs.readFile(path.join(dir,'sprite.png'));const info=pngInfo(buf);const valid=validateManifest(raw,info);
    this.catalog.push({id:ent.name,...valid,...info,image:pathToFileURL(path.join(dir,'sprite.png')).href});
   }catch{}
  }
  return this.catalog;
 }
 async import(file) {
  const ext=path.extname(file).toLowerCase();if(!['.png','.json'].includes(ext))throw new Error('PNG 또는 .pet.json 파일을 선택하세요.');
  let raw,imageFile=file;
  if(ext==='.json'){
   const stat=await fs.stat(file);if(stat.size>65536)throw new Error('설정 파일은 64KB 이하여야 합니다.');
   try{raw=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw new Error('JSON 문법을 확인하세요.');}
   if(typeof raw.image!=='string'||!raw.image||path.isAbsolute(raw.image)||/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw.image)||raw.image.includes('\\'))throw new Error('image는 같은 폴더의 상대 PNG 경로여야 합니다.');
   const base=await fs.realpath(path.dirname(file));
   imageFile=await fs.realpath(path.resolve(base,raw.image));
   if(!imageFile.startsWith(base+path.sep))throw new Error('이미지가 펫 파일 폴더 밖에 있습니다.');
  }
  const stat=await fs.stat(imageFile);if(!stat.isFile()||stat.size>LIMIT)throw new Error('PNG 파일은 12MB 이하여야 합니다.');
  const buf=await fs.readFile(imageFile);const info=pngInfo(buf);
  if(this.decode&&!this.decode(buf))throw new Error('손상되어 읽을 수 없는 PNG 이미지입니다.');
  raw=raw||{version:1,name:path.basename(file,ext).slice(0,40),columns:1,rows:1,states:{idle:[0]}};
  const valid=validateManifest(raw,info);
  const id='custom-'+crypto.createHash('sha256').update(buf).update(JSON.stringify(valid)).digest('hex').slice(0,16);
  const existing=this.catalog.find(p=>p.id===id);if(existing)return existing;
  const dest=path.join(this.dataDir,id),temp=path.join(this.dataDir,'.staging-'+crypto.randomUUID());
  try {
   await fs.mkdir(temp,{recursive:true,mode:0o700});
   await fs.writeFile(path.join(temp,'sprite.png'),buf,{mode:0o600});
   await fs.writeFile(path.join(temp,'pet.json'),JSON.stringify({version:1,image:'sprite.png',...valid},null,2),{mode:0o600});
   await fs.rename(temp,dest);
  }catch(error){await fs.rm(temp,{recursive:true,force:true});throw error;}
  const pet={id,...valid,...info,image:pathToFileURL(path.join(dest,'sprite.png')).href};this.catalog.push(pet);return pet;
 }
}
module.exports={PetAssets,pngInfo,validateManifest,species};
