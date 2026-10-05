// Stack traversal of the packed BVH (see src/render/rt/bvh.ts for the layout). Two roots share one stack: the static tree
// (params.scene.x) and the small per-frame dynamic tree (params.scene.y). Children are box-tested when their parent is visited and
// pushed far-first, each with its entry distance so a popped node is skipped once a closer hit is known.
#include "rt/rt_prims.wgsl"
#include "rt/rt_canopy.wgsl"

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

// Node index and its entry distance share one 8-byte stack slot: the walk pops and pushes the pair together, so it moves one local word per
// step instead of two (a variable index forces the stack into per-thread local memory, where each lane's slot is a separate access).
struct BvhStackEntry { node : u32, entry : f32 }

// Nearest hit along o + t*d (unit d) within tMax. Visits at most `cap` nodes.
fn traceBvh(o : vec3f, d : vec3f, tMax : f32, cap : u32) -> BvhHit {
  var best = BvhHit(tMax, NO_NODE);
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>;
  var sp = 0u;
  if (rp.scene.y != NO_NODE) { stack[sp] = rp.scene.y; sp++; }
  if (rp.scene.x != NO_NODE) { stack[sp] = rp.scene.x; sp++; }
  var visits = 0u;
  var descend = false;
  var top : BvhStackEntry;
  while ((sp > 0u || descend) && visits < cap) {
    if (!descend) {
      sp--;
      let popped = stack[sp];
      var entry = 0.0;
      if (popped != rp.scene.x && popped != rp.scene.y) { entry = nodeEntry(popped, o, inv, tMax); }
      top = BvhStackEntry(popped, entry);
    }
    descend = false;
    if (top.entry > best.t) { continue; }
    visits++;
    let n = top.node;
    let n0 = bvhNodes[n * 2u];
    let count = bvhNodes[n * 2u + 1u].w;
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        let t = intersectPrim(n0.w + k, o, d, best.t);
        if (t < best.t) {
          best = BvhHit(t, n0.w + k);
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
      sp++;
    }
    if (nearT < NO_HIT) {
      // The near child is the very next pop. Carry it directly while the far
      // child stays on the stack; preserve the original overflow check above.
      top = BvhStackEntry(select(n0.w + 1u, n0.w, leftFirst), nearT);
      descend = true;
    }
  }
  return best;
}

// Fraction of the light that survives the proxies along o + t*d (unit d) within tMax: 0 as soon as an opaque primitive is hit, otherwise the
// Beer-Lambert product over every leaf-canopy crown crossed (their optical depths add). Visits at most `cap` nodes; the remainder counts as clear.
fn traceBvhTransmit(o : vec3f, d : vec3f, tMax : f32, cap : u32) -> f32 {
  let inv = 1.0 / select(d, vec3f(1e-8), abs(d) < vec3f(1e-8));
  var stack : array<u32, 32>;
  var sp = 0u;
  if (rp.scene.y != NO_NODE) { stack[sp] = rp.scene.y; sp++; }
  if (rp.scene.x != NO_NODE) { stack[sp] = rp.scene.x; sp++; }
  var tau = 0.0;
  var visits = 0u;
  var descend = false;
  var n = 0u;
  while ((sp > 0u || descend) && visits < cap) {
    if (!descend) {
      sp--;
      n = stack[sp];
    }
    descend = false;
    visits++;
    let n0 = bvhNodes[n * 2u];
    let count = bvhNodes[n * 2u + 1u].w;
    if (count > 0u) {
      for (var k = 0u; k < count; k++) {
        let i = n0.w + k;
        if (primIsCanopy(i)) {
          tau += canopyOpticalDepth(i, o, d, tMax);
        } else if (intersectPrim(i, o, d, tMax) <= tMax) {
          return 0.0;
        }
      }
      if (tau > CANOPY_OPAQUE_TAU) { return 0.0; }
      continue;
    }
    if (sp + 2u > STACK_SIZE) { continue; }
    let tl = nodeEntry(n0.w, o, inv, tMax);
    let tr = nodeEntry(n0.w + 1u, o, inv, tMax);
    let leftFirst = tl <= tr;
    if (select(tl, tr, leftFirst) < NO_HIT) {
      stack[sp] = select(n0.w, n0.w + 1u, leftFirst);
      sp++;
    }
    if (select(tr, tl, leftFirst) < NO_HIT) {
      n = select(n0.w + 1u, n0.w, leftFirst);
      descend = true;
    }
  }
  return exp(-tau);
}
