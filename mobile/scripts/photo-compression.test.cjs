const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/photos.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function fixture(width,height,alwaysLarge=false){
 const draws=[];const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(image,x,y,w,h){draws.push([w,h]);}}),toDataURL:()=> 'data:image/jpeg;base64,'+'a'.repeat(alwaysLarge?700000:Math.round(canvas.width*canvas.height))};
 class Image {naturalWidth=width;naturalHeight=height;set src(value){if(value)queueMicrotask(()=>this.onload());}}
 const module={exports:{}};vm.runInNewContext(code,{exports:module.exports,module,require:n=>n==='react-native'?{Platform:{OS:'web'}}:{Capacitor:{}},Image,document:{createElement:()=>canvas},queueMicrotask});
 return {compress:module.exports.compressWebPhoto,draws,canvas};
}
test('large landscape and portrait photos fit both maximum dimensions and upload limits',async()=>{
 for(const [w,h] of [[6000,4000],[4000,6000]]) {const f=fixture(w,h);const photo=await f.compress('photo',1280,650000);assert.ok(photo.length<=650000);assert.ok(f.draws.every(([x,y])=>x<=1280&&y<=1280));assert.ok(f.draws.every(([x,y])=>Math.abs(x/y-w/h)<0.01));assert.equal(f.canvas.width,0);}
});
test('small images are not enlarged and failed encodes release the canvas',async()=>{
 const small=fixture(40,30);await small.compress('photo',384,110000);assert.deepEqual(small.draws,[[40,30]]);
 const bad=fixture(6000,4000,true);await assert.rejects(()=>bad.compress('photo',1280,650000));assert.equal(bad.canvas.width,0);
});
