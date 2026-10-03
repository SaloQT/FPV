// Complete production cloud-march A/B on Dawn, plus separate exact-f32 and source-count diagnostics.
// VK_ICD_FILENAMES=/usr/lib/chromium/vk_swiftshader_icd.json WEBGPU_MODULE=/absolute/webgpu/index.js node tools/test-cloud-invariants-gpu.mjs BASELINE_ROOT OUTPUT_DIR
// No timing or hardware-performance claims. Synthetic finite textures, fixed full production march steps.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(process.argv[2]), output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
const gpu = create(['backend=vulkan']), adapter = await gpu.requestAdapter(); assert(adapter);
const device = await adapter.requestDevice(), errors = []; let lost = null;
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
device.lost.then(info => { if (info.reason !== 'destroyed') lost = info.message; });
device.pushErrorScope('validation');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function shader(repo, name) {
  const seen = new Set();
  function expand(name) {
    if (seen.has(name)) return ''; seen.add(name);
    return readFileSync(resolve(repo, 'src/render/shaders', name), 'utf8').replace(/^#include "([^"]+)"/gm, (_, n) => expand(n));
  }
  return expand(name).replaceAll('${MARIA_ROWS}', '2');
}
function instrument(code, march) {
  code += '\n@group(2) @binding(0) var<storage, read_write> counts : array<atomic<u32>, 5>;\n';
  for (const [name, type, i] of [['cloudLights', 'CloudLights', 0], ['cloudAmbient', 'Ambient', 1], ['sampleTransmittance', 'vec3f', 2], ['sampleSkyView', 'vec3f', 3]]) {
    const re = new RegExp(`(fn ${name}\\([^]*?\\) -> ${type} \\{)`); assert(re.test(code), name);
    code = code.replace(re, `$1\n atomicAdd(&counts[${i}], 1u);`);
  }
  if (march) code = code.replace('  let jitter = interleavedGradientNoise', '  atomicAdd(&counts[4], 1u);\n  let jitter = interleavedGradientNoise');
  return code;
}
const liveWords = [0,1,2,4,5,6,7,8,9,10,12,13,14,15,16,17,18,20,21,22];
const diagnostic = (candidate) => `
@group(2) @binding(0) var<storage, read_write> diagnosticValues : array<u32, 20>;
@compute @workgroup_size(1)
fn diagnosticMain() {
  ${candidate ? 'let lights = cloudFrame.lights; let amb = cloudFrame.ambient;' : 'let datumR = datumRadius(); let lights = cloudLights(datumR + 0.5 * (ap.cloudB.x + ap.cloudB.y)); let amb = cloudAmbient(lights, datumR);'}
  let values = array<f32, 20>(lights.sun.dir.x, lights.sun.dir.y, lights.sun.dir.z, lights.sun.toa.x, lights.sun.toa.y, lights.sun.toa.z, lights.sun.w,
    lights.moon.dir.x, lights.moon.dir.y, lights.moon.dir.z, lights.moon.toa.x, lights.moon.toa.y, lights.moon.toa.z, lights.moon.w,
    amb.top.x, amb.top.y, amb.top.z, amb.bottom.x, amb.bottom.y, amb.bottom.z);
  for (var i = 0u; i < 20u; i++) { diagnosticValues[i] = bitcast<u32>(values[i]); }
}`;
const C = GPUShaderStage.COMPUTE;
const uniform = binding => ({ binding, visibility: C, buffer: { type: 'uniform' } });
const samplerEntry = binding => ({ binding, visibility: C, sampler: { type: 'filtering' } });
const tex = (binding, viewDimension = '2d') => ({ binding, visibility: C, texture: { sampleType: 'float', viewDimension } });
const storage = (binding, type, minBindingSize) => ({ binding, visibility: C, buffer: { type, ...(minBindingSize ? { minBindingSize } : {}) } });
const b0 = device.createBindGroupLayout({ entries: [uniform(0)] });
const common = [samplerEntry(0),tex(1),{ binding: 3, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },uniform(5),tex(6,'3d'),tex(7,'3d'),samplerEntry(8),tex(40),tex(41,'3d')];
const layouts = {
  baseline: device.createBindGroupLayout({ entries: common }),
  candidate: device.createBindGroupLayout({ entries: [...common,storage(11,'read-only-storage',96)] }),
  precompute: device.createBindGroupLayout({ entries: [samplerEntry(0),tex(1),uniform(5),tex(40),storage(11,'storage',96)] }),
};
const extra = device.createBindGroupLayout({ entries: [storage(0,'storage')] });
const pipelines = new Map();
for (const kind of ['baseline','candidate','precompute']) for (const mode of ['production','counted', ...(kind === 'precompute' ? [] : ['diagnostic'])]) {
  let code = shader(kind === 'baseline' ? baseline : root, kind === 'precompute' ? 'sky/cloud_precompute.wgsl' : 'sky/cloud_march.wgsl');
  if (mode === 'counted') code = instrument(code, kind !== 'precompute');
  if (mode === 'diagnostic') code += diagnostic(kind === 'candidate');
  const name = `${kind}-${mode}`; writeFileSync(resolve(output, name + '.wgsl'), code);
  console.log('COMPILE', name);
  const module = device.createShaderModule({ label: name, code });
  const messages = (await module.getCompilationInfo()).messages.map(m => ({ type: m.type, message: m.message, lineNum: m.lineNum, linePos: m.linePos }));
  assert.equal(messages.filter(m => m.type === 'error').length, 0, JSON.stringify(messages));
  pipelines.set(name, await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [b0, layouts[kind], ...(mode === 'production' ? [] : [extra])] }), compute: { module, entryPoint: mode === 'diagnostic' ? 'diagnosticMain' : 'main' } }));
}
const bitsF = new Float32Array(1), bitsU = new Uint32Array(bitsF.buffer);
function half(value) {
  bitsF[0]=value; const x=bitsU[0], sign=(x>>>16)&0x8000, exp=(x>>>23)&0xff, mant=x&0x7fffff;
  if(exp===0xff)return sign|0x7c00|(mant?0x200:0); const e=exp-127+15;
  if(e>=31)return sign|0x7c00;
  if(e<=0){if(e< -10)return sign;const m=mant|0x800000,shift=14-e,h=m>>>shift,rem=m&((1<<shift)-1),mid=1<<(shift-1);return sign|(h+(rem>mid||(rem===mid&&(h&1))?1:0));}
  let h=sign|(e<<10)|(mant>>>13);const rem=mant&0x1fff;if(rem>0x1000||(rem===0x1000&&(h&1)))h++;return h;
}
const textures = [];
function texture(size, fn, dimension='2d') {
  const [w,h,d=1]=size, values=new Uint16Array(w*h*d*4);
  for(let z=0;z<d;z++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=fn(x,y,z);for(let c=0;c<4;c++)values[((z*h+y)*w+x)*4+c]=half(v[c]);}
  const t=device.createTexture({ size,dimension,format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({texture:t},values,{bytesPerRow:w*8,rowsPerImage:h},size); textures.push(t);return t.createView();
}
const lut=texture([256,64],(x,y)=>[0.1+0.8*x/255,0.1+0.85*y/63,0.3+0.65*(x+y)/318,1]);
const sky=texture([192,108],(x,y)=>[20+170*x/191,35+190*y/107,70+100*(x+y)/298,1]);
const aerial=texture([32,32,32],(x,y,z)=>[3+x/4,5+y/5,8+z/6,0.95-0.5*z/31],'3d');
const noise=texture([8,8,8],(x,y,z)=>[0.83+0.15*((x+y+z)%7)/6,0.45+0.25*(x%5)/4,0.55+0.3*(y%5)/4,0.6+0.25*(z%5)/4],'3d');
const clampSampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
const noiseSampler=device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',addressModeW:'repeat'});
function buffer(data, usage) {const b=device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,data);return b;}
const cases = [
  {name:'noon-full-up',width:17,height:9,pitch:0.9,alt:20,sunY:0.8,moonY:0.6,moon:0,coverage:1,cirrus:1,steps:32},
  {name:'noon-sun-off-control',width:17,height:9,pitch:0.9,alt:20,sunY:0.8,moonY:0.6,moon:0,coverage:1,cirrus:1,steps:32,sunE:0},
  {name:'twilight-partial-horizon',width:19,height:11,pitch:0.03,alt:300,sunY:-0.025,moonY:0.18,moon:1,coverage:0.55,cirrus:0.3,steps:32,sunE:0.4},
  {name:'night-cirrus-up',width:9,height:7,pitch:0.8,alt:1500,sunY:-0.6,moonY:0.8,moon:1,coverage:0,cirrus:0.9,steps:24,sunE:0},
  {name:'above-cumulus-empty',width:11,height:5,pitch:0.15,alt:4500,sunY:0.25,moonY:-0.5,moon:1,coverage:1,cirrus:0,steps:48},
  {name:'empty-coverage',width:13,height:9,pitch:0.6,alt:20,sunY:0.8,moonY:0.6,moon:1,coverage:0,cirrus:0,steps:32},
  {name:'fully-planet-occluded',width:7,height:5,pitch:-1.2,alt:20,sunY:0.8,moonY:0.6,moon:0,coverage:1,cirrus:1,steps:32},
  {name:'clouds-disabled',width:1,height:1,pitch:0.8,alt:20,sunY:0.8,moonY:0.6,moon:0,coverage:1,cirrus:1,steps:16,enabled:0},
];
function uniforms(f) {
  const frame=new Float32Array(192), atmos=new Float32Array(52);const p=f.pitch, s=Math.sin(p), c=Math.cos(p);
  // Inverse view-projection at a fixed reverse-Z depth: a perspective fan with the requested pitch and camera origin.
  const m=96; frame[m]=0.65*f.width/f.height; frame[m+5]=0.65*c;frame[m+6]=0.65*s;
  frame[m+9]=f.alt;frame[m+11]=1;frame[m+13]=s;frame[m+14]=-c;
  // w=depth, so the ray is 10000 times (right*ndc.x+up*ndc.y+forward), relative to the camera.
  frame.set([0,f.alt,0,0],144);frame.set([f.width,f.height,1/f.width,1/f.height],148);
  frame.set([Math.sqrt(1-f.sunY*f.sunY),f.sunY,0,0.00465],156);
  frame.set([127000,124000,121000].map(x=>x*(f.sunE??1)).concat(1),160);
  frame.set([0,f.moonY,Math.sqrt(1-f.moonY*f.moonY),0.0045],164);frame.set([0.26,0.3,0.35,1],168);
  frame.set([1/60,1,0.05,20000],184);frame.set([6360,6460,f.alt*0.001,1],188);
  atmos[0]=f.moon;atmos[6]=f.enabled??1;atmos.set([f.coverage,f.cirrus,1,17],8);atmos.set([1,2.5,6,7],12);
  atmos.set([f.steps,3,0,0],20);atmos.set([0.9,0,5,8000],24);atmos[31]=0.4;
  return [frame,atmos];
}
async function run(kind, mode, f) {
  const [frame,atmos]=uniforms(f), fb=buffer(frame,GPUBufferUsage.UNIFORM),ab=buffer(atmos,GPUBufferUsage.UNIFORM);
  const target=device.createTexture({size:[f.width,f.height],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const lighting=device.createBuffer({size:96,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const aux=device.createBuffer({size:80,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const row=Math.ceil(f.width*8/256)*256, imageBytes=row*f.height;
  const read=device.createBuffer({size:imageBytes+176,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const g0=device.createBindGroup({layout:b0,entries:[{binding:0,resource:{buffer:fb}}]});
  const baseEntries=[{binding:0,resource:clampSampler},{binding:1,resource:lut},{binding:5,resource:{buffer:ab}},{binding:40,resource:sky}];
  const groups={precompute:device.createBindGroup({layout:layouts.precompute,entries:[...baseEntries,{binding:11,resource:{buffer:lighting}}]}),
    [kind]:device.createBindGroup({layout:layouts[kind],entries:[...baseEntries,{binding:3,resource:target.createView()},{binding:6,resource:noise},{binding:7,resource:noise},{binding:8,resource:noiseSampler},{binding:41,resource:aerial},...(kind==='candidate'?[{binding:11,resource:{buffer:lighting}}]:[])]})};
  const gx=device.createBindGroup({layout:extra,entries:[{binding:0,resource:{buffer:aux}}]});
  const enc=device.createCommandEncoder(),pass=enc.beginComputePass();
  function dispatch(stage,stageMode,x,y){pass.setPipeline(pipelines.get(`${stage}-${stageMode}`));pass.setBindGroup(0,g0);pass.setBindGroup(1,groups[stage]);if(stageMode!=='production')pass.setBindGroup(2,gx);pass.dispatchWorkgroups(x,y);}
  if(kind==='candidate')dispatch('precompute',mode==='counted'?'counted':'production',1,1);
  dispatch(kind,mode,mode==='diagnostic'?1:Math.ceil(f.width/8),mode==='diagnostic'?1:Math.ceil(f.height/8));pass.end();
  enc.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:row},[f.width,f.height]);
  enc.copyBufferToBuffer(aux,0,read,imageBytes,80);enc.copyBufferToBuffer(lighting,0,read,imageBytes+80,96);
  device.queue.submit([enc.finish()]);const validation=await device.popErrorScope();assert.equal(validation,null,validation?.message);device.pushErrorScope('validation');
  await read.mapAsync(GPUMapMode.READ);const mapped=new Uint8Array(read.getMappedRange());
  const pixels=Buffer.alloc(f.width*f.height*8);for(let y=0;y<f.height;y++)pixels.set(mapped.subarray(y*row,y*row+f.width*8),y*f.width*8);
  const diag=Buffer.from(mapped.slice(imageBytes,imageBytes+80)),stored=Buffer.from(mapped.slice(imageBytes+80,imageBytes+176));
  const counts=Array.from(new Uint32Array(diag.buffer,diag.byteOffset,5));read.unmap();
  [fb,ab,target,lighting,aux,read].forEach(r=>r.destroy());
  const stem=`${f.name}-${kind}-${mode}`;writeFileSync(resolve(output,stem+(mode==='diagnostic'?'.u32':'.rgba16')),mode==='diagnostic'?diag:pixels);
  if(kind==='candidate'&&mode==='diagnostic')for(let i=0;i<20;i++)assert.equal(diag.readUInt32LE(i*4),stored.readUInt32LE(liveWords[i]*4),'96-byte storage layout preserves every live word');
  return {pixels,diag,counts,sha256:hash(mode==='diagnostic'?diag:pixels)};
}
const results=[], productionByName=new Map();
for(const f of cases){
  console.log('CASE',f.name);
  const a=await run('baseline','production',f),b=await run('candidate','production',f);
  assert.deepEqual(b.pixels,a.pixels,`${f.name}: full production march must match bit-for-bit`); console.log('PRODUCTION PASS', f.name, a.pixels.length, b.sha256);
  const da=await run('baseline','diagnostic',f),db=await run('candidate','diagnostic',f);
  assert.deepEqual(db.diag,da.diag,`${f.name}: 20 f32 invariant fields must match bit-for-bit`); console.log('F32 PASS', f.name, db.sha256);
  for(let i=0;i<80;i+=4)assert.notEqual(db.diag.readUInt32LE(i)&0x7f800000,0x7f800000,'finite f32 intermediates');
  const ca=await run('baseline','counted',f),cb=await run('candidate','counted',f);
  assert.deepEqual(ca.pixels,a.pixels,'baseline source counters preserve production output');assert.deepEqual(cb.pixels,b.pixels,'candidate source counters preserve production output');
  const n=ca.counts[4];assert.equal(cb.counts[4],n);assert.deepEqual(ca.counts.slice(0,2),[n,n]);assert.deepEqual(cb.counts.slice(0,2),[1,1]);
  assert.equal(ca.counts[2]-cb.counts[2],4*(n-1));assert.equal(ca.counts[3]-cb.counts[3],5*(n-1));
  productionByName.set(f.name,b.pixels);
  const words=new Uint16Array(b.pixels.buffer,b.pixels.byteOffset,b.pixels.byteLength/2);let nonempty=0;
  for(let i=0;i<words.length;i++){assert.notEqual(words[i]&0x7c00,0x7c00,'finite rgba16 output');if(i%4===3&&words[i]!==0x3c00)nonempty++;}
  if(['fully-planet-occluded','clouds-disabled'].includes(f.name))assert.equal(n,0);
  if(['above-cumulus-empty','empty-coverage','fully-planet-occluded','clouds-disabled'].includes(f.name))assert.equal(nonempty,0);
  else assert(nonempty>0,`${f.name}: cloud contribution must be nonempty`);
  const result={fixture:f,exactProductionMatch:true,exactF32Match:true,nonemptyCloudPixels:nonempty,baselineCounts:ca.counts,candidateCounts:cb.counts,sha256:b.sha256,intermediateSha256:db.sha256};
  results.push(result);console.log('PASS',JSON.stringify(result));
}
const lit=productionByName.get('noon-full-up'), unlit=productionByName.get('noon-sun-off-control');
let changedRgbComponents=0;for(let i=0;i<lit.length;i+=2){if((i/2)%4===3)assert.equal(lit.readUInt16LE(i),unlit.readUInt16LE(i),'Lighting control preserves cloud opacity');else if(lit.readUInt16LE(i)!==unlit.readUInt16LE(i))changedRgbComponents++;}
assert(changedRgbComponents>0,'The active sun must affect visible cloud radiance');
const activeControl={baseline:'noon-full-up',comparison:'noon-sun-off-control',changedRgbComponents,opacityUnchanged:true};console.log('ACTIVE CONTROL PASS',JSON.stringify(activeControl));
const validation=await device.popErrorScope();assert.equal(validation,null);assert.deepEqual(errors,[]);assert.equal(lost,null);
const report={baseline,adapter:Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,adapter.info[k]])),fullProductionComparisons:results.length,f32ComponentsPerCase:20,storageBytes:96,activeControl,
  counterLabels:['cloudLights calls','cloudAmbient calls','all transmittance samples','all sky-view samples','non-planet-occluded cloud pixels'],results,errors,validation,lost,hardwarePerformanceMeasured:false,
  limitation:'Synthetic finite textures with complete production cloud march and precompute shaders. Source counters can inhibit DCE and are not hardware instruction, cache-traffic, bandwidth or FPS measurements. The above-cumulus empty control is an upward view from 4.5 km over the 1–2.5 km cumulus shell with cirrus off. Every encoded cloud frame adds one precompute dispatch, a 96-byte persistent buffer, its f32 writes, and invariant-buffer reads in surviving march invocations. Fully planet-occluded and cloud-disabled frames have zero baseline invariant calls but nine candidate invariant source samples; empty coverage can still execute baseline invariant work. Physical-GPU A/B profiling is required to establish net performance.'};
writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log('ALL PASS');textures.forEach(t=>t.destroy());device.destroy();
