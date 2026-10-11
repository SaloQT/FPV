// Ray vs analytic proxy primitives (packed by src/render/rt/prims.ts, 64-byte records read as 4 x vec4u). Keep in sync with
// src/render/rt/cpuReference.ts, which the dev page compares against. Only ENTRY hits count: a ray starting inside a primitive misses it.
#ifndef GRP
@group(2) @binding(9) var<storage, read> bvhNodes : array<vec4u>;
@group(2) @binding(10) var<storage, read> bvhPrims : array<vec4u>;
#else
#include "rt/rt_common.wgsl"
@group(${GRP}) @binding(1) var<storage, read> bvhNodes : array<vec4u>;
@group(${GRP}) @binding(2) var<storage, read> bvhPrims : array<vec4u>;
#endif

const NO_HIT : f32 = 1e30;
const T_EPS : f32 = 1e-4;
const TORUS_STEPS : u32 = 32u;
const KIND_OBB : u32 = 0u;
const KIND_CAPSULE : u32 = 1u;
const KIND_SPHERE : u32 = 2u;
const KIND_CYLINDER : u32 = 4u;
const KIND_ELLIPSOID : u32 = 5u;
const KIND_CONE : u32 = 6u;
const KIND_GABLE : u32 = 7u;
const GABLE_PLANES = array<vec3f, 5>(vec3f(0.0,-1.0,0.0),vec3f(2.0,1.0,0.0),vec3f(-2.0,1.0,0.0),vec3f(0.0,0.0,1.0),vec3f(0.0,0.0,-1.0));

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

