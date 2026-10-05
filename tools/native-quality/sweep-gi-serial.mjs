import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const gPath='src/render/shaders/rt/gi.wgsl',iPath='src/render/rt/index.ts';
const [g,i]=await Promise.all([gPath,iPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-packed-stacks-winner.json'));
const marker=g.indexOf('var<workgroup> rayResult'),start=g.indexOf('@compute',marker);
if(marker<0||start<0)throw new Error('Parallel shade entry missing');
let end=g.indexOf('{',start),depth=1;
for(end++;end<g.length&&depth;end++) { if(g[end]==='{')depth++;else if(g[end]==='}')depth--; }
if(depth)throw new Error('Unbalanced shade entry');
const serial=`@compute @workgroup_size(SHADE_X, SHADE_Y)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  if (!pix.ok) {
    textureStore(out0, px, vec4f(0.0));
    textureStore(out1, px, vec4f(0.0));
    return;
  }
  let e = envAt(pix.pos.y);
  let probeE = probeIrradiance(pix.pos + pix.n * 0.3, pix.n, e);
  textureStore(out1, px, fp16Safe(vec4f(probeE, 1.0)));
  if (rp.dbg.x == 5u) {
    textureStore(out0, px, fp16Safe(vec4f(probeE, 1.0)));
    return;
  }
  let basis = basisFromNormal(pix.n);
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let steps = rp.cfg.y;
  var sum = vec3f(0.0);
  var vis = 0.0;
  for (var r = 0u; r < 2u; r++) {
    let d = basis * cosineHemisphere(noise2(px, 1u + r));
    let h = recordedGiHit(px, r);
#ifdef SHADE_VISIBILITY
    giVisibilityValue = recordedGiVisibility(px, r);
#endif
    if (h.kind == KIND_MISS) {
      sum += skyRadiance(d, e);
      vis += 1.0;
    } else {
      var chord = 1.0;
      if (h.kind == KIND_PRIM && primIsCanopy(h.prim)) { chord = hitChordT(h, origin, d); }
      sum += hitRadianceChord(h, origin, d, e, steps, chord);
      if (h.t < CONTACT_RANGE) {
        vis += 1.0 - hitSolidity(h, chord) * (1.0 - saturate1(h.t / CONTACT_RANGE));
      } else { vis += 1.0; }
    }
  }
  textureStore(out0, px, fp16Safe(vec4f(sum * 0.5, vis * 0.5)));
}
`;
const dispatch=i.match(/^      this\.traced\(this\.pipes\.giShade,.*$/m)?.[0];
if(!dispatch)throw new Error('Shade dispatch missing');
const variants=[['E104',8,4],['E105',8,8],['E106',16,4],['E107',4,8],['E108',32,1]].map(([id,x,y])=>({id,label:`Serial recorded-hit shading ${x}x${y}`,
  hypothesis:'After separating hit tracing, shade both original rays in one invocation to reuse pixel/environment setup and remove the inter-ray workgroup reduction; preserve ray and sum order',files:{
    [gPath]:g.slice(0,start)+'#ifdef SHADE_ONLY\n'+serial.replaceAll('SHADE_X',String(x)).replaceAll('SHADE_Y',String(y))+'#else\n'+g.slice(start,end)+'\n#endif'+g.slice(end),
    [iPath]:i.replace(dispatch,`      this.traced(this.pipes.giShade, groups.giShade[par], Math.ceil(this.rc.gbuf.rtWidth / ${x}), Math.ceil(this.rc.gbuf.rtHeight / ${y}), 1);`),
  }}));
const traceStart=g.indexOf('#ifdef TRACE_ONLY'),groupStart=g.indexOf('@compute',traceStart);
const group=g.slice(groupStart).match(/^@compute @workgroup_size\(8, 4\)/)?.[0];
const traceDispatch=i.match(/^      this\.traced\(this\.pipes\.giHits,.*$/m)?.[0];
if(!group||!traceDispatch)throw new Error('Expected serial 8x4 hit tracing');
for(const [id,x,y] of [['E109',16,2],['E110',32,1],['E111',4,8],['E112',8,8]])variants.push({id,label:`Recorded-hit trace tile ${x}x${y}`,
  hypothesis:'Retune the serial hit-only trace tile on the selected traversal to improve memory locality and occupancy, preserving both full-precision hit records',files:{
    [gPath]:g.slice(0,groupStart)+g.slice(groupStart).replace(group,`@compute @workgroup_size(${x}, ${y})`),
    [iPath]:i.replace(traceDispatch,`      this.traced(this.pipes.giHits, groups.giHits[par], Math.ceil(this.rc.gbuf.rtWidth / ${x}), Math.ceil(this.rc.gbuf.rtHeight / ${y}), 1);`),
  }});
await explore('overnight-gi-serial',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
