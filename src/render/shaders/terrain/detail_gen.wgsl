// One-off generator of the tileable 512x512 ground detail arrays (8 layers, see ground_palette.wgsl for the layer ids).
//   outA: rgb = sRGB-encoded albedo (the pipeline samples it through an rgba8unorm-srgb view), a = height 0..1 (mean about 0.5)
//   outB: rg = tangent-space normal xy (slope, x = +u, y = +v) * 0.5 + 0.5, b = roughness, a = cavity AO
// Every noise is periodic in uv (integer lattice periods), so the arrays tile seamlessly. Self-contained on purpose: math.wgsl needs Frame.
#include "terrain/ground_palette.wgsl"

@group(0) @binding(0) var outA : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(1) var outB : texture_storage_2d_array<rgba8unorm, write>;

const SIZE : f32 = 512.0;
const TAU_D : f32 = 6.28318530718;

fn pcgh(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash2(ip : vec2i, seed : u32) -> u32 { return pcgh(u32(ip.x) + pcgh(u32(ip.y) + pcgh(seed))); }
fn f01(h : u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn wrapLattice(ip : vec2i, per : vec2i) -> vec2i { return ((ip % per) + per) % per; }

fn pGrad(ip : vec2i, per : vec2i, seed : u32) -> vec2f {
  let a = f01(hash2(wrapLattice(ip, per), seed)) * TAU_D;
  return vec2f(cos(a), sin(a));
}

// Periodic Perlin noise, about [-1, 1]; `per` lattice cells across the tile on each axis.
fn pNoise(uv : vec2f, per : vec2i, seed : u32) -> f32 {
  let p = uv * vec2f(per);
  let i = floor(p);
  let f = p - i;
  let ip = vec2i(i);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(pGrad(ip, per, seed), f);
  let b = dot(pGrad(ip + vec2i(1, 0), per, seed), f - vec2f(1.0, 0.0));
  let c = dot(pGrad(ip + vec2i(0, 1), per, seed), f - vec2f(0.0, 1.0));
  let d = dot(pGrad(ip + vec2i(1, 1), per, seed), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

// Periodic fbm remapped to about [0, 1]; the frequency doubles per octave.
fn pFbm(uv : vec2f, freq : i32, octaves : i32, seed : u32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var fr = freq;
  for (var o = 0; o < octaves; o++) {
    sum += amp * pNoise(uv, vec2i(fr), seed + u32(o) * 101u);
    norm += amp;
    amp *= 0.5;
    fr *= 2;
  }
  return 0.5 + 0.5 * sum / norm;
}

// Periodic cellular noise: (F1, F2, random id of the nearest feature point).
fn pWorley(uv : vec2f, freq : i32, seed : u32) -> vec3f {
  let p = uv * f32(freq);
  let base = floor(p);
  let f = p - base;
  let i = vec2i(base);
  var d1 = 8.0;
  var d2 = 8.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let cell = vec2i(x, y);
      let h = hash2(wrapLattice(i + cell, vec2i(freq)), seed);
      let pt = vec2f(cell) + vec2f(f01(h), f01(pcgh(h))) - f;
      let d = dot(pt, pt);
      if (d < d1) { d2 = d1; d1 = d; id = f01(pcgh(h ^ 2654435769u)); } else if (d < d2) { d2 = d; }
    }
  }
  return vec3f(sqrt(d1), sqrt(d2), id);
}

fn contrast(x : f32, k : f32) -> f32 { return saturate(0.5 + (x - 0.5) * k); }
fn cavity(h : f32) -> f32 { return 0.4 + 0.6 * smoothstep(0.1, 0.7, h); }

fn srgbEncode(c : vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
}

struct Surf {
  h : f32,
  tone : vec3f,   // multiplies the layer's mean albedo; about 1 on average
  rough : f32,    // added to the layer's mean roughness
  ao : f32,
};

// Per-layer relief: tangent-space slope per unit of height change across two texels.
fn relief(layer : i32) -> f32 {
  switch (layer) {
    case 0: { return 5.0; }
    case 1: { return 5.0; }
    case 2: { return 6.0; }
    case 3: { return 9.0; }
    case 4: { return 10.0; }
    case 5: { return 3.0; }
    case 6: { return 2.5; }
    default: { return 6.0; }
  }
}

// A blade lying on the ground seen from above: a tapered, bent lens from its root along `dir`.
struct Stroke {
  z : f32,       // depth order; -1 when no blade covers the texel
  t : f32,       // 0 at the root, 1 at the tip
  id : f32,      // random 0..1 per blade (colour pick)
  across : f32,  // 0 on the midrib, 1 at the edge
};

// The topmost of `per` jittered blades per cell of an n x n grid that covers uv. The 3x3 cells around the texel are searched, so blades
// must stay shorter than one cell. `field` leans the whole pass toward a coherent direction, `spread` (radians) scatters it.
fn strokeAt(uv : vec2f, n : i32, per : i32, seed : u32, len : vec2f, wid : vec2f, curve : f32, spread : f32) -> Stroke {
  let p = uv * f32(n);
  let c0 = vec2i(floor(p));
  let field = pNoise(uv, vec2i(3), seed + 77u) * 1.6;
  var best = Stroke(-1.0, 0.0, 0.0, 0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = c0 + vec2i(i, j);
      let hc = hash2(wrapLattice(c, vec2i(n)), seed);
      for (var k = 0; k < per; k++) {
        let h1 = pcgh(hc + u32(k) * 2654435769u);
        let h2 = pcgh(h1);
        let d = p - (vec2f(c) + vec2f(f01(h1), f01(h2)));
        if (dot(d, d) > len.y * len.y) { continue; }
        let h3 = pcgh(h2);
        let h4 = pcgh(h3);
        let h5 = pcgh(h4);
        let a = field + (f01(h3) * 2.0 - 1.0) * spread;
        let dir = vec2f(cos(a), sin(a));
        let l = mix(len.x, len.y, f32(h4 & 255u) / 255.0);
        let t = dot(d, dir) / l;
        if (t < 0.0 || t > 1.0) { continue; }
        let bend = curve * (f32((h4 >> 16u) & 255u) / 127.5 - 1.0) * l * t * t;
        let across = dot(d, vec2f(-dir.y, dir.x)) - bend;
        let hw = mix(wid.x, wid.y, f32((h4 >> 8u) & 255u) / 255.0) * pow(1.0 - t, 0.7);
        let z = f01(h5);
        if (abs(across) < hw && z > best.z) { best = Stroke(z, t, f32(h5 & 255u) / 255.0, abs(across) / hw); }
      }
    }
  }
  return best;
}

// Blade colour relative to the layer mean: dark, mid, yellow-green, blue-green and the odd dry blade; dark root to light tip.
fn bladeTone(id : f32, t : f32) -> vec3f {
  var c = vec3f(1.0);
  if (id < 0.16) { c = vec3f(0.62, 0.74, 0.62); }
  else if (id < 0.36) { c = vec3f(1.42, 1.14, 0.80); }
  else if (id < 0.42) { c = vec3f(1.85, 1.30, 1.55); }
  else if (id < 0.58) { c = vec3f(0.85, 1.05, 1.10); }
  return c * mix(0.6, 1.5, t);
}

fn strawTone(id : f32, t : f32) -> vec3f {
  var c = vec3f(1.0);
  if (id < 0.2) { c = vec3f(0.78, 0.74, 0.68); }
  else if (id < 0.55) { c = vec3f(1.0); }
  else if (id < 0.8) { c = vec3f(1.12, 1.07, 1.0); }
  else { c = vec3f(1.28, 1.24, 1.15); }
  return c * mix(0.78, 1.22, t);
}

// Two passes of blades over a dark thatch. z (a height for the blend with the other layers) rises with each pass and toward the tips.
fn surfGrass(uv : vec2f) -> Surf {
  var s : Surf;
  s.h = 0.08;
  s.tone = vec3f(0.55, 0.50, 0.60);
  s.ao = 0.30;
  let rip = pNoise(uv, vec2i(140), 3u) * 0.5 + 0.5;
  let a = strokeAt(uv, 18, 8, 31u, vec2f(0.55, 0.95), vec2f(0.035, 0.06), 0.35, 3.1);
  if (a.z >= 0.0) {
    s.h = 0.25 + 0.2 * a.z + 0.12 * a.t;
    s.tone = bladeTone(a.id, a.t) * 0.85;
    s.ao = mix(0.30, 0.85, a.t);
  }
  let b = strokeAt(uv, 30, 8, 47u, vec2f(0.5, 0.92), vec2f(0.04, 0.07), 0.45, 3.1);
  if (b.z >= 0.0) {
    s.h = 0.5 + 0.22 * b.z + 0.14 * b.t;
    s.tone = bladeTone(b.id, b.t) * (1.0 - 0.25 * b.across * b.across);
    s.ao = mix(0.4, 1.0, b.t);
  }
  s.rough = 0.05 * (b.t - 0.5) * step(0.0, b.z) + 0.02 * (rip - 0.5);
  return s;
}

// Matted dry grass: longer, thinner, more aligned and more bent blades.
fn surfHay(uv : vec2f) -> Surf {
  var s : Surf;
  s.h = 0.10;
  s.tone = vec3f(0.48, 0.44, 0.40);
  s.ao = 0.32;
  let a = strokeAt(uv, 14, 9, 51u, vec2f(0.7, 0.98), vec2f(0.022, 0.04), 0.6, 1.8);
  if (a.z >= 0.0) {
    s.h = 0.28 + 0.2 * a.z + 0.1 * a.t;
    s.tone = strawTone(a.id, a.t) * 0.9;
    s.ao = mix(0.35, 0.85, a.t);
  }
  let b = strokeAt(uv, 24, 9, 67u, vec2f(0.65, 0.95), vec2f(0.028, 0.048), 0.7, 2.0);
  if (b.z >= 0.0) {
    s.h = 0.5 + 0.22 * b.z + 0.14 * b.t;
    s.tone = strawTone(b.id, b.t) * (1.0 - 0.2 * b.across * b.across);
    s.ao = mix(0.4, 1.0, b.t);
  }
  s.rough = 0.05 * (b.id - 0.5) * step(0.0, b.z);
  return s;
}

fn surfDirt(uv : vec2f) -> Surf {
  var s : Surf;
  let n1 = pFbm(uv, 6, 4, 9u);
  let n2 = pFbm(uv, 26, 3, 10u);
  let grain = pNoise(uv, vec2i(140), 11u) * 0.5 + 0.5;
  let w = pWorley(uv, 12, 12u);
  let pebble = (1.0 - smoothstep(0.0, 0.26, w.x)) * step(0.7, w.z);
  s.h = saturate(0.42 * contrast(n1, 1.7) + 0.28 * contrast(n2, 1.6) + 0.12 * grain + 0.38 * pebble);
  let soil = mix(vec3f(0.62, 0.60, 0.58), vec3f(1.30, 1.22, 1.12), s.h);
  s.tone = mix(soil, vec3f(1.5, 1.45, 1.4) * (0.7 + 0.3 * w.z), pebble);
  s.rough = 0.02 * (grain - 0.5) - 0.08 * pebble;
  s.ao = cavity(s.h);
  return s;
}

fn surfGravel(uv : vec2f) -> Surf {
  var s : Surf;
  let w = pWorley(uv, 16, 13u);
  let r = w.x / 0.62;
  let dome = sqrt(saturate(1.0 - r * r));
  let crev = smoothstep(0.0, 0.12, w.y - w.x);
  let shape = 0.35 + 0.65 * fract(w.z * 7.3);
  s.h = saturate(0.1 + 0.9 * dome * shape);
  let stone = mix(vec3f(0.72, 0.70, 0.68), vec3f(1.30, 1.18, 1.00), fract(w.z * 13.7)) * (0.55 + 0.6 * dome);
  s.tone = stone * mix(0.4, 1.0, crev);
  s.rough = 0.05 * (fract(w.z * 3.1) - 0.5);
  s.ao = crev * (0.4 + 0.6 * dome);
  return s;
}

fn surfRock(uv : vec2f) -> Surf {
  var s : Surf;
  let w = pWorley(uv, 5, 14u);
  let crack = 1.0 - smoothstep(0.0, 0.07, w.y - w.x);
  let strata = 0.5 + 0.5 * sin(TAU_D * (9.0 * uv.y + 1.6 * pFbm(uv, 4, 3, 15u)));
  let n = pFbm(uv, 8, 5, 16u);
  let fine = pFbm(uv, 40, 3, 17u);
  s.h = saturate(0.42 * contrast(n, 1.6) + 0.22 * strata + 0.30 * contrast(fine, 1.5) - 0.45 * crack + 0.10);
  s.tone = mix(vec3f(0.60, 0.60, 0.62), vec3f(1.40, 1.30, 1.15), s.h) * mix(0.88, 1.12, strata) * (1.0 - 0.55 * crack);
  s.rough = 0.05 * (fine - 0.5) + 0.06 * crack;
  s.ao = cavity(s.h) * (1.0 - 0.6 * crack);
  return s;
}

fn surfSand(uv : vec2f) -> Surf {
  var s : Surf;
  let ripple = sin(TAU_D * (7.0 * uv.x + 4.0 * uv.y + 1.4 * pFbm(uv, 3, 2, 18u)));
  let grain = pNoise(uv, vec2i(200), 19u) * 0.5 + 0.5;
  let dune = pFbm(uv, 4, 3, 20u);
  s.h = saturate(0.5 + 0.10 * ripple + 0.16 * (grain - 0.5) + 0.20 * (dune - 0.5));
  s.tone = mix(vec3f(0.85, 0.83, 0.80), vec3f(1.12, 1.08, 1.00), grain) * (0.95 + 0.10 * ripple);
  s.rough = 0.02 * (grain - 0.5);
  s.ao = 0.7 + 0.3 * s.h;
  return s;
}

fn surfSnow(uv : vec2f) -> Surf {
  var s : Surf;
  let drift = pFbm(uv, 5, 3, 21u);
  let grain = pNoise(uv, vec2i(220), 22u) * 0.5 + 0.5;
  s.h = saturate(0.5 + 0.55 * (drift - 0.5) + 0.10 * (grain - 0.5));
  s.tone = vec3f(0.97 + 0.06 * grain) * vec3f(0.98, 1.0, 1.03);
  s.rough = 0.05 * (grain - 0.5);
  s.ao = 0.75 + 0.25 * s.h;
  return s;
}

fn surfLoam(uv : vec2f) -> Surf {
  var s : Surf;
  let w = pWorley(uv, 30, 23u);
  let crumb = 1.0 - smoothstep(0.0, 0.7, w.x);
  s.h = saturate(0.5 * contrast(pFbm(uv, 9, 4, 24u), 1.6) + 0.5 * crumb);
  s.tone = mix(vec3f(0.60, 0.60, 0.62), vec3f(1.35, 1.30, 1.20), s.h);
  s.rough = 0.0;
  s.ao = cavity(s.h);
  return s;
}

fn surf(layer : i32, uv : vec2f) -> Surf {
  switch (layer) {
    case 0: { return surfGrass(uv); }
    case 1: { return surfHay(uv); }
    case 2: { return surfDirt(uv); }
    case 3: { return surfGravel(uv); }
    case 4: { return surfRock(uv); }
    case 5: { return surfSand(uv); }
    case 6: { return surfSnow(uv); }
    default: { return surfLoam(uv); }
  }
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let layer = i32(gid.z);
  let px = vec2i(gid.xy);
  let uv = (vec2f(px) + 0.5) / SIZE;
  let e = 1.0 / SIZE;
  let c = surf(layer, uv);
  let dx = surf(layer, uv + vec2f(e, 0.0)).h - surf(layer, uv - vec2f(e, 0.0)).h;
  let dy = surf(layer, uv + vec2f(0.0, e)).h - surf(layer, uv - vec2f(0.0, e)).h;
  let slope = clamp(-vec2f(dx, dy) * relief(layer), vec2f(-0.95), vec2f(0.95));
  let albedo = srgbEncode(clamp(glBaseColor(layer) * c.tone, vec3f(0.0), vec3f(1.0)));
  textureStore(outA, px, layer, vec4f(albedo, c.h));
  textureStore(outB, px, layer, vec4f(slope * 0.5 + 0.5, saturate(glRoughness(layer) + c.rough), c.ao));
}