// Project into the plane perpendicular to the segment before solving the radial entry.
// The unscaled capsule quadratic subtracts O(distance^4) terms and loses thin distant branches.
fn hitCapsule(pa : vec3f, pb : vec3f, r : f32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let ba = pb - pa; let oa = o - pa; let lengthSq = dot(ba, ba);
  if (lengthSq < 1e-12) { return hitSphere(pa, r, o, d, tMax); }
  let segmentLength = sqrt(lengthSq); let axis = ba / segmentLength;
  let axialOrigin = dot(oa, axis); let axialDirection = dot(d, axis);
  let insideOffset = oa - axis * clamp(axialOrigin, 0.0, segmentLength);
  if (dot(insideOffset, insideOffset) < r * r) { return NO_HIT; }
  let radialOrigin = oa - axis * axialOrigin; let radialDirection = d - axis * axialDirection;
  let qa = dot(radialDirection, radialDirection);
  if (qa > 0.0) {
    let closestT = -dot(radialOrigin, radialDirection) / qa;
    let closest = radialOrigin + closestT * radialDirection;
    let discriminant = r * r - dot(closest, closest);
    if (discriminant < 0.0) { return NO_HIT; }
    let t = closestT - sqrt(discriminant / qa); let y = axialOrigin + t * axialDirection;
    if (y >= 0.0 && y <= segmentLength) { return select(NO_HIT, t, t > T_EPS && t <= tMax); }
    return hitSphere(select(pb, pa, y < 0.0), r, o, d, tMax);
  }
  // Both caps matter for an axial ray: its approaching end may be either segment endpoint.
  return min(hitSphere(pa, r, o, d, tMax), hitSphere(pb, r, o, d, tMax));
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

fn hitCone(c : vec3f, half : vec3f, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let lp = qrotInv(q, o - c); let ld = qrotInv(q, d);
  let p = vec3f(lp.x / half.x, (half.y - lp.y) / (2.0 * half.y), lp.z / half.z);
  let v = vec3f(ld.x / half.x, -ld.y / (2.0 * half.y), ld.z / half.z);
  if (p.y > 0.0 && p.y < 1.0 && dot(p.xz, p.xz) < p.y * p.y) { return NO_HIT; }
  let a = dot(v.xz, v.xz) - v.y * v.y;
  let b = dot(p.xz, v.xz) - p.y * v.y;
  let cc = dot(p.xz, p.xz) - p.y * p.y;
  var best = NO_HIT; var roots = vec2f(NO_HIT);
  if (abs(a) < 1e-12) { if (abs(b) > 1e-12) { roots.x = -cc / (2.0 * b); } }
  else {
    let disc = b * b - a * cc;
    if (disc >= 0.0) {
      let r = -b - select(1.0, -1.0, b < 0.0) * sqrt(disc);
      roots.x = r / a;
      if (abs(r) > 1e-20) { roots.y = cc / r; }
    }
  }
  for (var k = 0u; k < 2u; k++) {
    let t = roots[k]; let y = p.y + t * v.y;
    if (t > T_EPS && t <= tMax && t < best && y >= 0.0 && y <= 1.0) { best = t; }
  }
  if (abs(v.y) > 1e-12) {
    let t = (1.0 - p.y) / v.y; let at = p.xz + t * v.xz;
    if (t > T_EPS && t <= tMax && t < best && dot(at, at) <= 1.0) { best = t; }
  }
  return best;
}

fn hitGable(c : vec3f, half : vec3f, q : vec4f, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let lo = qrotInv(q, o-c)/half; let ld = qrotInv(q,d)/half;
  var enter = -NO_HIT; var leave = NO_HIT;
  for (var k=0u; k<5u; k++) {
    let n=GABLE_PLANES[k]; let numerator=1.0-dot(n,lo); let denominator=dot(n,ld);
    if (abs(denominator)<1e-12) { if (numerator<0.0) { return NO_HIT; } }
    else { let t=numerator/denominator; if (denominator<0.0) { enter=max(enter,t); } else { leave=min(leave,t); } }
  }
  return select(NO_HIT,enter,enter<=leave && enter>T_EPS && enter<=tMax);
}

fn intersectPrim(i : u32, o : vec3f, d : vec3f, tMax : f32) -> f32 {
  let head = primWord(i, 0u);
  let a = bitcast<vec4f>(head);
  let b = bitcast<vec4f>(primWord(i, 1u));
  switch (head.w) {
    case KIND_SPHERE: { return hitSphere(a.xyz, b.w, o, d, tMax); }
    case KIND_CAPSULE: { return hitCapsule(a.xyz, b.xyz, b.w, o, d, tMax); }
    case KIND_OBB: { return hitObb(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }
    case KIND_CONE: { return hitCone(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }
    case KIND_GABLE: { return hitGable(a.xyz, b.xyz, bitcast<vec4f>(primWord(i, 2u)), o, d, tMax); }
    case KIND_CYLINDER, KIND_ELLIPSOID: {
      let q = bitcast<vec4f>(primWord(i, 2u)); let lo = qrotInv(q, o - a.xyz); let ld = qrotInv(q, d);
      let mask = select(vec3f(1.0), vec3f(1.0, 0.0, 1.0), head.w == KIND_CYLINDER);
      let oo = lo / b.xyz; let dd = ld / b.xyz;
      let qa = dot(dd * mask, dd); let qb = dot(oo * mask, dd); let qc = dot(oo * mask, oo) - 1.0;
      if (qc < 0.0 && (head.w == KIND_ELLIPSOID || abs(lo.y) < b.y)) { return NO_HIT; }
      // Closest-point form avoids subtracting two huge, nearly equal squared distances on thin distant rails.
      var best = NO_HIT; let closestT = -qb / max(qa, 1e-20); let closest = oo + dd * closestT;
      let disc = 1.0 - dot(closest * mask, closest);
      if (qa > 1e-14 && disc >= 0.0) { let t = closestT - sqrt(disc / qa);
        if (t > T_EPS && t <= tMax && (head.w == KIND_ELLIPSOID || abs(lo.y + t * ld.y) <= b.y)) { best = t; }
      }
      if (head.w == KIND_CYLINDER && abs(ld.y) > 1e-12) {
        for (var side = -1.0; side <= 1.0; side += 2.0) { let t = (side * b.y - lo.y) / ld.y; let p = (lo.xz + t * ld.xz) / b.xz;
          if (t > T_EPS && t <= tMax && t < best && dot(p, p) <= 1.0) { best = t; }
        }
      }
      return best;
    }
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
    case KIND_GABLE: {
      let q=bitcast<vec4f>(primWord(i,2u)); let lp=qrotInv(q,p-a); var normal=vec3f(0.0,-1.0,0.0); var nearest=NO_HIT;
      for (var k=0u; k<5u; k++) { let n=GABLE_PLANES[k]/b.xyz; let len=length(n); let distance=abs(dot(n,lp)-1.0)/len;
        if (distance<nearest) { nearest=distance; normal=n/len; }
      }
      return qrot(q,normal);
    }
    case KIND_CONE: {
      let q = bitcast<vec4f>(primWord(i, 2u)); let lp = qrotInv(q, p - a);
      if (abs(lp.y + b.y) < 0.0005) { return qrot(q, vec3f(0.0, -1.0, 0.0)); }
      let n = vec3f(lp.x / (b.x * b.x), (b.y - lp.y) / (4.0 * b.y * b.y), lp.z / (b.z * b.z));
      if (dot(n, n) < 1e-20) { return qrot(q, vec3f(0.0, 1.0, 0.0)); }
      return qrot(q, normalize(n));
    }
    case KIND_CYLINDER, KIND_ELLIPSOID: {
      let q = bitcast<vec4f>(primWord(i, 2u)); let lp = qrotInv(q, p - a); var n = lp / (b.xyz * b.xyz);
      if (head.w == KIND_CYLINDER) { n.y = 0.0; if (abs(abs(lp.y) - b.y) < 0.0005) { n = vec3f(0.0, sign(lp.y), 0.0); } }
      return qrot(q, normalize(n));
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
