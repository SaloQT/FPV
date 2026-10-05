import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const bPath='src/render/rt/bvh.ts',sPath='src/render/shaders/rt/rt_bvh.wgsl',rPath='src/render/rt/cpuReference.ts';
const [b,s,r]=await Promise.all([bPath,sPath,rPath].map(read));
if(!b.includes('const LEAF_SIZE = 2;'))throw new Error('Parent packing requires the two-primitive builder');
const builder=b.replace('private split(lo: number, hi: number, node: number, depth: number): void {',
  'private split(lo: number, hi: number, node: number, depth: number, parent = NO_ROOT): void {')
  .replace('nodesU[w + 7] = hi - lo;','nodesU[w + 7] = ((parent === NO_ROOT ? 0 : parent + 1) << 2) | (hi - lo);')
  .replace('nodesU[w + 7] = 0;','nodesU[w + 7] = (parent === NO_ROOT ? 0 : parent + 1) << 2;')
  .replace('this.split(lo, mid, child, depth + 1);','this.split(lo, mid, child, depth + 1, node);')
  .replace('this.split(mid, hi, child + 1, depth + 1);','this.split(mid, hi, child + 1, depth + 1, node);');
const reference=r.replace('const count = nodesU[w + 7];','const count = nodesU[w + 7] & 3;');
const masked=s.replaceAll('let count = bvhNodes[n * 2u + 1u].w;','let count = bvhNodes[n * 2u + 1u].w & 3u;');
const nearest=`fn traceBvh(o : vec3f, d : vec3f, tMax : f32, cap : u32) -> BvhHit {
  var best = BvhHit(tMax, NO_NODE);
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var node = rp.scene.x;
  var previous = NO_NODE;
  var dynamicPending = true;
  var visits = 0u;
  // Parent links replace scratch stack storage. With leaves <=2 and MAX_PRIMS
  // <=2^17, radix<=14 bounds internal depth at 29: the former 32-slot stack
  // could not overflow even with the pending dynamic root.
  while (visits < cap) {
    if (node == NO_NODE) {
      if (!dynamicPending) { break; }
      dynamicPending = false;
      node = rp.scene.y;
      previous = NO_NODE;
      if (node == NO_NODE) { break; }
    }
    let n0 = bvhNodes[node * 2u];
    let info = bvhNodes[node * 2u + 1u].w;
    let count = info & 3u;
    let parent = (info >> 2u) - 1u;
    let entering = previous == parent;
    if (entering) { visits++; }
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        let t = intersectPrim(n0.w + k, o, d, best.t);
        if (t < best.t) { best = BvhHit(t, n0.w + k); }
      }
    } else {
      // Fixed tMax recovers the same geometric near/far order on ascent.
      // The current best distance still prunes every newly selected child.
      let tl = nodeEntry(n0.w, o, inv, tMax);
      let tr = nodeEntry(n0.w + 1u, o, inv, tMax);
      let leftFirst = tl <= tr;
      let near = select(n0.w + 1u, n0.w, leftFirst);
      let far = select(n0.w, n0.w + 1u, leftFirst);
      var next = NO_NODE;
      if (entering && select(tr, tl, leftFirst) < NO_HIT && select(tr, tl, leftFirst) <= best.t) { next = near; }
      else if (!entering && previous == near && select(tl, tr, leftFirst) < NO_HIT && select(tl, tr, leftFirst) <= best.t) { next = far; }
      if (next != NO_NODE) { previous = node; node = next; continue; }
    }
    previous = node;
    node = parent;
  }
  return best;
}
`;
const chord=s.includes('canopyOpticalDepthJitter(i, o, d, tMax, rayJitter)') ? 'canopyOpticalDepthJitter(i, o, d, tMax, rayJitter)' : 'canopyOpticalDepth(i, o, d, tMax)';
const transmission=`fn traceBvhTransmit(o : vec3f, d : vec3f, tMax : f32, cap : u32) -> f32 {
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  ${chord.includes('Jitter')?'let rayJitter = canopyJitter(o, d);':''}
  var node = rp.scene.x;
  var previous = NO_NODE;
  var dynamicPending = true;
  var visits = 0u;
  var tau = 0.0;
  while (visits < cap) {
    if (node == NO_NODE) {
      if (!dynamicPending) { break; }
      dynamicPending = false;
      node = rp.scene.y;
      previous = NO_NODE;
      if (node == NO_NODE) { break; }
    }
    let n0 = bvhNodes[node * 2u];
    let info = bvhNodes[node * 2u + 1u].w;
    let count = info & 3u;
    let parent = (info >> 2u) - 1u;
    let entering = previous == parent;
    if (entering) { visits++; }
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        let i = n0.w + k;
        if (primIsCanopy(i)) { tau += ${chord}; }
        else if (intersectPrim(i, o, d, tMax) <= tMax) { return 0.0; }
      }
      if (tau > CANOPY_OPAQUE_TAU) { return 0.0; }
    } else {
      let tl = nodeEntry(n0.w, o, inv, tMax);
      let tr = nodeEntry(n0.w + 1u, o, inv, tMax);
      let leftFirst = tl <= tr;
      let near = select(n0.w + 1u, n0.w, leftFirst);
      let far = select(n0.w, n0.w + 1u, leftFirst);
      var next = NO_NODE;
      if (entering && select(tr, tl, leftFirst) < NO_HIT) { next = near; }
      else if (!entering && previous == near && select(tl, tr, leftFirst) < NO_HIT) { next = far; }
      if (next != NO_NODE) { previous = node; node = next; continue; }
    }
    previous = node;
    node = parent;
  }
  return exp(-tau);
}
`;
const split=masked.indexOf('fn traceBvhTransmit('),start=masked.indexOf('fn traceBvh(');
const comment=masked.lastIndexOf('// Fraction of the light',split);
if(start<0||split<0||comment<start)throw new Error('Traversal function bounds missing');
const closestOnly=masked.slice(0,start)+nearest+masked.slice(comment);
const transmitOnly=masked.slice(0,split)+transmission;
const both=masked.slice(0,start)+nearest+'\n'+transmission;
const variants=[['E87','closest',closestOnly],['E88','transmission',transmitOnly],['E89','both',both]].map(([id,which,shader])=>({id,label:`Parent-linked BVH ${which}`,hypothesis:'Replace variable-index private stack storage with packed parent links and scalar traversal state; preserve geometric near-first order, primitive order and node visit caps. Trade extra ancestor reads for lower per-thread scratch pressure',files:{[bPath]:builder,[sPath]:shader,[rPath]:reference}}));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-terrain-material-winner.json'));
await explore('overnight-parent-traversal',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
