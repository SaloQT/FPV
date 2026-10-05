import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const GRP = '${GRP}'; // Preserve the shader preprocessor placeholder in generated templates.
const paths = ['src/render/rt/textures.ts','src/render/rt/layouts.ts','src/render/rt/groups.ts','src/render/rt/pipelines.ts','src/render/rt/index.ts','src/render/shaders/rt/gi.wgsl','src/render/shaders/rt/rt_trace_io.wgsl'];
const [tx,la,gr,pi,ix,gi,io] = await Promise.all(paths.map(read));
const winner = JSON.parse(await read('.bench/research-20261005/overnight-leaves-winner.json'));
const tex = tx.replace('r32float: 4, rgba16float: 8', 'r32float: 4, rg32float: 8, rgba16float: 8')
  .replace('  spec: History | null = null;', '  spec: History | null = null;\n  giHits: [Img, Img] | null = null;')
  .replace('  private history(name: string)', `  ensureGiHits(): [Img, Img] {
    return (this.giHits ??= [this.make('rt gi hit 0', 'rg32float'), this.make('rt gi hit 1', 'rg32float')]);
  }

  private history(name: string)`);
let layout = la.replace('  trace: GPUBindGroupLayout;', '  trace: GPUBindGroupLayout;\n  giHits: GPUBindGroupLayout | null;\n  giShade: GPUBindGroupLayout | null;');
const start = layout.indexOf("    trace: layout('trace', ["), end = layout.indexOf('    ]),', start)+7;
if (start<0 || end<7) throw new Error('Trace layout template missing');
layout = layout.slice(0,start)+`    trace: layout('trace', traceEntries('rgba16float')),
    giHits: split ? layout('gi hits', traceEntries('rg32float')) : null,
    giShade: split ? layout('gi shade', [...traceEntries('rgba16float'), tex2d(12), tex2d(13)]) : null,`+layout.slice(end);
layout = layout.replace('  const probeEntries = [', `  // The ordinary path remains available on adapters with only 16 sampled textures.
  const split = device.limits.maxSampledTexturesPerShaderStage >= 17;
  const traceEntries = (format: GPUTextureFormat): GPUBindGroupLayoutEntry[] => [
    uniform(0), storageRo(1), storageRo(2), tex3d(3), tex3d(4), tex3d(5), tex2d(6), tex2d(7), store2d(8, format), store2d(9, format), probeSampler, cloudShadow,
  ];
  const probeEntries = [`);
const groups = gr.replace('  trace: Partial<Record<Signal, Pair>>;', '  trace: Partial<Record<Signal, Pair>>;\n  giHits: Pair | null;\n  giShade: Pair | null;')
  .replace('  const groups: RtGroups = { aux, probe, probePlan, probeCompact, latch, trace: {}, temporal: {}, atrous: {} };', `  const splitGroup = (p: number, shade: boolean) => {
    const lit = probes.sets[p ^ 1], hits = tex.giHits!;
    return d.createBindGroup({ label: 'rt gi '+(shade ? 'shade' : 'hits')+' '+p, layout: (shade ? L.giShade : L.giHits)!, entries: [
      buf(0, s.params), buf(1, buffers.nodes), buf(2, buffers.prims), view(3, lit.r.view), view(4, lit.g.view), view(5, lit.b.view),
      view(6, tex.auxDepth[p].view), view(7, tex.auxNormal[p].view),
      view(8, shade ? tex.raw0.view : hits[0].view), view(9, shade ? tex.raw1.view : hits[1].view),
      { binding: 10, resource: s.probeSampler }, view(11, s.cloud), ...(shade ? [view(12, hits[0].view), view(13, hits[1].view)] : []),
    ] });
  };
  const giHits = tex.giHits ? both(p => splitGroup(p, false)) : null;
  const giShade = tex.giHits ? both(p => splitGroup(p, true)) : null;
  const groups: RtGroups = { aux, probe, probePlan, probeCompact, latch, giHits, giShade, trace: {}, temporal: {}, atrous: {} };`);
let pipes = pi.replace('  trace: Record<Signal, GPUComputePipeline>;', '  trace: Record<Signal, GPUComputePipeline>;\n  giHits: GPUComputePipeline | null;\n  giShade: GPUComputePipeline | null;')
  .replace('const [aux, latch, probe, probePlan, probeCompact, ...rest]', 'const [aux, latch, probe, probePlan, probeCompact, giHits, giShade, ...rest]')
  .replace('    ...trace, ...temporal, ...atrous.flat(),', `    L.giHits ? make('gi hits', 'gi', { GRP: 2, TRACE_ONLY: true }, worldLayout(L.giHits)) : Promise.resolve(null),
    L.giShade ? make('gi shade', 'gi', { GRP: 2, SHADE_ONLY: true }, worldLayout(L.giShade)) : Promise.resolve(null),
    ...trace, ...temporal, ...atrous.flat(),`)
  .replace('    aux, latch, probe, probePlan, probeCompact,', '    aux, latch, probe, probePlan, probeCompact, giHits, giShade,');
