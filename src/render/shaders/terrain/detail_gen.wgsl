// One-off generator of the tileable 512x512 ground detail arrays (8 layers, see ground_palette.wgsl for the layer ids).
//   outA: rgb = sRGB-encoded albedo (the pipeline samples it through an rgba8unorm-srgb view), a = height 0..1 (mean about 0.5)
//   outB: rg = tangent-space normal xy (slope, x = +u, y = +v) * 0.5 + 0.5, b = roughness, a = cavity AO
// Every noise is periodic in uv (integer lattice periods), so the arrays tile seamlessly. Self-contained on purpose: math.wgsl needs Frame.
#include "terrain/ground_palette.wgsl"
#include "terrain/detail_noise.wgsl"

@group(0) @binding(0) var outA : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(1) var outB : texture_storage_2d_array<rgba8unorm, write>;

const SIZE : f32 = 512.0;

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

// Colour of one stone relative to the layer mean: tan, grey, dark basalt-like, rust and the odd pale quartz.
fn stoneTone(id : f32) -> vec3f {
  if (id < 0.30) { return vec3f(1.18, 1.04, 0.84); }
  if (id < 0.58) { return vec3f(0.92, 0.94, 0.98); }
  if (id < 0.80) { return vec3f(0.55, 0.55, 0.58); }
  if (id < 0.89) { return vec3f(1.12, 0.86, 0.72); }
  return vec3f(1.45, 1.42, 1.36);
}

// Bare soil: fine grain and crumbly clods in two sizes, scattered pebbles of every colour pressed into it and a few hairline drying cracks.
fn surfDirt(uv : vec2f) -> Surf {
  var s : Surf;
  let n1 = pFbm(uv, 6, 4, 9u);
  let n2 = pFbm(uv, 26, 3, 10u);
  let grain = pNoise(uv, vec2i(180), 11u) * 0.5 + 0.5;
  let clod = pStones(uv, 12, 12u, 0.38, 0.70, 0.7, 0.95);
  let crumb = pStones(uv, 33, 71u, 0.34, 0.66, 0.75, 0.95);
  let peb = pStones(uv, 11, 72u, 0.10, 0.30, 0.7, 0.55);
  let peb2 = pStones(uv, 29, 73u, 0.18, 0.42, 0.75, 0.30);
  let w = pCell(uv + 0.02 * vec2f(pNoise(uv, vec2i(7), 74u), pNoise(uv, vec2i(7), 75u)), 6, 76u);
  let crack = (1.0 - smoothstep(0.0, 0.04, w.f2 - w.f1)) * smoothstep(0.55, 0.75, pFbm(uv, 5, 3, 77u));
  let soilH = 0.30 * contrast(n1, 1.7) + 0.16 * contrast(n2, 1.6) + 0.10 * grain + 0.20 * max(clod.h, 0.0) + 0.12 * max(crumb.h, 0.0);
  let pebH = max(0.25 + 0.55 * peb.h, 0.20 + 0.45 * peb2.h);
  let onPebble = max(peb.h, peb2.h) > 0.0;
  s.h = saturate(select(soilH, max(soilH, pebH), onPebble) - 0.25 * crack);
  let soil = mix(vec3f(0.60, 0.58, 0.56), vec3f(1.28, 1.20, 1.10), saturate(soilH * 1.5)) * (0.90 + 0.20 * clod.id) * (0.9 + 0.2 * grain);
  let pid = select(peb2.id, peb.id, peb.h >= peb2.h);
  let pt = stoneTone(pid) * (0.6 + 0.6 * sqrt(max(1.0 - select(peb2.rr, peb.rr, peb.h >= peb2.h), 0.0)));
  s.tone = select(soil, pt, onPebble && pebH >= soilH) * (1.0 - 0.45 * crack);
  s.rough = 0.02 * (grain - 0.5) - select(0.0, 0.08, onPebble);
  s.ao = cavity(s.h) * (1.0 - 0.5 * crack);
  return s;
}

