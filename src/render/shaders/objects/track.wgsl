// Track G-buffer pipelines: the static world-space mesh (gates, obstacles, pad) and the animated cloth flags.
#include "objects/track_materials.wgsl"

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) uv : vec2f,
  @location(3) ao : f32,
  @location(4) @interpolate(flat) a2 : f32,
  @location(5) @interpolate(flat) a3 : f32,
  @location(6) @interpolate(flat) kind : u32,
  @location(7) prevClip : vec4f,
  @location(8) currClip : vec4f,
};

@vertex fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) attr : vec4f) -> VOut {
  var o : VOut;
  let w = vec4f(p, 1.0);
  o.pos = frame.viewProj * w;
  o.world = p;
  o.nrm = n;
  o.uv = uv;
  o.ao = attr.y;
  o.a2 = attr.z;
  o.a3 = attr.w;
  o.kind = u32(attr.x + 0.5);
  o.prevClip = frame.prevViewProj * w;
  o.currClip = frame.viewProjUnjittered * w;
  return o;
}

@fragment fn fs(in : VOut) -> GOut {
  let dp1 = dpdx(in.world);
  let dp2 = dpdy(in.world);
  let duv1 = dpdx(in.uv);
  let duv2 = dpdy(in.uv);
  let n = normalize(in.nrm);
  var m : MatIn;
  m.world = in.world;
  m.n = n;
  m.uv = in.uv;
  m.ao = in.ao;
  m.a2 = in.a2;
  m.a3 = in.a3;
  m.kind = in.kind;
  m.grad = uvGradients(dp1, dp2, duv1, duv2, n);
  m.fp = max(length(dp1), length(dp2));
  return packG(shadeTrack(m), in.prevClip, in.currClip);
}

// ---- cloth flags ----

// Point of flag `f` at grid coordinate st (s along the wind from the hoist, t downward from the top edge).
fn clothPoint(f : Flag, st : vec2f, time : f32) -> vec3f {
  let width = f.a.w;
  let height = f.b.w;
  let seed = f.c.x;
  let dir = vec3f(trk.wind.x, 0.0, trk.wind.y);
  let side = vec3f(-dir.z, 0.0, dir.x);
  let stream = saturate1(trk.wind.z / 9.0);
  let s = st.x;
  let t = st.y;
  var p = f.a.xyz + dir * (s * width * mix(0.3, 1.0, stream)) - vec3f(0.0, t * height + (1.0 - stream) * 0.35 * width * s * s, 0.0);
  let gust = 0.8 + 0.2 * sin(time * 0.7 + seed * 1.3);
  let amp = width * (0.04 + 0.11 * stream) * gust * s;
  let w1 = sin(6.0 * s - time * (2.0 + 6.0 * stream) + seed + 2.0 * t);
  let w2 = sin(11.0 * s - time * (3.0 + 9.0 * stream) * 1.3 + seed * 1.7 + 5.0 * t);
  p += side * (amp * (w1 + 0.4 * w2));
  p.y += amp * 0.3 * w1 * stream;
  return p;
}

struct ClothOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) st : vec2f,
  @location(3) @interpolate(flat) flag : u32,
  @location(4) prevClip : vec4f,
  @location(5) currClip : vec4f,
};

@vertex fn vsCloth(@location(0) st : vec2f, @builtin(instance_index) ii : u32) -> ClothOut {
  let f = flags[ii];
  let e = 0.02;
  let p = clothPoint(f, st, trk.time.x);
  let ps = clothPoint(f, st + vec2f(e, 0.0), trk.time.x);
  let pt = clothPoint(f, st + vec2f(0.0, e), trk.time.x);
  var o : ClothOut;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.nrm = normalize(cross(ps - p, pt - p));
  o.st = st;
  o.flag = ii;
  o.prevClip = frame.prevViewProj * vec4f(clothPoint(f, st, trk.time.y), 1.0);
  o.currClip = frame.viewProjUnjittered * vec4f(p, 1.0);
  return o;
}

@fragment fn fsCloth(in : ClothOut, @builtin(front_facing) front : bool) -> GOut {
  let f = flags[in.flag];
  let fw = max(fwidth(in.st.y), 1e-4);
  let n = normalize(select(-in.nrm, in.nrm, front));
  let width = f.a.w;
  let height = f.b.w;
  let stripe = smoothstep(0.36 - fw, 0.36 + fw, in.st.y) - smoothstep(0.64 - fw, 0.64 + fw, in.st.y);
  let thread = vnoise2(vec2f(in.st.x * width, in.st.y * height) * 260.0);
  let weave = 0.88 + 0.24 * thread;
  var s = newSurf(mix(f.b.rgb, vec3f(0.78), stripe) * weave, n, 0.85, 9u);
  s.translucency = 0.45;
  s.ao = mix(0.7, 1.0, in.st.x);
  return packG(s, in.prevClip, in.currClip);
}
