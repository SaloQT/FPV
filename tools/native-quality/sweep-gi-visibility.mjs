import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const paths=['rt/textures.ts','rt/layouts.ts','rt/groups.ts','rt/pipelines.ts','rt/index.ts','shaders/rt/gi.wgsl','shaders/rt/rt_trace_io.wgsl','shaders/rt/rt_scene.wgsl'].map(p=>'src/render/'+p);
const original=Object.fromEntries(await Promise.all(paths.map(async p=>[p,await read(p)])));
const source={...original};
function edit(path,from,to) {
  path='src/render/'+path;
  if(!source[path].includes(from))throw new Error(`Missing replacement in ${path}: ${from.slice(0,90)}`);
  source[path]=source[path].replace(from,to);
}
edit('rt/textures.ts','  giHits: [Img, Img] | null = null;','  giHits: [Img, Img] | null = null;\n  giVisibility: [Img, Img] | null = null;');
edit('rt/textures.ts','  private history(name: string): History {',`  ensureGiVisibility(): [Img, Img] {
    return (this.giVisibility ??= [this.make('rt gi visibility 0', 'r32float'), this.make('rt gi visibility 1', 'r32float')]);
  }

  private history(name: string): History {`);
edit('rt/layouts.ts','  giShade: GPUBindGroupLayout | null;','  giShade: GPUBindGroupLayout | null;\n  giVisibility: GPUBindGroupLayout | null;');
edit('rt/layouts.ts','  const split = device.limits.maxSampledTexturesPerShaderStage >= 17;',`  const split = device.limits.maxSampledTexturesPerShaderStage >= 17;
  const visibility = device.limits.maxSampledTexturesPerShaderStage >= 19;`);
edit('rt/layouts.ts',"    giShade: split ? layout('gi shade', [...traceEntries('rgba16float'), tex2d(12), tex2d(13)]) : null,",`    giVisibility: visibility ? layout('gi visibility', [...traceEntries('r32float'), tex2d(12), tex2d(13)]) : null,
    giShade: split ? layout('gi shade', [...traceEntries('rgba16float'), tex2d(12), tex2d(13), ...(visibility ? [tex2d(14), tex2d(15)] : [])]) : null,`);
edit('rt/pipelines.ts','  giShade: GPUComputePipeline | null;','  giShade: GPUComputePipeline | null;\n  giVisibility: GPUComputePipeline | null;');
edit('rt/pipelines.ts','giHits, giShade, ...rest]','giHits, giShade, giVisibility, ...rest]');
edit('rt/pipelines.ts',"    L.giShade ? make('gi shade', 'gi', { GRP: 2, SHADE_ONLY: true }, worldLayout(L.giShade)) : Promise.resolve(null),",`    L.giShade ? make('gi shade', 'gi', { GRP: 2, SHADE_ONLY: true, GI_RECORDED: true, SHADE_VISIBILITY: !!L.giVisibility }, worldLayout(L.giShade)) : Promise.resolve(null),
    L.giVisibility ? make('gi visibility', 'gi', { GRP: 2, GI_RECORDED: true, VISIBILITY_ONLY: true }, worldLayout(L.giVisibility)) : Promise.resolve(null),`);
edit('rt/pipelines.ts','    aux, latch, probe, probePlan, probeCompact, giHits, giShade,','    aux, latch, probe, probePlan, probeCompact, giHits, giShade, giVisibility,');
edit('rt/groups.ts','  giShade: Pair | null;','  giShade: Pair | null;\n  giVisibility: Pair | null;');
edit('rt/groups.ts','...(shade ? [view(12, hits[0].view), view(13, hits[1].view)] : []),',`...(shade ? [view(12, hits[0].view), view(13, hits[1].view),
        ...(tex.giVisibility ? [view(14, tex.giVisibility[0].view), view(15, tex.giVisibility[1].view)] : [])] : []),`);
edit('rt/groups.ts','  const groups: RtGroups = { aux, probe, probePlan, probeCompact, latch, giHits, giShade, trace: {}, temporal: {}, atrous: {} };',`  const giVisibility = tex.giVisibility ? both(p => {
    const lit = probes.sets[p ^ 1], hits = tex.giHits!, visibility = tex.giVisibility!;
    return d.createBindGroup({ label: 'rt gi visibility '+p, layout: L.giVisibility!, entries: [
      buf(0, s.params), buf(1, buffers.nodes), buf(2, buffers.prims), view(3, lit.r.view), view(4, lit.g.view), view(5, lit.b.view),
      view(6, tex.auxDepth[p].view), view(7, tex.auxNormal[p].view), view(8, visibility[0].view), view(9, visibility[1].view),
      { binding: 10, resource: s.probeSampler }, view(11, s.cloud), view(12, hits[0].view), view(13, hits[1].view),
    ] });
  }) : null;
  const groups: RtGroups = { aux, probe, probePlan, probeCompact, latch, giHits, giShade, giVisibility, trace: {}, temporal: {}, atrous: {} };`);