// Gravel: stones of three sizes stacked over a dirty sand fill, with different shapes, colours and heights, so no two neighbours match
// and the gaps stay dark. Every stone is a rounded dome; the largest ones stand proud.
fn surfGravel(uv : vec2f) -> Surf {
  var s : Surf;
  let big = pStones(uv, 7, 13u, 0.34, 0.60, 0.62, 0.9);
  let mid = pStones(uv, 17, 41u, 0.32, 0.60, 0.65, 0.95);
  let fine = pStones(uv, 43, 43u, 0.32, 0.62, 0.7, 1.0);
  let grain = pNoise(uv, vec2i(200), 44u) * 0.5 + 0.5;
  let sandN = pFbm(uv, 12, 3, 45u);
  var h = 0.10 + 0.08 * sandN;
  var tone = vec3f(0.62, 0.56, 0.48) * (0.8 + 0.4 * grain);
  var ao = 0.35;
  var rough = 0.06;
  let hf = 0.14 + 0.26 * fine.h;
  if (fine.h > 0.0 && hf > h) {
    h = hf;
    tone = stoneTone(fine.id) * (0.55 + 0.55 * sqrt(max(1.0 - fine.rr, 0.0)));
    ao = 0.45 + 0.55 * sqrt(max(1.0 - fine.rr, 0.0));
    rough = -0.04;
  }
  let hm = 0.22 + 0.42 * mid.h;
  if (mid.h > 0.0 && hm > h) {
    h = hm;
    tone = stoneTone(mid.id) * (0.55 + 0.55 * sqrt(max(1.0 - mid.rr, 0.0)));
    ao = 0.45 + 0.55 * sqrt(max(1.0 - mid.rr, 0.0));
    rough = -0.05;
  }
  let hb = 0.30 + 0.70 * big.h;
  if (big.h > 0.0 && hb > h) {
    h = hb;
    tone = stoneTone(big.id) * (0.55 + 0.55 * sqrt(max(1.0 - big.rr, 0.0)));
    ao = 0.45 + 0.55 * sqrt(max(1.0 - big.rr, 0.0));
    rough = -0.05;
  }
  s.h = saturate(h);
  s.tone = tone;
  s.rough = rough;
  s.ao = ao;
  return s;
}

// Jointed, weathered rock: irregular blocks at two scales whose joints fade in and out along their length, each block with its own height
// and tilt, warped bedding bands, a rough grain and vertical rain streaks. Joints are never a regular honeycomb.
fn surfRock(uv : vec2f) -> Surf {
  var s : Surf;
  let q = uv + 0.03 * vec2f(pNoise(uv, vec2i(5), 61u), pNoise(uv, vec2i(5), 62u)) + 0.006 * vec2f(pNoise(uv, vec2i(23), 63u), pNoise(uv, vec2i(23), 64u));
  let big = pCell(q, 4, 14u);
  let sub = pCell(q, 11, 31u);
  let open1 = 0.25 + 0.75 * smoothstep(0.30, 0.62, pFbm(uv, 9, 3, 65u));
  let open2 = smoothstep(0.42, 0.70, pFbm(uv, 14, 3, 66u));
  let joint1 = (1.0 - smoothstep(0.0, 0.05 + 0.13 * open1, big.f2 - big.f1)) * open1;
  let joint2 = (1.0 - smoothstep(0.0, 0.05 + 0.08 * open2, sub.f2 - sub.f1)) * open2;
  let ang = TAU_D * fract(big.id * 7.7);
  let tilt = vec2f(cos(ang), sin(ang)) * (0.12 + 0.28 * fract(big.id * 3.3));
  let plate = (big.id - 0.5) * 0.26 + dot(big.d, tilt) * 0.55 + (sub.id - 0.5) * 0.10;
  let strata = 0.5 + 0.5 * sin(TAU_D * (11.0 * uv.y + 1.8 * pFbm(uv, 4, 3, 15u)));
  let grain = pFbm(uv, 40, 4, 17u);
  let pits = pNoise(uv, vec2i(150), 67u);
  let rain = pNoise(uv, vec2i(44, 5), 68u) * 0.5 + 0.5;
  s.h = saturate(0.5 + plate + 0.07 * strata + 0.26 * (grain - 0.5) + 0.08 * pits - 0.34 * joint1 - 0.18 * joint2);
  let block = 0.90 + 0.20 * fract(big.id * 5.1);
  s.tone = mix(vec3f(0.62, 0.62, 0.64), vec3f(1.30, 1.22, 1.10), s.h) * block * mix(0.92, 1.06, strata) * mix(0.82, 1.04, rain)
    * (1.0 - 0.6 * joint1) * (1.0 - 0.35 * joint2) * (0.9 + 0.2 * grain);
  s.rough = 0.06 * (grain - 0.5) + 0.06 * joint1;
  s.ao = cavity(s.h) * (1.0 - 0.6 * joint1) * (1.0 - 0.3 * joint2);
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

// Moist crumbly loam: irregular clods of two sizes, dark organic specks and damp patches.
fn surfLoam(uv : vec2f) -> Surf {
  var s : Surf;
  let clod = pStones(uv, 10, 23u, 0.40, 0.72, 0.65, 0.95);
  let crumb = pStones(uv, 27, 78u, 0.34, 0.66, 0.7, 0.95);
  let fbm = pFbm(uv, 9, 4, 24u);
  let speck = smoothstep(0.72, 0.9, pNoise(uv, vec2i(120), 79u) * 0.5 + 0.5);
  let damp = smoothstep(0.35, 0.70, pFbm(uv, 4, 3, 80u));
  s.h = saturate(0.34 * contrast(fbm, 1.6) + 0.30 * max(clod.h, 0.0) + 0.22 * max(crumb.h, 0.0) + 0.1);
  s.tone = mix(vec3f(0.58, 0.58, 0.60), vec3f(1.32, 1.26, 1.16), s.h) * (0.88 + 0.24 * clod.id) * mix(1.0, 0.72, damp) * (1.0 - 0.45 * speck);
  s.rough = -0.06 * damp;
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
