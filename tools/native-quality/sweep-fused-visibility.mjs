// Fuse the unchanged GI hit and secondary visibility calculations, keeping f32
// records. This trades a larger two-texture record for one fewer dispatch and
// avoids decoding/reconstructing the primary hit in a separate visibility stage.
import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const paths={tex:'src/render/rt/textures.ts',layout:'src/render/rt/layouts.ts',pipes:'src/render/rt/pipelines.ts',index:'src/render/rt/index.ts',io:'src/render/shaders/rt/rt_trace_io.wgsl',gi:'src/render/shaders/rt/gi.wgsl'};
const base=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([k,p])=>[k,await read(p)])));
const traceStart=base.gi.indexOf('fn encodeGiHit('),traceEnd=base.gi.indexOf('// Diffuse GI:',traceStart);
if(traceStart<0||traceEnd<0||!base.gi.includes('VISIBILITY_ONLY'))throw new Error('Expected the recorded hit / visibility pipeline');
const visibility=`fn recordedGiVisibility(px : vec2i, ray : u32) -> f32 {
  if (ray == 0u) { return textureLoad(giHit0, px, 0).z; }
  return textureLoad(giHit1, px, 0).z;
}`;
const trace=`fn traceGiRecord(px : vec2i, pix : PixelInfo, ray : u32) -> vec4f {
  let d = basisFromNormal(pix.n) * cosineHemisphere(noise2(px, 1u + ray));
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let h = traceScene(origin, d, rp.f.w, rp.cfg.y);
  var code = 0.0;
  var vis = 1.0;
  if (h.kind == KIND_TERRAIN) { code = -1.0; }
  else if (h.kind == KIND_PRIM) { code = f32(h.prim + 1u); }
  if (h.kind != KIND_MISS) {
    let p = origin + d * h.t;
    let s = surfaceAt(h, p, d);
    let key = keyDir();
    if (lightCosine(s, key.xyz) > 0.0 && key.y > -0.03) {
      if (h.t < NEAR_SHADOW_RANGE) {
        let o = p + s.n * (0.04 + 0.003 * h.t);
        vis = keyVisibility(o, key.xyz, SHADOW_RAY_RANGE, max(16u, rp.cfg.y / 3u));
      } else if (h.kind == KIND_TERRAIN) { vis = s.ao; }
      vis *= cloudTransmittance(p);
    }
  }
  return vec4f(h.t, code, vis, 0.0);
}
`;
const common={
 [paths.tex]:base.tex.replace('rg32float: 8,','rg32float: 8, rgba32float: 16,').replace("this.make('rt gi hit 0', 'rg32float'), this.make('rt gi hit 1', 'rg32float')","this.make('rt gi hit 0', 'rgba32float'), this.make('rt gi hit 1', 'rgba32float')"),
 [paths.layout]:base.layout.replace('const visibility = device.limits.maxSampledTexturesPerShaderStage >= 19;','const visibility = false; // Visibility travels in the full-precision hit record.').replace("layout('gi hits', traceEntries('rg32float'))","layout('gi hits', traceEntries('rgba32float'))"),
 [paths.pipes]:base.pipes.replace('SHADE_VISIBILITY: !!L.giVisibility','SHADE_VISIBILITY: true'),
 [paths.io]:base.io.replaceAll('texture_storage_2d<rg32float, write>','texture_storage_2d<rgba32float, write>'),
};
const variants=[['E113',8,4,false],['E114',8,2,true],['E115',4,4,true],['E116',8,4,true]].map(([id,x,y,parallel])=>{
 const main=`@compute @workgroup_size(${x}, ${y}${parallel?', 2':''})
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  ${parallel?`var record = vec4f(0.0);
  if (pix.ok && rp.dbg.x != 5u) { record = traceGiRecord(px, pix, gid.z); }
  if (gid.z == 0u) { textureStore(out0, px, record); }
  else { textureStore(out1, px, record); }`:`if (!pix.ok || rp.dbg.x == 5u) {
    textureStore(out0, px, vec4f(0.0)); textureStore(out1, px, vec4f(0.0)); return;
  }
  textureStore(out0, px, traceGiRecord(px, pix, 0u));
  textureStore(out1, px, traceGiRecord(px, pix, 1u));`}
}
`;
 let gi=base.gi.slice(0,traceStart)+trace+main+'#else\n\n'+base.gi.slice(traceEnd);
 gi=gi.replace(/@group\(\$\{GRP\}\) @binding\(14\) var giVisibility0[\s\S]*?fn recordedGiVisibility\([\s\S]*?\n\}/,visibility);
 const index=base.index.replace(/this\.traced\(this\.pipes\.giHits, groups\.giHits\[par\],[^\n]+/,`this.traced(this.pipes.giHits, groups.giHits[par], Math.ceil(this.rc.gbuf.rtWidth / ${x}), Math.ceil(this.rc.gbuf.rtHeight / ${y}), 1);`);
 return {id,label:`Fused GI hit visibility ${x}x${y}${parallel?'x2':''}`,hypothesis:'Combine primary hit tracing and the identical secondary visibility calculation before writing a full-precision record; remove one dispatch and intermediate reconstruction, accepting 66 MB more texture memory at 4K',files:{...common,[paths.gi]:gi,[paths.index]:index}};
});
// A separate approximation keeps the distance and primitive index exact, and
// quantizes only [0,1] visibility to 14 bits. MAX_PRIMS + 64 dynamic slots fit
// comfortably in the remaining 18-bit tag. Integer textures avoid NaN payload
// canonicalization that would make float bit packing unsafe.
for (const [id,source] of [['E117',variants[1]],['E118',variants[3]]]) {
 const files={...source.files};
 files[paths.tex]=files[paths.tex].replace('rgba32float: 16,','rgba32float: 16, rg32uint: 8,').replaceAll("'rt gi hit 0', 'rgba32float'","'rt gi hit 0', 'rg32uint'").replaceAll("'rt gi hit 1', 'rgba32float'","'rt gi hit 1', 'rg32uint'");
 files[paths.layout]=files[paths.layout].replace("traceEntries('rgba32float')","traceEntries('rg32uint')")
   .replace('  const store2d =',"  const texUint = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType: 'uint' } });\n  const store2d =")
   .replaceAll('tex2d(12), tex2d(13)','texUint(12), texUint(13)');
 files[paths.io]=files[paths.io].replaceAll('texture_storage_2d<rgba32float, write>','texture_storage_2d<rg32uint, write>');
 let gi=files[paths.gi].replace(/#ifdef GI_RECORDED[\s\S]*?#endif/,`#ifdef GI_RECORDED
@group(\${GRP}) @binding(12) var giHit0 : texture_2d<u32>;
@group(\${GRP}) @binding(13) var giHit1 : texture_2d<u32>;
fn giRecord(px : vec2i, ray : u32) -> vec2u {
  if (ray == 0u) { return textureLoad(giHit0, px, 0).xy; }
  return textureLoad(giHit1, px, 0).xy;
}
fn recordedGiHit(px : vec2i, ray : u32) -> SceneHit {
  let record = giRecord(px, ray);
  let t = bitcast<f32>(record.x);
  let code = record.y & 262143u;
  if (code == 1u) { return SceneHit(t, KIND_TERRAIN, 0u); }
  if (code > 1u) { return SceneHit(t, KIND_PRIM, code - 2u); }
  return SceneHit(t, KIND_MISS, 0u);
}
#endif`);
 gi=gi.replace(/fn recordedGiVisibility\([\s\S]*?\n\}/,`fn recordedGiVisibility(px : vec2i, ray : u32) -> f32 {
  return f32(giRecord(px, ray).y >> 18u) * (1.0 / 16383.0);
}`);
 gi=gi.replace('fn traceGiRecord(px : vec2i, pix : PixelInfo, ray : u32) -> vec4f','fn traceGiRecord(px : vec2i, pix : PixelInfo, ray : u32) -> vec4u')
   .replace('var code = 0.0;','var code = 0u;').replace('code = -1.0;','code = 1u;').replace('code = f32(h.prim + 1u);','code = h.prim + 2u;')
   .replace('return vec4f(h.t, code, vis, 0.0);','let packed = code | (u32(round(clamp(vis, 0.0, 1.0) * 16383.0)) << 18u);\n  return vec4u(bitcast<u32>(h.t), packed, 0u, 0u);')
   .replace('var record = vec4f(0.0);','var record = vec4u(0u);');
 files[paths.gi]=gi;
 variants.push({id,label:source.label.replace('Fused','Packed fused'),hypothesis:'Keep f32 ray distance and exact primitive identity in RG32Uint; quantize secondary visibility to 14 bits to save 66 MB relative to the three-stage path and reduce record bandwidth. Compare every quality sample to ORIGINAL',files});
}
const predecessor=process.argv[2]??'.bench/research-20261005/overnight-gi-serial-winner.json';
const winner=JSON.parse(await read(predecessor));
await explore('overnight-fused-visibility',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
