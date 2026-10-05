// Analytic heightfield tracer over terrainHeight + the max mip pyramid (Tevs et al., "Maximum Mipmaps for Fast, Accurate, and
// Scalable Dynamic Height Field Rendering"), a hierarchical 2D DDA that ascends over empty nodes and descends toward potential hits.
// At the finest level the exact crossing of the ray with the triangulated cells is solved (piecewise-linear gap, closed-form root),
// which replaces bisection and matches TerrainSampler.raycast in src/world/terrain/sampler.ts. Assumes N is a power of two.
// Semantics: the terrain is a solid slab under its footprint (a ray that starts under the surface hits at the start).
#include "common/world_bindings.wgsl"

const TERRAIN_START_LEVEL : u32 = 2u;
const NODE_EPS : f32 = 1e-3;

// Bound on the height of every cell inside node c at `lvl` (cells [c*2^lvl, (c+1)*2^lvl]): the 2x2 mip texels cover the closed span.
fn nodeMax(c : vec2i, lvl : u32) -> f32 {
  let hi = vec2i((i32(frame.terrain.x) >> lvl) - 1);
  return textureLoad(terrainMaxPyr, min(c, hi), i32(lvl)).x;
}

// One planar piece of the cell surface: first s in [s0, s1] where the ray (local cell coords l + dg*s, height y + dy*s) is under it.
fn piecewiseHit(h00 : f32, h10 : f32, h01 : f32, h11 : f32, l : vec2f, dg : vec2f, y : f32, dy : f32, s0 : f32, s1 : f32) -> f32 {
  let mid = 0.5 * (s0 + s1);
  let m = l + dg * mid;
  let upper = m.x >= m.y;
  let cx = select(h11 - h01, h10 - h00, upper);
  let cz = select(h01 - h00, h11 - h10, upper);
  let c0 = y - h00 - cx * l.x - cz * l.y;
  let slope = dy - cx * dg.x - cz * dg.y;
  let g0 = c0 + slope * s0;
  let g1 = c0 + slope * s1;
  if (g0 <= 0.0) { return s0; }
  if (g1 < 0.0) { return s0 + (s1 - s0) * g0 / (g0 - g1); }
  return -1.0;
}

// l = ray position in cell-local coordinates at s = 0, segment [0, len]. Returns the hit s or -1.
fn cellCrossing(c : vec2i, l : vec2f, dg : vec2f, y : f32, dy : f32, len : f32) -> f32 {
  let h00 = terrainLoad(c);
  let h10 = terrainLoad(c + vec2i(1, 0));
  let h01 = terrainLoad(c + vec2i(0, 1));
  let h11 = terrainLoad(c + vec2i(1, 1));
  let dd = dg.x - dg.y;
  var tm = len;
  if (abs(dd) > 1e-12) {
    let tk = (l.y - l.x) / dd;
    if (tk > 0.0 && tk < len) { tm = tk; }
  }
  let first = piecewiseHit(h00, h10, h01, h11, l, dg, y, dy, 0.0, tm);
  if (first >= 0.0 || tm >= len) { return first; }
  return piecewiseHit(h00, h10, h01, h11, l, dg, y, dy, tm, len);
}

// Distance t (0 <= t <= tMax) along o + t*d (unit d) to the first terrain hit, or -1. `steps` bounds the node visits.
fn traceTerrain(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> f32 {
  let n = i32(frame.terrain.x);
  let last = frame.terrain.x - 1.0;
  let inv = 1.0 / frame.terrain.y;
  let go = (o.xz - frame.terrainOrigin.xy) * inv;
  let dg = d.xz * inv;
  var tEnter = 0.0;
  var tExit = tMax;
  if (abs(dg.x) > 1e-9) {
    let a = -go.x / dg.x;
    let b = (last - go.x) / dg.x;
    tEnter = max(tEnter, min(a, b));
    tExit = min(tExit, max(a, b));
  } else if (go.x < 0.0 || go.x > last) { return -1.0; }
  if (abs(dg.y) > 1e-9) {
    let a = -go.y / dg.y;
    let b = (last - go.y) / dg.y;
    tEnter = max(tEnter, min(a, b));
    tExit = min(tExit, max(a, b));
  } else if (go.y < 0.0 || go.y > last) { return -1.0; }
  let top = frame.terrain.w;
  if (o.y > top) {
    if (d.y >= 0.0) { return -1.0; }
    tEnter = max(tEnter, (top - o.y) / d.y);
  }
  if (d.y > 0.0) {
    tExit = min(tExit, (top - o.y) / d.y);
  } else if (d.y < 0.0) {
    let tFloor = (frame.terrain.z - 1e-4 - o.y) / d.y;
    if (tFloor > tEnter) { tExit = min(tExit, tFloor); }
  }
  if (!(tEnter <= tExit)) { return -1.0; }

  let maxLevel = firstLeadingBit(u32(n));
  let fwd = dg >= vec2f(0.0);
  let sgn = select(vec2f(-1.0), vec2f(1.0), fwd);
  let valid = abs(dg) > vec2f(1e-9);
  let safeDg = select(vec2f(1.0), dg, valid);
  var t = tEnter;
  var lvl = min(TERRAIN_START_LEVEL, maxLevel);
  for (var it = 0u; it < steps; it++) {
    if (t >= tExit) { return -1.0; }
    let g = go + dg * t;
    let size = f32(1u << lvl);
    let cellMax = select(vec2i((n >> lvl) - 1), vec2i(n - 2), lvl == 0u);
    let c = clamp(vec2i(floor((g + sgn * NODE_EPS) / size)), vec2i(0), cellMax);
    let bnd = (vec2f(c) + select(vec2f(0.0), vec2f(1.0), fwd)) * size;
    let tAxis = select(vec2f(1e30), (bnd - go) / safeDg, valid);
    let tNode = max(min(min(tAxis.x, tAxis.y), tExit), t);
    let yA = o.y + d.y * t;
    let yB = o.y + d.y * tNode;
    if (min(yA, yB) > nodeMax(c, lvl)) {
      t = tNode;
      lvl = min(lvl + 1u, maxLevel);
      continue;
    }
    if (lvl > 0u) {
      lvl -= 1u;
      continue;
    }
    let s = cellCrossing(c, g - vec2f(c), dg, yA, d.y, tNode - t);
    if (s >= 0.0) { return t + s; }
    t = tNode;
  }
  return -1.0;
}
