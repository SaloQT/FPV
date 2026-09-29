// Ray vs analytic proxy primitives (packed by src/render/rt/prims.ts, 64-byte records read as 4 x vec4u). Keep in sync with
// src/render/rt/cpuReference.ts, which the dev page compares against. Only ENTRY hits count: a ray starting inside a primitive misses it.
#include "rt/rt_common.wgsl"

@group(${GRP}) @binding(1) var<storage, read> bvhNodes : array<vec4u>;
@group(${GRP}) @binding(2) var<storage, read> bvhPrims : array<vec4u>;

const NO_HIT : f32 = 1e30;
const T_EPS : f32 = 1e-4;
const TORUS_STEPS : u32 = 32u;
const KIND_OBB : u32 = 0u;
const KIND_CAPSULE : u32 = 1u;
const KIND_SPHERE : u32 = 2u;

fn qrot(q : vec4f, v : vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
fn qrotInv(q : vec4f, v : vec3f) -> vec3f { return qrot(vec4f(-q.xyz, q.w), v); }

fn primWord(i : u32, k : u32) -> vec4u { return bvhPrims[i * 4u + k]; }

fn hitSphere(c : vec3f, r : f32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let oc = o - c;
  let b = dot(oc, d);
  let q = oc - b * d;
  let h = r * r - dot(q, q);
  if (h < 0.0) { return NO_HIT; }
  let t = -b - sqrt(h);
  return select(NO_HIT, t, t > T_EPS && t <= tMax);
}

// Iñigo Quilez's capsule intersector.
fn hitCapsule(pa : vec3f, pb : vec3f, r : f32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let ba = pb - pa;
  let oa = o - pa;
  let baba = dot(ba, ba);
  let bard = dot(ba, d);
  let baoa = dot(ba, oa);
  let rdoa = dot(d, oa);
  let oaoa = dot(oa, oa);
  let qa = baba - bard * bard;
  if (baba < 1e-12 || qa < 1e-9 * baba) { return hitSphere(pa, r, o, d, tMax); }
  let qb = baba * rdoa - baoa * bard;
  let qc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = qb * qb - qa * qc;
  if (h < 0.0) { return NO_HIT; }
  let t = (-qb - sqrt(h)) / qa;
  let y = baoa + t * bard;
  if (y > 0.0 && y < baba) { return select(NO_HIT, t, t > T_EPS && t <= tMax); }
  let oc = select(o - pb, oa, y <= 0.0);
  let b2 = dot(d, oc);
  let q2 = oc - b2 * d;
  let h2 = r * r - dot(q2, q2);
  if (h2 <= 0.0) { return NO_HIT; }
  let t2 = -b2 - sqrt(h2);
  return select(NO_HIT, t2, t2 > T_EPS && t2 <= tMax);
}

fn hitObb(c : vec3f, half : vec3f, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let lo = qrotInv(q, o - c);
  let ld = qrotInv(q, d);
  let par = abs(ld) < vec3f(1e-12);
  if (any(par & (abs(lo) > half))) { return NO_HIT; }
  let inv = 1.0 / select(ld, vec3f(1.0), par);
  let a = (-half - lo) * inv;
  let b = (half - lo) * inv;
  let n0 = select(min(a, b), vec3f(-NO_HIT), par);
  let n1 = select(max(a, b), vec3f(NO_HIT), par);
  let t0 = max(max(n0.x, n0.y), n0.z);
  let t1 = min(min(n1.x, n1.y), n1.z);
  return select(NO_HIT, t0, t0 <= t1 && t0 > T_EPS && t0 <= tMax);
}

fn torusSdf(p : vec3f, major : f32, minor : f32) -> f32 {
  return length(vec2f(length(p.xz) - major, p.y)) - minor;
}

// Sphere tracing of the torus SDF from the bounding-sphere entry; the ring lies in the local XZ plane.
fn hitTorus(c : vec3f, major : f32, minor : f32, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let lo = qrotInv(q, o - c);
  let ld = qrotInv(q, d);
  let rad = major + minor;
  let b = dot(lo, ld);
  let qq = lo - b * ld;
  let h = rad * rad - dot(qq, qq);
  if (h < 0.0) { return NO_HIT; }
  let sh = sqrt(h);
  var t = max(-b - sh, T_EPS);
  let tEnd = min(-b + sh, tMax);
  if (torusSdf(lo + ld * t, major, minor) < 0.0) { return NO_HIT; }
  for (var i = 0u; i < TORUS_STEPS; i++) {
    let s = torusSdf(lo + ld * t, major, minor);
    if (s < 1e-4 + 1e-5 * t) { return t; }
    t += s;
    if (t > tEnd) { return NO_HIT; }
  }
  return NO_HIT;
}

fn intersectPrim(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let head = primWord(i, 0u);
  let a = bitcast<vec4f>(head);
  let b = bitcast<vec4f>(primWord(i, 1u));
  switch (head.w) {
    case KIND_SPHERE: { return hitSphere(a.xyz, b.w, o, d, tMax); }
    case KIND_CAPSULE: { return hitCapsule(a.xyz, b.xyz, b.w, o, d, tMax); }
    case KIND_OBB: { return hitObb(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }
    default: { return hitTorus(a.xyz, b.x, b.w, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }
  }
}

// Outward geometric normal at a point on the surface of primitive i.
fn primNormal(i : u32, p : vec3f) -> vec3f {
  let head = primWord(i, 0u);
  let a = bitcast<vec4f>(head).xyz;
  let b = bitcast<vec4f>(primWord(i, 1u));
  switch (head.w) {
    case KIND_SPHERE: { return normalize(p - a); }
    case KIND_CAPSULE: {
      let ba = b.xyz - a;
      let h = clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
      return normalize(p - (a + ba * h));
    }
    case KIND_OBB: {
      let q = bitcast<vec4f>(primWord(i, 2u));
      let lp = qrotInv(q, p - a) / b.xyz;
      let al = abs(lp);
      var n = vec3f(0.0);
      if (al.x >= al.y && al.x >= al.z) { n.x = select(-1.0, 1.0, lp.x >= 0.0); }
      else if (al.y >= al.z) { n.y = select(-1.0, 1.0, lp.y >= 0.0); }
      else { n.z = select(-1.0, 1.0, lp.z >= 0.0); }
      return qrot(q, n);
    }
    default: {
      let q = bitcast<vec4f>(primWord(i, 2u));
      let lp = qrotInv(q, p - a);
      let f = 1.0 - b.x / max(length(lp.xz), 1e-6);
      return qrot(q, normalize(vec3f(f * lp.x, lp.y, f * lp.z)));
    }
  }
}

struct PrimMaterial { albedo : vec3f, roughness : f32, emissive : vec3f, metalness : f32 }

fn primMaterial(i : u32) -> PrimMaterial {
  let m = primWord(i, 3u);
  let ab = unpack4x8unorm(m.x);
  let e01 = unpack2x16float(m.y);
  let e2m = unpack2x16float(m.z);
  return PrimMaterial(ab.rgb, ab.a, vec3f(e01.x, e01.y, e2m.x), e2m.y);
}
