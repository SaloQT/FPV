import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const bPath='src/render/rt/bvh.ts',sPath='src/render/shaders/rt/rt_bvh.wgsl',cPath='src/render/shaders/rt/rt_canopy.wgsl';
const [b,s,c]=await Promise.all([bPath,sPath,cPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-terrain-bounds-winner.json'));
const variants=[0,4,8,10,12].map((depth,k)=>({id:`E${73+k}`,label:`BVH radix depth ${depth}`,hypothesis:'Balance the same Morton-ordered primitives earlier with median splits to reduce traversal divergence; preserve primitive identities, geometry and the safe depth bound',files:{[bPath]:b.replace('const RADIX_LEVELS = 14;',`const RADIX_LEVELS = ${depth};`)}}));
const nearest=`      for (var k = 0u; k < count; k++) {
        let t = intersectPrim(n0.w + k, o, d, best.t);
        if (t < best.t) {
          best = BvhHit(t, n0.w + k);
        }
      }`;
if(!s.includes(nearest)||!b.includes('const LEAF_SIZE = 2;'))throw new Error('Two-primitive closest loop not found');
variants.push({id:'E78',label:'Unroll two-primitive closest leaves',hypothesis:'Specialize closest-hit leaf processing for the builder\'s maximum two primitives, removing the dynamic loop while preserving intersection order and nearest-hit updates',files:{[sPath]:s.replace(nearest,`      let t0 = intersectPrim(n0.w, o, d, best.t);
      if (t0 < best.t) { best = BvhHit(t0, n0.w); }
      if (count > 1u) {
        let t1 = intersectPrim(n0.w + 1u, o, d, best.t);
        if (t1 < best.t) { best = BvhHit(t1, n0.w + 1u); }
      }`)}});
const canopy=c.replace('fn canopyOpticalDepth(i : u32, o : vec3f, d : vec3f, tMax : f32)',
  'fn canopyOpticalDepthJitter(i : u32, o : vec3f, d : vec3f, tMax : f32, jitter : f32)')
  .replace('  let jitter = canopyJitter(o, d);\n','')+`
fn canopyOpticalDepth(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  return canopyOpticalDepthJitter(i, o, d, tMax, canopyJitter(o, d));
}
`;
variants.push({id:'E79',label:'Hoist per-ray canopy jitter',hypothesis:'Compute the identical canopy jitter hash once per transmission ray instead of once per intersected crown; keep chord quadrature and sample positions unchanged',files:{[cPath]:canopy,[sPath]:s.replace('  var tau = 0.0;','  let rayJitter = canopyJitter(o, d);\n  var tau = 0.0;').replace('tau += canopyOpticalDepth(i, o, d, tMax);','tau += canopyOpticalDepthJitter(i, o, d, tMax, rayJitter);')}});
await explore('overnight-tree-kernels',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
