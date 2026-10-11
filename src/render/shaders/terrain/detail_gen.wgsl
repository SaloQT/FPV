// One-off generator of the tileable 512x512 ground detail arrays (8 layers, see ground_palette.wgsl for the layer ids).
//   outA: rgb = sRGB-encoded albedo (the pipeline samples it through an rgba8unorm-srgb view), a = height 0..1 (mean about 0.5)
//   outB: rg = tangent-space normal xy (slope, x = +u, y = +v) * 0.5 + 0.5, b = roughness, a = cavity AO
// Every noise is periodic in uv (integer lattice periods), so the arrays tile seamlessly. Self-contained on purpose: math.wgsl needs Frame.
#include "terrain/ground_palette.wgsl"
#include "terrain/detail_noise.wgsl"

@group(0) @binding(0) var outA : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(1) var outB : texture_storage_2d_array<rgba8unorm, write>;
// x = 1: the reach of the neighbour-cell loops, read at run time so the compiler keeps them as loops (unrolled, they took ~10 s to compile).
@group(0) @binding(2) var<uniform> bounds : vec4i;

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
    case 3: { return 7.0; }
    case 4: { return 10.0; }
    case 5: { return 3.0; }
    case 6: { return 2.5; }
    case 7: { return 6.0; }
    case 8: { return 6.0; }
    case 9: { return 7.0; }
    case 10: { return 6.0; }
    case 11: { return 4.0; }
    case 12: { return 7.0; }
    default: { return 11.0; }
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
  for (var j = -bounds.x; j <= bounds.x; j++) {
    for (var i = -bounds.x; i <= bounds.x; i++) {
      let c = c0 + vec2i(i, j);
      let hc = hash2(wrapLattice(c, vec2i(n)), seed);
      for (var k = 0; k < per * bounds.x; k++) {
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
  else if (id < 0.58) { c = vec3f(0.88, 1.05, 0.95); }
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
  if (id < 0.30) { return vec3f(1.12, 1.0, 0.82); }
  if (id < 0.58) { return vec3f(0.92, 0.94, 0.98); }
  if (id < 0.80) { return vec3f(0.55, 0.55, 0.58); }
  if (id < 0.89) { return vec3f(1.12, 0.86, 0.72); }
  return vec3f(1.15, 1.13, 1.1);
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

// Weathered outcrop rock. The face is a terraced fbm (flat facets broken by short steep steps, the way rock spalls), cut by meandering
// fractures: a bedding-parallel set elongated along u (the steep-face projections put world up on v, so it lies level), a cross set along
// v and a fine irregular set, each fading in and out along its length. On top: crystalline grain, pits, iron staining, dark rain streaks
// running down v and small, sparse crustose lichen.
fn rockCrack(n : f32, width : f32) -> f32 { return 1.0 - smoothstep(0.0, width, abs(n)); }

fn surfRock(uv : vec2f) -> Surf {
  var s : Surf;
  let q = uv + 0.03 * vec2f(pNoise(uv, vec2i(4), 61u), pNoise(uv, vec2i(4), 62u)) + 0.006 * vec2f(pNoise(uv, vec2i(17), 63u), pNoise(uv, vec2i(17), 64u));
  let f = pFbm(q, 3, 4, 14u);
  let steps = 6.0;
  let ft = f * steps;
  let level = floor(ft);
  // Half terraced, half smooth: full terraces close into contour rings that read as crazy paving from a few metres off.
  let terr = mix(f, (level + smoothstep(0.7, 1.0, ft - level)) / steps, 0.5);
  let facetId = f01(pcgh(u32(level + 16.0) * 7919u + 3u));
  // Noise stretched 5 to 6 times along a set's strike gives long, gently curving fractures rather than closed loops.
  let bedSet = rockCrack(pNoise(q, vec2i(2, 11), 15u), 0.03) * smoothstep(0.35, 0.6, pFbm(uv, 3, 2, 65u));
  let crossSet = rockCrack(pNoise(q + 0.31, vec2i(11, 2), 16u), 0.025) * smoothstep(0.45, 0.68, pFbm(uv + 0.5, 4, 2, 66u));
  let fineSet = rockCrack(pNoise(q * vec2f(1.0, 1.0) + 0.17, vec2i(5, 26), 19u), 0.015) * smoothstep(0.5, 0.75, pFbm(uv, 6, 2, 20u)) * 0.6;
  let crack = max(max(bedSet, crossSet), fineSet);
  let grain = pFbm(uv, 48, 4, 17u);
  let pits = smoothstep(0.6, 0.9, pNoise(uv, vec2i(170), 67u) * 0.5 + 0.5);
  let crystals = pNoise(uv, vec2i(240), 69u) * 0.5 + 0.5;
  s.h = saturate(0.5 + 0.9 * (terr - 0.5) + 0.18 * (grain - 0.5) - 0.06 * pits - 0.4 * crack);
  let stain = smoothstep(0.58, 0.82, pFbm(uv, 4, 3, 70u));
  let streak = smoothstep(0.55, 0.85, pNoise(uv, vec2i(36, 2), 68u) * 0.5 + 0.5) * smoothstep(0.3, 0.7, pFbm(uv, 3, 2, 72u));
  var tone = mix(vec3f(0.74, 0.74, 0.76), vec3f(1.20, 1.15, 1.07), smoothstep(0.15, 0.85, s.h)) * (0.95 + 0.1 * facetId);
  tone *= mix(0.88, 1.12, crystals) * (0.92 + 0.16 * grain);
  tone = mix(tone, tone * vec3f(1.22, 1.0, 0.78), 0.45 * stain);
  tone *= 1.0 - 0.22 * streak;
  let lich = pStones(uv, 23, 71u, 0.2, 0.45, 0.8, 0.12);
  let onLich = lich.h > 0.0 && crack < 0.2;
  let lichTone = select(vec3f(1.22, 1.28, 1.08), vec3f(1.45, 1.15, 0.75), fract(lich.id * 3.7) < 0.12);
  tone = select(tone, mix(tone, lichTone, 0.55), onLich);
  s.tone = tone * (1.0 - 0.6 * crack);
  s.rough = 0.05 * (grain - 0.5) + 0.06 * crack + select(0.0, 0.06, onLich);
  s.ao = cavity(s.h) * (1.0 - 0.6 * crack);
  return s;
}

// A leaf lying on the ground: an almond outline from stalk to tip with a midrib, so litter reads as leaves and not as blades.
struct Leaf {
  z : f32,       // depth order; -1 when no leaf covers the texel
  t : f32,       // 0 at the stalk, 1 at the tip
  id : f32,      // random 0..1 per leaf (colour pick)
  across : f32,  // 0 on the midrib, 1 at the edge
};

fn leafAt(uv : vec2f, n : i32, per : i32, seed : u32, len : vec2f, wid : f32) -> Leaf {
  let p = uv * f32(n);
  let c0 = vec2i(floor(p));
  var best = Leaf(-1.0, 0.0, 0.0, 0.0);
  for (var j = -bounds.x; j <= bounds.x; j++) {
    for (var i = -bounds.x; i <= bounds.x; i++) {
      let c = c0 + vec2i(i, j);
      let hc = hash2(wrapLattice(c, vec2i(n)), seed);
      for (var k = 0; k < per * bounds.x; k++) {
        let h1 = pcgh(hc + u32(k) * 2654435769u);
        let h2 = pcgh(h1);
        let h3 = pcgh(h2);
        let h4 = pcgh(h3);
        let d = p - (vec2f(c) + vec2f(f01(h1), f01(h2)));
        let l = mix(len.x, len.y, f01(h4));
        if (dot(d, d) > l * l) { continue; }
        let a = f01(h3) * TAU_D;
        let dir = vec2f(cos(a), sin(a));
        let t = dot(d, dir) / l;
        if (t < 0.0 || t > 1.0) { continue; }
        let curl = (f01(pcgh(h4)) - 0.5) * 0.3 * l * t * t;
        let across = dot(d, vec2f(-dir.y, dir.x)) - curl;
        let hw = wid * l * pow(sin(3.14159265 * t), 0.75) * (0.8 + 0.4 * f01(pcgh(h4 ^ 7u)));
        let z = f01(pcgh(h4 ^ 2654435769u));
        if (abs(across) < hw && z > best.z) { best = Leaf(z, t, f01(pcgh(h3 ^ 40503u)), abs(across) / max(hw, 1e-4)); }
      }
    }
  }
  return best;
}

// Broadleaf litter: three generations of fallen leaves (fresh ochre and tan on top, browner and darker below, skeletal and black in the
// mould), a few twigs, over dark humus that shows in the gaps.
fn litterTone(id : f32) -> vec3f {
  if (id < 0.14) { return vec3f(1.22, 1.06, 0.80); }
  if (id < 0.36) { return vec3f(1.05, 0.95, 0.84); }
  if (id < 0.58) { return vec3f(0.84, 0.78, 0.74); }
  if (id < 0.70) { return vec3f(1.12, 0.90, 0.72); }
  if (id < 0.86) { return vec3f(0.66, 0.60, 0.56); }
  return vec3f(0.46, 0.43, 0.42);
}

fn surfLitter(uv : vec2f) -> Surf {
  var s : Surf;
  let humus = pFbm(uv, 14, 3, 81u);
  s.h = 0.08 + 0.10 * humus;
  s.tone = vec3f(0.36, 0.33, 0.32) * (0.8 + 0.4 * humus);
  s.ao = 0.3;
  s.rough = 0.04;
  // Bottom layer: small, broken, dark leaf fragments.
  let a = leafAt(uv, 22, 3, 82u, vec2f(0.45, 0.9), 0.34);
  if (a.z >= 0.0) {
    s.h = 0.26 + 0.15 * a.z;
    s.tone = litterTone(0.55 + 0.45 * fract(a.id * 3.1)) * (0.6 + 0.3 * a.t);
    s.ao = 0.45;
    s.rough = 0.02;
  }
  // Top layer: whole leaves of mixed age and size, each its own brightness, with a midrib and veins.
  let b = leafAt(uv, 15, 3, 83u, vec2f(0.5, 0.95), 0.36);
  if (b.z >= 0.0) {
    let rib = 1.0 - smoothstep(0.0, 0.12, b.across);
    let vein = smoothstep(0.85, 1.0, abs(sin(TAU_D * (b.t * 5.0 + b.across * 1.5))));
    s.h = 0.5 + 0.25 * b.z + 0.08 * (1.0 - b.across * b.across);
    s.tone = litterTone(b.id) * (0.7 + 0.5 * fract(b.id * 7.3)) * (1.0 - 0.18 * rib - 0.08 * vein) * (0.9 + 0.15 * b.t);
    s.ao = mix(0.6, 1.0, 1.0 - b.across);
    s.rough = -0.06 + 0.04 * b.id;
  }
  let tw = strokeAt(uv, 4, 2, 84u, vec2f(0.6, 0.95), vec2f(0.012, 0.02), 0.1, 3.1);
  if (tw.z >= 0.0 && tw.z > 0.4) {
    s.h = max(s.h, 0.62 + 0.1 * tw.t);
    s.tone = vec3f(0.55, 0.48, 0.44) * (1.0 - 0.3 * tw.across);
    s.ao = 0.8;
  }
  return s;
}

// Conifer duff: a felt of needles in every direction, rusty below and greyer on top, cone scales and the odd small cone or twig.
fn surfNeedles(uv : vec2f) -> Surf {
  var s : Surf;
  let duff = pFbm(uv, 10, 3, 91u);
  s.h = 0.12 + 0.12 * duff;
  s.tone = vec3f(0.62, 0.50, 0.44) * (0.8 + 0.4 * duff);
  s.ao = 0.35;
  s.rough = 0.03;
  let a = strokeAt(uv, 40, 5, 92u, vec2f(0.6, 0.95), vec2f(0.03, 0.05), 0.15, 3.1);
  if (a.z >= 0.0) {
    s.h = 0.32 + 0.2 * a.z;
    s.tone = mix(vec3f(1.15, 0.95, 0.78), vec3f(0.88, 0.70, 0.55), fract(a.id * 2.3)) * 0.85;
    s.ao = 0.6;
  }
  let b = strokeAt(uv, 28, 5, 93u, vec2f(0.6, 0.95), vec2f(0.035, 0.05), 0.2, 3.1);
  if (b.z >= 0.0) {
    s.h = 0.55 + 0.22 * b.z;
    s.tone = select(vec3f(1.22, 1.00, 0.80), vec3f(1.05, 1.02, 0.95), b.id < 0.25) * (1.0 - 0.2 * b.across);
    s.ao = 0.9;
    s.rough = -0.04;
  }
  let cone = pStones(uv, 5, 94u, 0.12, 0.2, 0.45, 0.25);
  if (cone.h > 0.0) {
    let scales = 0.5 + 0.5 * sin(TAU_D * 9.0 * (cone.d.x + cone.d.y)) * sin(TAU_D * 9.0 * (cone.d.x - cone.d.y));
    s.h = max(s.h, 0.55 + 0.4 * cone.h);
    s.tone = vec3f(0.95, 0.70, 0.50) * (0.6 + 0.5 * scales);
    s.ao = 0.55 + 0.45 * cone.h;
  }
  return s;
}

// Moss cushions: domed tufts of two sizes packed together, a fine fuzzy grain, yellow-green tips and dark hollows between them.
fn surfMoss(uv : vec2f) -> Surf {
  var s : Surf;
  let big = pStones(uv, 9, 101u, 0.5, 0.85, 0.75, 1.0);
  let small = pStones(uv, 23, 102u, 0.45, 0.8, 0.8, 1.0);
  let fuzz = pNoise(uv, vec2i(260), 103u) * 0.5 + 0.5;
  let fuzz2 = pNoise(uv, vec2i(130), 104u) * 0.5 + 0.5;
  let h = max(0.55 * max(big.h, 0.0), 0.35 * max(small.h, 0.0) + 0.1);
  s.h = saturate(0.15 + h + 0.12 * (fuzz - 0.5) + 0.08 * (fuzz2 - 0.5));
  let id = select(small.id, big.id, big.h * 0.55 >= small.h * 0.35);
  let hue = mix(vec3f(0.85, 1.0, 0.9), vec3f(1.35, 1.25, 0.75), fract(id * 2.7));
  s.tone = hue * mix(0.45, 1.2, smoothstep(0.1, 0.7, s.h)) * (0.85 + 0.3 * fuzz);
  s.rough = 0.04 * (fuzz - 0.5);
  s.ao = mix(0.35, 1.0, smoothstep(0.1, 0.6, s.h));
  return s;
}

// Mud: a smooth slurry with shallow ripples and boot-sized dents that hold water (gloss), sunken pebbles and a few drying edges.
fn surfMud(uv : vec2f) -> Surf {
  var s : Surf;
  let base = pFbm(uv, 4, 4, 111u);
  let ripple = sin(TAU_D * (9.0 * uv.x + 3.0 * uv.y + 1.2 * pFbm(uv, 3, 2, 112u)));
  let dent = pStones(uv, 6, 113u, 0.25, 0.45, 0.6, 0.6);
  let peb = pStones(uv, 21, 114u, 0.15, 0.35, 0.7, 0.35);
  var h = 0.45 + 0.30 * (base - 0.5) + 0.03 * ripple - 0.18 * max(dent.h, 0.0);
  let pool = smoothstep(0.42, 0.30, h);
  var tone = mix(vec3f(0.80, 0.80, 0.82), vec3f(1.18, 1.12, 1.02), smoothstep(0.25, 0.65, h)) * (1.0 - 0.25 * pool);
  if (peb.h > 0.0) {
    h = max(h, 0.42 + 0.25 * peb.h);
    tone = stoneTone(peb.id) * 0.9;
  }
  s.h = saturate(h);
  s.tone = tone;
  s.rough = -0.30 * pool + 0.05 * smoothstep(0.55, 0.7, h);
  s.ao = 0.6 + 0.4 * smoothstep(0.2, 0.6, h);
  return s;
}

// Dry crusted earth: polygon plates whose edges curl up, wide dark cracks between them and a second, finer crack order inside the
// bigger plates; the crust is paler than the soil beneath.
fn surfCracked(uv : vec2f) -> Surf {
  var s : Surf;
  let w = 0.02 * vec2f(pNoise(uv, vec2i(9), 121u), pNoise(uv, vec2i(9), 122u));
  let big = pCell(uv + w, 7, 123u);
  let fine = pCell(uv + w * 1.7, 19, 124u);
  let e1 = big.f2 - big.f1;
  let e2 = fine.f2 - fine.f1;
  let crack1 = 1.0 - smoothstep(0.02, 0.07, e1);
  let crack2 = (1.0 - smoothstep(0.01, 0.04, e2)) * 0.7;
  let crack = max(crack1, crack2);
  let curl = smoothstep(0.25, 0.04, e1) * (1.0 - crack1);
  let grain = pNoise(uv, vec2i(220), 125u) * 0.5 + 0.5;
  s.h = saturate(0.55 + 0.12 * curl + 0.06 * (grain - 0.5) + 0.06 * (big.id - 0.5) - 0.5 * crack);
  s.tone = mix(vec3f(1.05, 1.02, 0.98), vec3f(0.85, 0.82, 0.80), big.id * 0.6) * (0.92 + 0.16 * grain) * (1.0 - 0.6 * crack) * (1.0 + 0.08 * curl);
  s.rough = 0.02 * (grain - 0.5);
  s.ao = cavity(s.h) * (1.0 - 0.5 * crack);
  return s;
}

// Talus: angular frost-split stones, larger and sharper than gravel, piled with dark voids between them; each stone has its own facet
// tilt, tone and the odd lichen spot.
fn surfScree(uv : vec2f) -> Surf {
  var s : Surf;
  let a = pCell(uv, 6, 131u);
  let b = pCell(uv + 0.5, 13, 132u);
  let gapA = smoothstep(0.02, 0.09, a.f2 - a.f1);
  let gapB = smoothstep(0.02, 0.07, b.f2 - b.f1);
  let angA = TAU_D * fract(a.id * 7.3);
  let angB = TAU_D * fract(b.id * 5.9);
  let faceA = 0.45 + 0.30 * a.id + dot(a.d, vec2f(cos(angA), sin(angA))) * 0.5;
  let faceB = 0.30 + 0.25 * b.id + dot(b.d, vec2f(cos(angB), sin(angB))) * 0.5;
  let grain = pFbm(uv, 50, 3, 133u);
  let useA = faceA * gapA > faceB * gapB;
  let h = select(faceB * gapB, faceA * gapA, useA);
  let id = select(b.id, a.id, useA);
  s.h = saturate(h + 0.12 * (grain - 0.5));
  let lich = smoothstep(0.78, 0.86, pNoise(uv, vec2i(40), 134u) * 0.5 + 0.5);
  s.tone = stoneTone(fract(id * 1.7)) * mix(0.35, 1.05, smoothstep(0.05, 0.5, h)) * (0.9 + 0.2 * grain);
  s.tone = mix(s.tone, vec3f(1.45, 1.5, 1.2), 0.6 * lich * step(0.2, h));
  s.rough = 0.04 * (grain - 0.5);
  s.ao = mix(0.2, 1.0, smoothstep(0.05, 0.45, h));
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
    case 7: { return surfLoam(uv); }
    case 8: { return surfMoss(uv); }
    case 9: { return surfLitter(uv); }
    case 10: { return surfNeedles(uv); }
    case 11: { return surfMud(uv); }
    case 12: { return surfCracked(uv); }
    default: { return surfScree(uv); }
  }
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let layer = i32(gid.z);
  let px = vec2i(gid.xy);
  let uv = (vec2f(px) + 0.5) / SIZE;
  let e = 1.0 / SIZE;
  // The centre and its four neighbours (for the slope) come from one call site in a loop the compiler cannot unroll (its count is read
  // at run time): five inlined copies of surf(), each holding all fourteen generators, made the pipeline take about 10 s to compile.
  var offs = array<vec2f, 5>(vec2f(0.0), vec2f(e, 0.0), vec2f(-e, 0.0), vec2f(0.0, e), vec2f(0.0, -e));
  var hs = array<f32, 5>(0.0, 0.0, 0.0, 0.0, 0.0);
  var c : Surf;
  for (var k = 0; k < 5 * bounds.x; k++) {
    let sk = surf(layer, uv + offs[k]);
    hs[k] = sk.h;
    if (k == 0) { c = sk; }
  }
  let dx = hs[1] - hs[2];
  let dy = hs[3] - hs[4];
  let slope = clamp(-vec2f(dx, dy) * relief(layer), vec2f(-0.95), vec2f(0.95));
  let albedo = srgbEncode(clamp(glBaseColor(layer) * c.tone, vec3f(0.0), vec3f(1.0)));
  textureStore(outA, px, layer, vec4f(albedo, c.h));
  textureStore(outB, px, layer, vec4f(slope * 0.5 + 0.5, saturate(glRoughness(layer) + c.rough), c.ao));
}