const index = ix.replace('    const tex = this.tex!;', `    const tex = this.tex!;
    if (rc.quality.giRays === 2 && this.pipes.giHits && !tex.giHits) { tex.ensureGiHits(); this.groups = null; }`);
const ordinaryDispatch = index.match(/    this\.traced\(this\.pipes\.trace\[sig\][^\n]+/)[0];
const hitIO = io.replace('@group(${GRP}) @binding(8) var out0 : texture_storage_2d<rgba16float, write>;\n@group(${GRP}) @binding(9) var out1 : texture_storage_2d<rgba16float, write>;', `#ifdef TRACE_ONLY
@group(${GRP}) @binding(8) var out0 : texture_storage_2d<rg32float, write>;
@group(${GRP}) @binding(9) var out1 : texture_storage_2d<rg32float, write>;
#else
@group(${GRP}) @binding(8) var out0 : texture_storage_2d<rgba16float, write>;
@group(${GRP}) @binding(9) var out1 : texture_storage_2d<rgba16float, write>;
#endif`);
const shadeHelpers = `#ifdef SHADE_ONLY
@group(${GRP}) @binding(12) var giHit0 : texture_2d<f32>;
@group(${GRP}) @binding(13) var giHit1 : texture_2d<f32>;
fn recordedGiHit(px : vec2i, ray : u32) -> SceneHit {
  var record : vec2f;
  if (ray == 0u) { record = textureLoad(giHit0, px, 0).xy; }
  else { record = textureLoad(giHit1, px, 0).xy; }
  if (record.y < 0.0) { return SceneHit(record.x, KIND_TERRAIN, 0u); }
  if (record.y > 0.0) { return SceneHit(record.x, KIND_PRIM, u32(record.y) - 1u); }
  return SceneHit(record.x, KIND_MISS, 0u);
}
#endif
`;
const shade = gi.replace('    let h = traceScene(origin, d, rp.f.w, steps);', `#ifdef SHADE_ONLY
    let h = recordedGiHit(px, r);
#else
    let h = traceScene(origin, d, rp.f.w, steps);
#endif`);
const variants = [[8,4],[8,8],[16,4],[4,8]].map(([x,y],i) => {
  const trace = `#include "rt/rt_trace_io.wgsl"
#ifdef TRACE_ONLY
fn encodeGiHit(h : SceneHit) -> vec4f {
  var code = 0.0;
  if (h.kind == KIND_TERRAIN) { code = -1.0; }
  else if (h.kind == KIND_PRIM) { code = f32(h.prim + 1u); }
  return vec4f(h.t, code, 0.0, 0.0);
}
@compute @workgroup_size(${x}, ${y})
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  if (!pix.ok || rp.dbg.x == 5u) {
    textureStore(out0, px, vec4f(0.0)); textureStore(out1, px, vec4f(0.0)); return;
  }
  let basis = basisFromNormal(pix.n);
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let d0 = basis * cosineHemisphere(noise2(px, 1u));
  let h0 = traceScene(origin, d0, rp.f.w, rp.cfg.y);
  textureStore(out0, px, encodeGiHit(h0));
  let d1 = basis * cosineHemisphere(noise2(px, 2u));
  let h1 = traceScene(origin, d1, rp.f.w, rp.cfg.y);
  textureStore(out1, px, encodeGiHit(h1));
}
#else
${shadeHelpers}
${shade}
#endif
`;
  const dispatch = index.replace(ordinaryDispatch, `    if (sig === 'gi' && this.rc.quality.giRays === 2 && this.pipes.giHits && this.pipes.giShade && groups.giHits && groups.giShade) {
      this.traced(this.pipes.giHits, groups.giHits[par], Math.ceil(this.rc.gbuf.rtWidth / ${x}), Math.ceil(this.rc.gbuf.rtHeight / ${y}), 1);
      this.traced(this.pipes.giShade, groups.giShade[par], Math.ceil(this.rc.gbuf.rtWidth / 8), Math.ceil(this.rc.gbuf.rtHeight / 2), 1);
    } else {
${ordinaryDispatch}
    }`);
  return {id:`E${i+41}`,label:`Split GI trace ${x}x${y}`,hypothesis:'Separate unchanged GI scene intersections from unchanged hit shading to reduce live registers per kernel; retain exact f32 hit distances and primitive identities in two RG32F textures; all work remains inside original timing boundaries',
    files:Object.fromEntries(paths.map((p,j)=>[p,[tex,layout,groups,pipes,dispatch,trace,hitIO][j]]))};
});
await explore('overnight-gi-split',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
