// Stack traversal of the packed BVH (see src/render/rt/bvh.ts for the layout). Two roots share one stack: the static tree
// (params.scene.x) and the small per-frame dynamic tree (params.scene.y). Children are box-tested when their parent is visited and
// pushed far-first, each with its entry distance so a popped node is skipped once a closer hit is known.
#include "rt/rt_prims.wgsl"

const STACK_SIZE : u32 = 32u;

struct BvhHit { t : f32, prim : u32 }

// Entry distance of the ray into node n's box, or NO_HIT.
fn nodeEntry(n : u32, o : vec3f, inv : vec3f, tMax : f32) -> f32 {
  let lo = bitcast<vec3f>(bvhNodes[n * 2u].xyz);
  let hi = bitcast<vec3f>(bvhNodes[n * 2u + 1u].xyz);
  let a = (lo - o) * inv;
  let b = (hi - o) * inv;
  let t0 = max(max(min(a.x, b.x), min(a.y, b.y)), max(min(a.z, b.z), 0.0));
  let t1 = min(min(max(a.x, b.x), max(a.y, b.y)), min(max(a.z, b.z), tMax));
  return select(NO_HIT, t0, t0 <= t1);
}

// Nearest hit along o + t*d (unit d) within tMax; `anyHit` returns at the first primitive hit. Visits at most `cap` nodes.
fn traceBvh(o : vec3f, d : vec3f, tMax : f32, cap : u32, anyHit : bool) -> BvhHit {
  var best = BvhHit(tMax, NO_NODE);
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>;
  var stackT : array<f32, 32>;
  var sp = 0u;
  if (rp.scene.y != NO_NODE) { stack[sp] = rp.scene.y; stackT[sp] = 0.0; sp++; }
  if (rp.scene.x != NO_NODE) { stack[sp] = rp.scene.x; stackT[sp] = 0.0; sp++; }
  var visits = 0u;
  while (sp > 0u && visits < cap) {
    sp--;
    if (stackT[sp] > best.t) { continue; }
    visits++;
    let n = stack[sp];
    let n0 = bvhNodes[n * 2u];
    let count = bvhNodes[n * 2u + 1u].w;
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        let t = intersectPrim(n0.w + k, o, d, best.t);
        if (t < best.t) {
          best = BvhHit(t, n0.w + k);
          if (anyHit) { return best; }
        }
      }
      continue;
    }
    let tl = nodeEntry(n0.w, o, inv, best.t);
    let tr = nodeEntry(n0.w + 1u, o, inv, best.t);
    if (sp + 2u > STACK_SIZE) { continue; }
    let leftFirst = tl <= tr;
    let nearT = select(tr, tl, leftFirst);
    let farT = select(tl, tr, leftFirst);
    if (farT < NO_HIT) {
      stack[sp] = select(n0.w, n0.w + 1u, leftFirst);
      stackT[sp] = farT;
      sp++;
    }
    if (nearT < NO_HIT) {
      stack[sp] = select(n0.w + 1u, n0.w, leftFirst);
      stackT[sp] = nearT;
      sp++;
    }
  }
  return best;
}
