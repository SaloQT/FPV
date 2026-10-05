import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const bPath='src/render/shaders/rt/rt_bvh.wgsl',pPath='src/render/shaders/rt/rt_prims.wgsl',cPath='src/render/shaders/rt/rt_canopy.wgsl',packPath='src/render/rt/prims.ts';
const [b,p,c,pack]=await Promise.all([bPath,pPath,cPath,packPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-shading-winner.json'));
const variants=[],add=(id,label,hypothesis,files)=>variants.push({id,label,hypothesis,files});
let fma=b.replace('fn nodeEntry(n : u32, o : vec3f, inv : vec3f, tMax : f32)', 'fn nodeEntry(n : u32, scaledOrigin : vec3f, inv : vec3f, tMax : f32)')
  .replace('let a = (lo - o) * inv;', 'let a = fma(lo, inv, scaledOrigin);').replace('let b = (hi - o) * inv;', 'let b = fma(hi, inv, scaledOrigin);')
  .replaceAll('let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));', 'let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));\n  let scaledOrigin = -o * inv;')
  .replaceAll(', o, inv, ', ', scaledOrigin, inv, ');
add('E54','Fused BVH slabs','Precompute scaled ray origin and use fused multiply-add for box slabs, reducing dependent arithmetic; check any floating-point changes against ORIGINAL',{[bPath]:fma});
add('E55','Sign-ordered BVH slabs','Use ray direction signs to select near/far box corners before slab arithmetic, preserving entry and exit values while simplifying min/max reduction',{
  [bPath]:b.replace('let a = (lo - o) * inv;\n  let b = (hi - o) * inv;', 'let negative = inv < vec3f(0.0);\n  let a = (select(lo, hi, negative) - o) * inv;\n  let b = (select(hi, lo, negative) - o) * inv;')
    .replace('max(max(min(a.x, b.x), min(a.y, b.y)), max(min(a.z, b.z), 0.0))', 'max(max(a.x, a.y), max(a.z, 0.0))')
    .replace('min(min(max(a.x, b.x), max(a.y, b.y)), min(max(a.z, b.z), tMax))', 'min(min(b.x, b.y), min(b.z, tMax))')});
add('E56','Pack canopy flag with kind','Duplicate the canopy flag beside primitive kind so transmission can reuse the intersection header instead of fetching the material word solely for its flag',{
  [packPath]:pack.replace('  u[o + 15] = isCanopyProxy(p) ? PRIM_FLAG_CANOPY : 0;', '  u[o + 15] = isCanopyProxy(p) ? PRIM_FLAG_CANOPY : 0;\n  u[o + 3] |= u[o + 15] << 8;'),
  [pPath]:p.replaceAll('switch (head.w)', 'switch (head.w & 255u)'),
  [cPath]:c.replace('(primWord(i, 3u).w & PRIM_FLAG_CANOPY)', '((primWord(i, 0u).w >> 8u) & PRIM_FLAG_CANOPY)')});
add('E57','Tight bound on far-node pop','Use the current closest distance while recomputing popped far-node entries; preserve the same distance pruning and visits',{
  [bPath]:b.replace('entry = nodeEntry(popped, o, inv, tMax);', 'entry = nodeEntry(popped, o, inv, best.t);')});
add('E58','Explicit stack index range','Expose the proven 0..31 stack-index range to shader bounds lowering using an equivalent low-bit mask; retain original overflow checks',{
  [bPath]:b.replaceAll('stack[sp]', 'stack[sp & 31u]')});
if ((b.match(/var stack : array<u32, 32>;/g)??[]).length!==2)throw new Error('Expected two node-only stacks');
add('E59','Reuse per-invocation stack','Reuse a private per-invocation scratch stack across non-nested closest-hit and transmission calls, avoiding repeated function-local zero initialization; every popped slot was written by that call',{
  [bPath]:b.replace('const STACK_SIZE : u32 = 32u;', 'const STACK_SIZE : u32 = 32u;\nvar<private> stack : array<u32, 32>;')
    .replaceAll('  var stack : array<u32, 32>;\n', '')});
await explore('overnight-bvh-math',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