edit('rt/index.ts','    const limits = this.probeLimits(rc.quality);',`    if (rc.quality.giRays === 2 && this.pipes.giVisibility && !tex.giVisibility) { tex.ensureGiVisibility(); this.groups = null; }
    const limits = this.probeLimits(rc.quality);`);
const shadeDispatch=source['src/render/rt/index.ts'].match(/^      this\.traced\(this\.pipes\.giShade,.*$/m)?.[0];
if(!shadeDispatch)throw new Error('GI shade dispatch not found');
edit('rt/index.ts',shadeDispatch,`      if (this.pipes.giVisibility && groups.giVisibility) {
        this.traced(this.pipes.giVisibility, groups.giVisibility[par], Math.ceil(this.rc.gbuf.rtWidth / VIS_X), Math.ceil(this.rc.gbuf.rtHeight / VIS_Y), 1);
      }
`+shadeDispatch);
const io=source['src/render/shaders/rt/rt_trace_io.wgsl'];
const ioStart=io.indexOf('#ifdef TRACE_ONLY'),ioEnd=io.indexOf('#endif',ioStart)+6;
if(ioStart<0||ioEnd<6)throw new Error('Output format branch missing');
edit('shaders/rt/rt_trace_io.wgsl',io.slice(ioStart,ioEnd),`#ifdef VISIBILITY_ONLY
@group(\${GRP}) @binding(8) var out0 : texture_storage_2d<r32float, write>;
@group(\${GRP}) @binding(9) var out1 : texture_storage_2d<r32float, write>;
#else
${io.slice(ioStart,ioEnd)}
#endif`);
const gi=source['src/render/shaders/rt/gi.wgsl'];
const recStart=gi.indexOf('#ifdef SHADE_ONLY\n@group'),recEnd=gi.indexOf('#endif',recStart)+6;
if(recStart<0||recEnd<6)throw new Error('Recorded hit block missing');
const recorded=gi.slice(recStart,recEnd).replace('#ifdef SHADE_ONLY','#ifdef GI_RECORDED');
const declarations=`${recorded}
#ifdef SHADE_VISIBILITY
@group(\${GRP}) @binding(14) var giVisibility0 : texture_2d<f32>;
@group(\${GRP}) @binding(15) var giVisibility1 : texture_2d<f32>;
fn recordedGiVisibility(px : vec2i, ray : u32) -> f32 {
  if (ray == 0u) { return textureLoad(giVisibility0, px, 0).x; }
  return textureLoad(giVisibility1, px, 0).x;
}
#endif
`;
const visibility=`#include "rt/rt_trace_io.wgsl"
${declarations}
#ifdef VISIBILITY_ONLY
@compute @workgroup_size(VIS_X, VIS_Y, 2)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  var vis = 1.0;
  if (pix.ok && rp.dbg.x != 5u) {
    let h = recordedGiHit(px, gid.z);
    if (h.kind != KIND_MISS) {
      let d = basisFromNormal(pix.n) * cosineHemisphere(noise2(px, 1u + gid.z));
      let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
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
  }
  if (gid.z == 0u) { textureStore(out0, px, vec4f(vis)); }
  else { textureStore(out1, px, vec4f(vis)); }
}
#else
`;
source['src/render/shaders/rt/gi.wgsl']=visibility+gi.replace(gi.slice(recStart,recEnd),'')+'\n#endif\n';
edit('shaders/rt/gi.wgsl','  let px = vec2i(gid.xy);\n  let inside = inRt(gid.xy);',`  let px = vec2i(gid.xy);
  let inside = inRt(gid.xy);
#ifdef SHADE_VISIBILITY
  if (inside) { giVisibilityValue = recordedGiVisibility(px, gid.z); }
#endif`);
edit('shaders/rt/rt_scene.wgsl','fn shadeSurface(s : Surface,',`#ifdef SHADE_VISIBILITY
var<private> giVisibilityValue : f32 = 1.0;
#endif
fn shadeSurface(s : Surface,`);
edit('shaders/rt/rt_scene.wgsl','    if (t < NEAR_SHADOW_RANGE) {',`#ifdef SHADE_VISIBILITY
    vis = giVisibilityValue;
#else
    if (t < NEAR_SHADOW_RANGE) {`);
edit('shaders/rt/rt_scene.wgsl','    vis *= cloudTransmittance(p);','    vis *= cloudTransmittance(p);\n#endif');
const variants=[['E80',8,2],['E81',4,4],['E82',8,4],['E83',16,2]].map(([id,x,y])=>({id,label:`Separate GI visibility ${x}x${y}x2`,
  hypothesis:'Move unchanged secondary GI shadow traversal into its own kernel to lower register pressure in shading, preserving f32 visibility in two native-size R32 textures; retain two-stage fallback on adapters with fewer than 19 sampled textures',
  files:Object.fromEntries(Object.entries(source).map(([p,s])=>[p,s.replaceAll('VIS_X',String(x)).replaceAll('VIS_Y',String(y))]))}));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-tree-kernels-winner.json'));
await explore('overnight-gi-visibility',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
