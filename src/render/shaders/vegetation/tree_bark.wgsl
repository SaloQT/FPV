// Procedural bark for the tree shader, one pattern per bark type. Bark is evaluated on the limb's own cylinder: the angle round the limb (uv.x),
// metres along it (uv.y) and the limb's radius at that ring (the vertex phase byte), all times the instance scale. The pattern is therefore in
// real metres on every tree, runs on unbroken along a trunk and round its seam, and the furrows of a thick trunk are as wide as on a real one.
// `h` is the bark surface height: 0 in the bottom of a furrow, 1 on the face of a plate or ridge.
//
// Reference (what each pattern copies): pedunculate oak, deep braided vertical furrows that break mature ridges into blocks; Scots pine, thick
// grey-brown plates in deep fissures low down and thin papery orange flakes on the upper trunk and limbs; Norway spruce, thin red-brown bark of
// small round scales; silver birch, chalk-white papery bark with horizontal dark lenticels and black diamond fissures at the foot of old stems;
// beech, smooth elephant-grey bark with fine mottling; dead wood, silver-grey weathered timber split along the grain with scraps of bark left.
#include "vegetation/veg_noise.wgsl"

const BARK_OAK : u32 = 0u;
const BARK_PINE : u32 = 1u;
const BARK_BIRCH : u32 = 2u;
const BARK_BEECH : u32 = 3u;
const BARK_SPRUCE : u32 = 4u;
const BARK_DEAD : u32 = 5u;
// A bark vertex's phase byte is sqrt(radius / BARK_RADIUS_MAX) (meshBuilder.ts).
const BARK_RADIUS_MAX : f32 = 1.2;

struct BarkSurface {
  col : vec3f,
  rough : f32,
  // Ambient factor of the crevices and the depth (m) of the bark relief for the bump normal.
  cavity : f32,
  depth : f32,
  // Surface height for the bump normal: the bark's own, raised and roughened where moss covers it.
  h : f32,
};

// Point on the limb's cylinder in metres: x, y round the limb at its radius, z along it.
fn barkPoint(uv : vec2f, radius : f32, scale : f32) -> vec3f {
  let a = uv.x * TAU;
  return vec3f(radius * cos(a), radius * sin(a), uv.y * 64.0 * scale);
}

// Baked tileable noise (barkNoise.ts): 16 noise cells across the texture, so a coordinate in cells samples at p / 16. One filtered read
// replaces the eight hashed lattice corners of procedural noise.
@group(2) @binding(6) var barkNoiseTex : texture_3d<f32>;
const BARK_NOISE_CELLS : f32 = 16.0;

fn barkNoise4(p : vec3f) -> vec4f {
  return textureSampleLevel(barkNoiseTex, linearRepeat, p * (1.0 / BARK_NOISE_CELLS), 0.0);
}

// Gradient noise in about [-1, 1].
fn gnoise3(p : vec3f) -> f32 {
  return (barkNoise4(p).r - 0.5) * 2.5;
}

// A second, independent gradient noise.
fn gnoise3b(p : vec3f) -> f32 {
  return (barkNoise4(p).b - 0.5) * 2.5;
}

// Smooth noise in [0, 1] with a mean of 0.5 (the third baked channel, stretched to about the spread of value noise).
fn bvalue(p : vec3f) -> f32 {
  return saturate1(0.5 + (barkNoise4(p).g - 0.5) * 1.4);
}

// Cellular noise: x = roughly how far from the cell border toward its middle, y = gap to the second-nearest feature point (0 on a cell
// border), z = a slowly varying shade standing in for the cell's own random value.
fn cells3(p : vec3f) -> vec3f {
  let gap = barkNoise4(p).a * 0.7;
  return vec3f(0.6 - gap, gap, bvalue(p * 0.37 + 3.1));
}

// How much of a pattern of feature size `size` (m) survives at a pixel footprint `foot` (m): fades to its mean before it would alias.
fn barkDetail(size : f32, foot : f32) -> f32 {
  return 1.0 - smoothstep(0.25 * size, 0.6 * size, foot);
}

// Oak: mature bark is broken into long blocky ridges in vertical rows, split by deep furrows that braid round them; the ridge faces are
// rough with flakes and pits. Thin limbs are smooth grey-brown with fine cracks.
fn oakHeight(c : vec3f, r : f32, foot : f32) -> f32 {
  // Past the distance where the pattern has faded to its mean, skip the noise.
  if (foot >= 0.018) { return 0.6; }
  let warp = vec2f(gnoise3b(vec3f(c.xy * 4.0, c.z * 1.0) + 11.0), gnoise3(vec3f(c.xy * 4.0, c.z * 1.0) + 17.0));
  // Ridges a few centimetres wide and up to half a metre long: cells drawn out along the trunk, their borders the furrows, with a second
  // braided set of furrows splitting the long ridges unevenly.
  let cl = cells3(vec3f(c.xy * 12.0 + warp * 0.8, c.z * 1.3));
  let braid = abs(gnoise3(vec3f(c.xy * 20.0 + warp * 1.2, c.z * 3.0) + 29.0));
  var ridge = (smoothstep(0.0, 0.16, cl.y) * 0.85 + 0.15 * smoothstep(0.16, 0.4, cl.y)) * (0.6 + 0.4 * smoothstep(0.02, 0.3, braid));
  // The ridge faces are rough at every scale: flakes, pits and loose scales.
  let fine = barkDetail(0.004, foot);
  let q = vec3f(c.xy * 30.0, c.z * 9.0);
  let rough = gnoise3(q) * 0.45 + gnoise3b(q * 2.7 + 3.0) * 0.35 * fine + gnoise3(c * 150.0) * 0.3 * fine;
  ridge *= 0.78 + 0.22 * smoothstep(-0.8, 0.8, rough);
  let mature = smoothstep(0.05, 0.16, r);
  let young = 0.82 + 0.18 * smoothstep(0.0, 0.25, abs(gnoise3(vec3f(c.xy * 55.0, c.z * 12.0))));
  let h = mix(young, ridge, mature);
  return mix(0.6, h, barkDetail(mix(0.015, 0.03, mature), foot));
}

// Scots pine: how much of the bark at a point is the thick grey plated bark of the lower trunk (1) rather than the thin orange flakes of the
// upper trunk and limbs (0). The plates reach higher up a stouter trunk, and the boundary is ragged: tongues of plate run up between flakes.
fn pinePlated(c : vec3f, r : f32, height : f32) -> f32 {
  let reach = 3.0 + 22.0 * smoothstep(0.12, 0.45, r);
  let ragged = 1.6 * gnoise3(vec3f(c.xy * 1.5, c.z * 0.35) + 41.0);
  return smoothstep(0.08, 0.15, r) * smoothstep(reach + 1.5, reach - 1.5, height + ragged);
}

// Scots pine plate faces peel in layers: 1 where the grey outer layer is still on, 0 where it has flaked off and the layer under it shows.
fn pineLayer(c : vec3f) -> f32 {
  return smoothstep(0.45, 0.55, bvalue(vec3f(c.xy * 14.0, c.z * 6.0) + 31.0));
}

// Scots pine: thick plates a hand wide and up to two hands tall in a network of deep dark fissures, their faces flaking in layers; thin
// papery flakes on the upper trunk and limbs.
fn pineHeight(c : vec3f, r : f32, height : f32, foot : f32) -> f32 {
  if (foot >= 0.06) { return 0.6; }
  let thick = pinePlated(c, r, height);
  var h = 0.0;
  if (thick > 0.0) {
    let warp = vec2f(gnoise3(vec3f(c.xy * 3.0, c.z * 1.5) + 3.0), gnoise3b(vec3f(c.xy * 3.0, c.z * 1.5) + 8.0));
    let cl = cells3(vec3f(c.xy * 9.0 + warp * 1.2, c.z * 2.6));
    // Narrow, deep fissures of uneven width: the plate face drops steeply at its edge into a dark bottom. Shallower cracks split the long
    // plates across, so they are irregular polygons rather than lenses.
    let fissure = smoothstep(0.0, 0.08 + 0.08 * bvalue(c * 3.0 + 1.7), cl.y);
    let split = cells3(vec3f(c.xy * 16.0 + warp * 2.0, c.z * 9.0) + 13.0);
    let across = smoothstep(0.0, 0.1, split.y);
    // Plate faces flake in thin layers: terraced steps where a layer has come away, and pits, rather than a smooth face.
    let fine = barkDetail(0.005, foot);
    let layer = pineLayer(c);
    let flaky = layer * 0.6 + gnoise3(vec3f(c.xy * 30.0, c.z * 14.0)) * 0.25 + gnoise3(c * vec3f(80.0, 80.0, 40.0)) * 0.3 * fine;
    h += thick * fissure * (0.6 + 0.4 * across) * (0.72 + 0.08 * cl.z + 0.2 * flaky);
  }
  if (thick < 1.0) {
    let fl = smoothstep(0.0, 0.25, abs(gnoise3(vec3f(c.xy * 22.0, c.z * 9.0) + 9.0)));
    h += (1.0 - thick) * (0.8 + 0.2 * fl);
  }
  return mix(0.6, h, barkDetail(mix(0.012, 0.1, thick), foot));
}

// Norway spruce: thin bark of small rounded scales that lift at their edges. On an old trunk the scales lift in groups, so it also breaks
// into irregular patches a hand or two across with shallow cracks between them, which is the texture still seen from ten metres.
fn spruceHeight(c : vec3f, r : f32, foot : f32) -> f32 {
  if (foot >= 0.05) { return 0.65; }
  let w = vec2f(gnoise3(vec3f(c.xy * 3.0, c.z * 1.5) + 5.0), gnoise3b(vec3f(c.xy * 3.0, c.z * 1.5) + 2.0));
  let big = cells3(vec3f(c.xy * 6.0 + w * 0.6, c.z * 3.0));
  let coarse = 0.62 + 0.18 * smoothstep(0.0, 0.1, big.y) + 0.2 * big.z;
  var h = coarse;
  if (foot < 0.0072) {
    let warp = gnoise3(c * 9.0);
    let cl = cells3(vec3f(c.xy * 17.0 + warp * 0.4, c.z * 12.0));
    // Each scale is a low flake lifting at its edge; neighbours overlap, so the border is a small step, not a crack. The lifted lower edge of a scale casts a thin dark line, and the scale rises from it toward its upper end, where the next one overlaps.
    let lift = fract(c.z * 12.0 + 0.6 * cl.z + 0.25 * warp);
    let scale = 0.5 + 0.22 * smoothstep(0.0, 0.12, cl.y) + 0.14 * smoothstep(0.0, 0.15, lift) * (0.6 + 0.4 * lift) + 0.14 * smoothstep(-0.6, 0.6, gnoise3b(c * vec3f(60.0, 60.0, 40.0)));
    h = coarse * mix(0.84, scale, barkDetail(0.012, foot));
  } else {
    h = coarse * 0.84;
  }
  h = mix(0.85, h, smoothstep(0.03, 0.1, r));
  return mix(0.65, h, barkDetail(0.06, foot));
}

// Birch foot factor: old stems turn black and deeply fissured near the ground, the higher the thicker they are.
fn birchFoot(c : vec3f, r : f32, height : f32) -> f32 {
  // The edge of the black bark is ragged: tongues of it run up the fissures and white islands are left between them.
  let ragged = 0.3 * gnoise3(c * vec3f(3.0, 3.0, 1.5)) + 0.18 * gnoise3(c * vec3f(14.0, 14.0, 5.0));
  return smoothstep(0.3 + 8.0 * r, 0.1 + 3.0 * r, height + ragged) * smoothstep(0.06, 0.14, r);
}

// Position on the unrolled birch stem in metres: round it (angle times radius) and up it.
fn birchSheet(c : vec3f, r : f32) -> vec2f {
  return vec2f(atan2(c.y, c.x) * r, c.z);
}

// Lenticels: short dark dashes lying across the stem, a few millimetres tall and one to five centimetres long, in loose staggered rows.
fn birchLenticels(q : vec2f) -> f32 {
  let g = q * vec2f(1.0 / 0.06, 1.0 / 0.016);
  let row = floor(g.y);
  let x = g.x + hash21(vec2u(u32(i32(row) + 100000), 7u)) * 3.0;
  let cell = vec2f(floor(x), row);
  let id = vec2u(vec2i(cell) + vec2i(100000));
  if (hash21(id) > 0.55) { return 0.0; }
  let len = mix(0.15, 0.45, hash21(id + vec2u(3u, 0u)));
  let centre = mix(-0.25, 0.25, hash21(id + vec2u(0u, 5u)));
  let f = vec2f(fract(x) - 0.5 - centre, fract(g.y) - 0.5);
  // A lens: thickest in the middle, tapering to points at both ends.
  let t = min(abs(f.x) / len, 1.0);
  let thick = 0.22 * (1.0 - t * t);
  return (1.0 - smoothstep(len - 0.04, len, abs(f.x))) * (1.0 - smoothstep(thick * 0.55, thick, abs(f.y)));
}

// Black scars: rough dark patches wider than they are tall, where a branch was shed or the paper has cracked open, with ragged edges.
fn birchScars(q : vec2f, c : vec3f) -> f32 {
  let g = q * vec2f(1.0 / 0.5, 1.0 / 0.5);
  let cell = floor(g);
  let id = vec2u(vec2i(cell) + vec2i(100000));
  if (hash21(id + vec2u(11u, 0u)) > 0.3) { return 0.0; }
  let f = fract(g) - 0.5 - (vec2f(hash21(id + vec2u(1u, 1u)), hash21(id + vec2u(2u, 2u))) - 0.5) * 0.2;
  // A wide lens 12 to 34 cm across and under a third as tall, measured in metres (cells are 50 cm square).
  let reach = mix(0.06, 0.17, hash21(id + vec2u(4u, 9u)));
  let d = length(f * 0.5 / vec2f(reach, reach * 0.3));
  return 1.0 - smoothstep(0.75, 1.0, d + 0.25 * gnoise3(c * vec3f(25.0, 25.0, 12.0)));
}

// Rough black bark (the foot and the scars): small plates in a network of deep fissures, running mostly up the stem.
fn birchRough(c : vec3f) -> f32 {
  let w = vec2f(gnoise3(vec3f(c.xy * 5.0, c.z * 1.5) + 4.0), gnoise3b(vec3f(c.xy * 5.0, c.z * 1.5) + 9.0));
  // Long ridges up the stem between deep fissures, broken across by shallower cracks, their faces lumpy and corky.
  let ridge = cells3(vec3f(c.xy * 14.0 + w * 1.4, c.z * 2.5));
  let breaks = cells3(vec3f(c.xy * 9.0 + w, c.z * 9.0) + 17.0);
  let lumps = gnoise3(c * vec3f(45.0, 45.0, 25.0)) * 0.5 + gnoise3b(c * vec3f(120.0, 120.0, 80.0)) * 0.3;
  return smoothstep(0.0, 0.16, ridge.y) * (0.65 + 0.35 * smoothstep(0.0, 0.08, breaks.y)) * (0.78 + 0.22 * smoothstep(-0.8, 0.8, lumps));
}

// Silver birch: smooth paper with dark horizontal lenticel dashes and peeling strips, black scars, and at the foot of an old stem rough black
// fissured bark. y = how much of the point is black bark.
fn birchHeight(c : vec3f, r : f32, height : f32, foot : f32) -> vec2f {
  let q = birchSheet(c, r);
  let peel = smoothstep(0.55, 0.6, gnoise3(vec3f(c.xy * 2.5, c.z * 9.0) + 21.0));
  var h = 0.82 + 0.12 * peel;
  if (foot < 0.008) { h -= 0.36 * birchLenticels(q) * barkDetail(0.01, foot); }
  // Past the distance where single dashes resolve, the rows of lenticels still read as faint grey streaks across the stem.
  h -= 0.22 * smoothstep(0.45, 0.8, bvalue(vec3f(c.xy * 6.0, c.z * 30.0) + 2.0)) * (1.0 - barkDetail(0.01, foot)) * barkDetail(0.1, foot);
  let base = max(birchFoot(c, r, height), birchScars(q, c) * smoothstep(0.05, 0.12, r));
  if (base > 0.0) { h = mix(h, birchRough(c), base); }
  return vec2f(mix(0.75, h, barkDetail(0.01, foot)), base);
}

// Beech: almost smooth, with faint wrinkles.
fn beechHeight(c : vec3f, foot : f32) -> f32 {
  let w = gnoise3(vec3f(c.xy * 10.0, c.z * 4.0)) * 0.06 + gnoise3(c * 45.0) * 0.03 * barkDetail(0.005, foot);
  return 0.8 + w;
}

// Dead wood: weathered grain split by long cracks, with patches of bark still clinging to it.
fn deadHeight(c : vec3f, r : f32, foot : f32) -> vec2f {
  if (foot >= 0.0072) { return vec2f(0.6, 0.5); }
  let left = smoothstep(0.15, 0.3, gnoise3(vec3f(c.xy * 4.0, c.z * 1.6) + 13.0));
  let crack = smoothstep(0.0, 0.07, abs(gnoise3(vec3f(c.xy * 34.0, c.z * 1.3))));
  let grain = 0.5 + 0.5 * gnoise3(vec3f(c.xy * 110.0, c.z * 3.0));
  let wood = crack * (0.62 + 0.18 * grain * barkDetail(0.004, foot));
  let bark = 0.85 + 0.15 * smoothstep(0.02, 0.35, abs(gnoise3(vec3f(c.xy * 20.0, c.z * 5.0))));
  return vec2f(mix(0.6, mix(wood, bark, left), barkDetail(0.012, foot)), left);
}

// Bark surface height at a point: the bump normal differentiates this.
fn barkHeight(kind : u32, c : vec3f, r : f32, height : f32, foot : f32) -> f32 {
  switch kind {
    case BARK_PINE: { return pineHeight(c, r, height, foot); }
    case BARK_BIRCH: { return birchHeight(c, r, height, foot).x; }
    case BARK_BEECH: { return beechHeight(c, foot); }
    case BARK_SPRUCE: { return spruceHeight(c, r, foot); }
    case BARK_DEAD: { return deadHeight(c, r, foot).x; }
    default: { return oakHeight(c, r, foot); }
  }
}

// Photoscanned bark (barkScans.ts): `colour` = albedo + ambient occlusion, `surface` = normal X, Y (0.5 = flat) + height + roughness, one layer
// per scan. With the scans missing the arrays are one-layer stand-ins and the procedural bark above is used instead.
@group(2) @binding(8) var barkScanColour : texture_2d_array<f32>;
@group(2) @binding(9) var barkScanSurface : texture_2d_array<f32>;
@group(2) @binding(10) var barkScanSampler : sampler;

const SCAN_PINE_PLATES : i32 = 0;
const SCAN_PINE_FLAKES : i32 = 1;
const SCAN_OAK : i32 = 2;
const SCAN_SPRUCE : i32 = 3;
const SCAN_BEECH : i32 = 4;
const SCAN_BIRCH_PAPER : i32 = 5;
// Metres of bark one tile of each scan covers (tools/bark/build_bark_scans.py LAYERS; barkScans.test.ts checks they match).
const SCAN_METRES = array<f32, 6>(0.9, 1.1, 0.8, 0.8, 1.2, 0.7);
// Metres one tile covers up the limb: a tall scan is stored squeezed into its square tile whole, since it tiles only as a whole.
const SCAN_ALONG = array<f32, 6>(0.9, 1.1, 1.6, 0.8, 2.4, 0.7);

// Texture coordinates per metre of bark (round the limb, up it) of a scan layer.
fn scanPerMetre(layer : i32) -> vec2f { return vec2f(1.0 / SCAN_METRES[layer], 1.0 / SCAN_ALONG[layer]); }

fn barkScansReady() -> bool { return textureNumLayers(barkScanColour) > 1u; }

// Whether a bark type takes the scans; dead wood keeps its own procedural grain.
fn scannedKind(kind : u32) -> bool { return kind == BARK_PINE || kind == BARK_OAK || kind == BARK_SPRUCE || kind == BARK_BEECH || kind == BARK_BIRCH; }

// Position on the limb's unrolled surface in metres: round it and along it, with a per-tree offset. The angle wraps at uv.x = 0 / 1, where a
// tile does not meet itself, so a second position, turned half way round, takes over near the seam (`w` is its weight).
struct ScanCoords { a : vec2f, b : vec2f, w : f32 };

fn scanCoords(uv : vec2f, radius : f32, scale : f32, seed : f32) -> ScanCoords {
  let around = TAU * radius;
  let along = uv.y * 64.0 * scale;
  let off = vec2f(seed * 13.7, seed * 7.3);
  var s : ScanCoords;
  s.a = vec2f(uv.x * around, along) + off;
  s.b = vec2f(fract(uv.x + 0.5) * around, along) + off + vec2f(0.37, 0.0);
  s.w = 1.0 - smoothstep(0.02, 0.07, min(uv.x, 1.0 - uv.x));
  return s;
}

struct ScanSample { col : vec3f, ao : f32, nrm : vec2f, h : f32, rough : f32 };

fn scanRead(layer : i32, q : vec2f, gx : vec2f, gy : vec2f) -> ScanSample {
  let m = scanPerMetre(layer);
  let c = textureSampleGrad(barkScanColour, barkScanSampler, q * m, layer, gx * m, gy * m);
  let s = textureSampleGrad(barkScanSurface, barkScanSampler, q * m, layer, gx * m, gy * m);
  var o : ScanSample;
  o.col = c.rgb; o.ao = c.a; o.nrm = s.xy * 2.0 - 1.0; o.h = s.z; o.rough = s.w;
  return o;
}

fn scanMix(p : ScanSample, q : ScanSample, t : f32) -> ScanSample {
  var o : ScanSample;
  o.col = mix(p.col, q.col, t); o.ao = mix(p.ao, q.ao, t); o.nrm = mix(p.nrm, q.nrm, t); o.h = mix(p.h, q.h, t); o.rough = mix(p.rough, q.rough, t);
  return o;
}

// The scans one bark type reads and how much of the second (pine: the thin orange flakes above the plated lower trunk; birch: the rough
// black bark of the foot and scars over the white paper).
struct ScanLayers { first : i32, second : i32, t : f32 };

fn scanLayers(kind : u32, c : vec3f, r : f32, height : f32) -> ScanLayers {
  var l : ScanLayers;
  l.second = -1; l.t = 0.0;
  switch kind {
    case BARK_PINE: { l.first = SCAN_PINE_PLATES; l.second = SCAN_PINE_FLAKES; l.t = 1.0 - pinePlated(c, r, height); }
    case BARK_SPRUCE: { l.first = SCAN_SPRUCE; }
    case BARK_BEECH: { l.first = SCAN_BEECH; }
    case BARK_BIRCH: {
      l.first = SCAN_BIRCH_PAPER; l.second = SCAN_OAK;
      l.t = smoothstep(0.2, 0.6, max(birchFoot(c, r, height), birchScars(birchSheet(c, r), c) * smoothstep(0.05, 0.12, r)));
    }
    default: { l.first = SCAN_OAK; }
  }
  return l;
}

// One bark point from the scans, both seam positions and both layers blended.
fn scanAt(kind : u32, l : ScanLayers, s : ScanCoords, gx : vec2f, gy : vec2f) -> ScanSample {
  var o = scanRead(l.first, s.a, gx, gy);
  if (s.w > 0.0) { o = scanMix(o, scanRead(l.first, s.b, gx, gy), s.w); }
  o.col = scanGrade(kind, l.first, o.col);
  if (l.second >= 0 && l.t > 0.0) {
    var p = scanRead(l.second, s.a, gx, gy);
    if (s.w > 0.0) { p = scanMix(p, scanRead(l.second, s.b, gx, gy), s.w); }
    p.col = scanGrade(kind, l.second, p.col);
    o = scanMix(o, p, l.t);
  }
  return o;
}

// Height only, at a fixed mip, for parallax and the extreme displacement (no derivatives needed).
fn scanHeightLevel(l : ScanLayers, s : ScanCoords, level : f32) -> f32 {
  var h = textureSampleLevel(barkScanSurface, barkScanSampler, s.a * scanPerMetre(l.first), l.first, level).z;
  if (s.w > 0.0) { h = mix(h, textureSampleLevel(barkScanSurface, barkScanSampler, s.b * scanPerMetre(l.first), l.first, level).z, s.w); }
  if (l.second >= 0 && l.t > 0.0) {
    var g = textureSampleLevel(barkScanSurface, barkScanSampler, s.a * scanPerMetre(l.second), l.second, level).z;
    if (s.w > 0.0) { g = mix(g, textureSampleLevel(barkScanSurface, barkScanSampler, s.b * scanPerMetre(l.second), l.second, level).z, s.w); }
    h = mix(h, g, l.t);
  }
  return h;
}

// Depth (m) of the scanned relief per bark type: deep plates on old pine, deep oak furrows, shallow spruce scales, nearly smooth beech.
fn scanDepth(kind : u32, c : vec3f, r : f32, height : f32) -> f32 {
  let mature = smoothstep(0.05, 0.16, r);
  switch kind {
    case BARK_PINE: { return mix(0.006, 0.045, pinePlated(c, r, height)); }
    case BARK_OAK: { return mix(0.004, 0.035, mature); }
    case BARK_SPRUCE: { return 0.012 * mature; }
    case BARK_BEECH: { return 0.003; }
    default: { return 0.03 * mature; }
  }
}

// Albedo of each scan layer graded to the measured bark it stands for (the raw scans are brighter or darker and each was shot in its own
// light): Scots pine plates grey-brown about 0.12, its upper flakes orange, oak grey-brown about 0.1, spruce grey-brown, beech pale elephant
// grey, birch paper chalk white, and the oak scan as the birch's near-black foot.
fn scanGrade(kind : u32, layer : i32, col : vec3f) -> vec3f {
  let g = dot(col, vec3f(0.3, 0.55, 0.15));
  switch layer {
    // Warmer than the scan as shot: Scots pine plates are a red-brown grey, hue about 30 to 35 degrees on a sunlit trunk.
    case SCAN_PINE_PLATES: { return col * vec3f(0.54, 0.35, 0.23); }
    case SCAN_PINE_FLAKES: { return col * vec3f(1.5, 1.35, 1.2); }
    case SCAN_SPRUCE: { return mix(vec3f(g), col, 0.7) * 0.65; }
    case SCAN_BEECH: { return mix(vec3f(g), col, 0.25) * vec3f(0.62, 0.62, 0.66); }
    case SCAN_BIRCH_PAPER: { return mix(vec3f(g), col, 0.2) * vec3f(3.7, 3.6, 3.4); }
    default: {
      if (kind == BARK_BIRCH) { return vec3f(g) * 0.28; }
      return col * 0.5;
    }
  }
}

// Sun visibility of a bark point inside its own relief: a short march toward the sun over the height field; 1 = lit, 0 = in a furrow's
// shadow. `lt` is the sun direction in the surface frame (x round the limb, y along it, z out of the bark), `depth` the relief depth.
fn scanSunShadow(l : ScanLayers, s : ScanCoords, h0 : f32, lt : vec3f, depth : f32, level : f32) -> f32 {
  if (lt.z <= 0.02) { return 1.0; }
  // Horizontal metres the ray covers while it climbs one unit of height above the start.
  let run = lt.xy / lt.z * depth;
  var vis = 1.0;
  for (var i = 1; i <= 8; i++) {
    let t = f32(i) / 8.0;
    let rise = t * (1.0 - h0);
    var sh = s;
    sh.a += run * rise; sh.b += run * rise;
    let above = scanHeightLevel(l, sh, level) - (h0 + rise);
    vis = min(vis, 1.0 - saturate1(above * 6.0));
  }
  return vis;
}

// Parallax occlusion: the bark point seen along the view ray once the furrows sink below the surface. `vt` is the direction to the eye in
// the surface frame. Returns the coordinates offset to where the ray meets the height field.
fn scanParallax(l : ScanLayers, s : ScanCoords, vt : vec3f, depth : f32, steps : i32, level : f32) -> ScanCoords {
  let z = max(vt.z, 0.15);
  // The full relief depth seen from this angle shifts the point by `shift` metres across the bark.
  let shift = -vt.xy / z * depth;
  var prevDepth = 0.0;
  var prevGap = 1.0 - scanHeightLevel(l, s, level);
  var o = s;
  for (var i = 1; i <= steps; i++) {
    let d = f32(i) / f32(steps);
    var p = s;
    p.a += shift * d; p.b += shift * d;
    let gap = (1.0 - scanHeightLevel(l, p, level)) - d;
    if (gap <= 0.0) {
      // Between the last step above the surface and this one below it.
      let t = prevGap / max(prevGap - gap, 1e-4);
      let dd = mix(prevDepth, d, t);
      o.a = s.a + shift * dd; o.b = s.b + shift * dd;
      return o;
    }
    prevDepth = d; prevGap = gap;
    o = p;
  }
  return o;
}

// Moss and lichen amounts (x, y) of each bark type, as barkSurface sets them.
fn barkWeatherAmounts(kind : u32) -> vec2f {
  switch kind {
    case BARK_PINE: { return vec2f(0.35, 1.0); }
    case BARK_BIRCH: { return vec2f(0.4, 0.1); }
    case BARK_BEECH: { return vec2f(0.7, 0.8); }
    case BARK_SPRUCE: { return vec2f(0.6, 0.45); }
    case BARK_DEAD: { return vec2f(0.8, 1.0); }
    default: { return vec2f(1.0, 1.0); }
  }
}

// Parallax and the furrow shadow run while a pixel covers less than this much bark (m): nearer than about 10 m at 1080p.
const SCAN_POM_FOOTPRINT : f32 = 0.008;

struct ScanBark { s : BarkSurface, n : vec3f, sunOcc : f32 };

// The scanned bark at a fragment: parallax into the relief, the scan's albedo (graded per species), ambient occlusion, normal and roughness,
// the furrows' shadow on the sunlight, then lichen, moss and the wet foot. `n` is the smooth surface normal, `toEye` the direction to the eye,
// `sun` the direction to the sun, `detail` whether this LOD and tier take the parallax and furrow shadow, `steps` the parallax steps.
fn scanBark(kind : u32, uv : vec2f, radius : f32, scale : f32, height : f32, seed : f32, c : vec3f, n : vec3f, dpx : vec3f, dpy : vec3f,
    footprint : f32, toEye : vec3f, sun : vec3f, detail : bool, steps : i32) -> ScanBark {
  let layers = scanLayers(kind, c, radius, height);
  var sc = scanCoords(uv, radius, scale, seed);
  // Surface frame from the screen derivatives of the bark coordinates (continuous on whichever side of the seam carries the weight).
  var gx = dpdx(sc.a);
  var gy = dpdy(sc.a);
  if (sc.w > 0.5) { gx = dpdx(sc.b); gy = dpdy(sc.b); }
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  var t = r1 * gx.x + r2 * gy.x;
  var b = r1 * gx.y + r2 * gy.y;
  t = normalize(t - n * dot(n, t) + vec3f(1e-6, 0.0, 0.0));
  b = normalize(b - n * dot(n, b) + vec3f(0.0, 1e-6, 0.0));
  let depth = scanDepth(kind, c, radius, height);
  let texels = f32(textureDimensions(barkScanSurface).x);
  let level = max(log2(max(footprint, 1e-5) * texels / SCAN_METRES[layers.first]), 0.0);
  let near = detail && footprint < SCAN_POM_FOOTPRINT && depth > 0.003;
  if (near) {
    let vt = vec3f(dot(toEye, t), dot(toEye, b), dot(toEye, n));
    sc = scanParallax(layers, sc, vt, depth, steps, level);
  }
  let ss = scanAt(kind, layers, sc, gx, gy);
  var o : ScanBark;
  // The scans' normals are OpenGL style (green up the image); the bark coordinate runs up the limb while the image's v runs down it.
  // Beech bark is nearly smooth: the scan's fine fissures are kept faint on it.
  let relief = select(1.0, 0.4, kind == BARK_BEECH);
  let nt = vec3f(ss.nrm.x * relief, -ss.nrm.y * relief, sqrt(saturate1(1.0 - dot(ss.nrm, ss.nrm))));
  o.n = normalize(t * nt.x + b * nt.y + n * max(nt.z, 0.05));
  o.sunOcc = 0.0;
  if (near) {
    let lt = vec3f(dot(sun, t), dot(sun, b), dot(sun, n));
    o.sunOcc = 1.0 - scanSunShadow(layers, sc, ss.h, lt, depth, level);
  }
  var s : BarkSurface;
  s.col = ss.col;
  if (kind == BARK_BIRCH) {
    // The birch paper keeps its procedural marks over the scanned relief: dark horizontal lenticels and buff where a strip has peeled.
    let bh = birchHeight(c, radius, height, footprint);
    let lent = smoothstep(0.8, 0.45, bh.x) * (1.0 - layers.t);
    let peel = smoothstep(0.55, 0.6, gnoise3(vec3f(c.xy * 2.5, c.z * 9.0) + 21.0)) * 0.5 * (1.0 - layers.t);
    s.col = mix(mix(s.col, vec3f(0.4, 0.3, 0.25), peel), vec3f(0.06, 0.045, 0.035), lent);
  }
  // Dry bark is matte: the scans' roughness only varies it between 0.85 and 1.
  s.rough = mix(0.85, 1.0, ss.rough);
  // The scan's own occlusion, deepened in the bottoms of the furrows.
  s.cavity = mix(0.45, 1.0, ss.ao) * mix(0.75, 1.0, smoothstep(0.0, 0.45, ss.h));
  s.depth = depth;
  s.h = ss.h;
  let amounts = barkWeatherAmounts(kind);
  let twig = 1.0 - smoothstep(0.012, 0.035, radius);
  o.s = barkWeathering(s, c, radius, ss.h, height, n, barkFine(footprint), seed, amounts.x, amounts.y, twig);
  return o;
}

// Bark relief displacement at the extreme tier: the vertex shader pushes a finely cut near trunk in along its normal by this much (m, 0 or
// less), so furrows and fissures sink below the plate faces and break the outline. Only relief at least a few vertices across is used (the
// height is taken at RELIEF_FOOTPRINT, about the vertex spacing); the fragment bump adds the finer detail on top. The depth per bark type
// matches barkSurface's bump depth.
const RELIEF_FOOTPRINT : f32 = 0.012;
const RELIEF_GAIN : f32 = 2.0;

fn barkDisplacement(kind : u32, c : vec3f, r : f32, height : f32, uv : vec2f, scale : f32, seed : f32) -> f32 {
  // With the scans the displacement follows the scanned height, so the geometry, the parallax and the normal agree; the birch only on its black
  // foot and scars.
  if (barkScansReady() && scannedKind(kind)) {
    var weight = 1.0;
    if (kind == BARK_BIRCH) { weight = max(birchFoot(c, r, height), birchScars(birchSheet(c, r), c) * smoothstep(0.05, 0.12, r)); }
    let depth = scanDepth(kind, c, r, height) * weight;
    if (depth < 0.004) { return 0.0; }
    let h = scanHeightLevel(scanLayers(kind, c, r, height), scanCoords(uv, r, scale, seed), 2.0);
    return -depth * (1.0 - h);
  }
  var depth = 0.0;
  switch kind {
    case BARK_PINE: { depth = mix(0.003, 0.05, pinePlated(c, r, height)); }
    case BARK_BIRCH: {
      let q = birchSheet(c, r);
      depth = mix(0.0025, 0.025, max(birchFoot(c, r, height), birchScars(q, c) * smoothstep(0.05, 0.12, r)));
    }
    case BARK_BEECH: { depth = 0.002; }
    case BARK_SPRUCE: { depth = 0.018; }
    case BARK_DEAD: { depth = 0.008; }
    default: { depth = mix(0.003, 0.026, smoothstep(0.05, 0.16, r)); }
  }
  if (depth < 0.006) { return 0.0; }
  let h = barkHeight(kind, c, r, height, RELIEF_FOOTPRINT);
  return min(depth * RELIEF_GAIN * (h - 0.9), 0.0);
}

// Crustose lichen (Lepraria, Lecanora and the like): pale grey-green, powdery crusts flat on the raised bark, in patches from a hand to a
// forearm wide that merge on old trunks; a patch is paler and greener at its growing rim, and the crust is broken into granules. It keeps to the
// plate faces and leaves the furrows dark. `amount` 1 covers about a fifth of the bark. Returns the lichen colour and its cover.
// Weight of the fine weathering noise for a pixel covering `footprint` metres of bark: full under 1.2 cm, none past 2 cm.
fn barkFine(footprint : f32) -> f32 { return 1.0 - smoothstep(0.012, 0.02, footprint); }

fn crustLichen(c : vec3f, h : f32, seed : f32, amount : f32, fine : f32) -> vec4f {
  let p = c * vec3f(1.0, 1.0, 0.6) + vec3f(seed * 5.1);
  let blotch = bvalue(p * 3.5) * 0.65 + bvalue(p * 9.0 + 2.0) * 0.35;
  var grain = 0.5;
  if (fine > 0.0) { grain = mix(0.5, bvalue(p * 60.0) * 0.6 + bvalue(p * 150.0 + 4.0) * 0.4, fine); }
  let cut = 0.74 - 0.12 * amount;
  let cover = smoothstep(cut, cut + 0.06, blotch + 0.3 * (grain - 0.5)) * smoothstep(0.35, 0.7, h);
  // Pale at the rim of a patch, greyer and a little darker at its old centre.
  let rim = 1.0 - smoothstep(cut + 0.04, cut + 0.16, blotch);
  let col = mix(vec3f(0.17, 0.19, 0.16), vec3f(0.24, 0.27, 0.2), rim) * (0.8 + 0.4 * grain);
  return vec4f(col, cover * 0.75);
}

// Colour, roughness, crevice shading and relief depth of the bark at a point with surface height `h`. `c` is the cylinder point, `r` the limb
// radius, `height` metres above the tree's foot, `nw` the world normal of the limb (moss takes the north side, -Z, and the tops of limbs), and
// `seed` varies the tree.
fn barkSurface(kind : u32, c : vec3f, r : f32, h : f32, height : f32, nw : vec3f, foot : f32, seed : f32) -> BarkSurface {
  var s : BarkSurface;
  // Fine noise (specks, moss texture) is only worth evaluating while a pixel covers less than about 2 cm of bark.
  let near = foot < 0.02;
  let tone = 0.9 + 0.2 * bvalue(vec3f(c.xy * 2.0, c.z * 0.7) + vec3f(seed * 30.0));
  let twig = 1.0 - smoothstep(0.012, 0.035, r);
  var mossAmount = 1.0;
  var lichenAmount = 1.0;
  s.rough = 0.92;
  s.h = h;
  switch kind {
    case BARK_PINE: {
      let thick = pinePlated(c, r, height);
      // Grey-brown plate faces, weathered paler grey on their outer layer, with patches of red-brown where a flake has come away; the
      // fissures are nearly black. Higher up, thin papery flakes of orange-brown, paler where they curl away from the stem.
      // The same layers pineHeight terraces: where the grey outer layer has flaked off, the red-brown layer under it shows.
      var flakeOff = 0.3;
      if (near) { flakeOff = 1.0 - pineLayer(c); }
      let weathered = bvalue(vec3f(c.xy * 3.0, c.z * 1.2) + 7.0);
      let face = mix(vec3f(0.12, 0.1, 0.085), vec3f(0.17, 0.155, 0.14), smoothstep(0.35, 0.8, weathered));
      let plate = mix(vec3f(0.06, 0.045, 0.036), mix(face, vec3f(0.14, 0.08, 0.052), flakeOff * 0.8), smoothstep(0.55, 0.85, h));
      let fissure = vec3f(0.022, 0.016, 0.012);
      let lower = mix(fissure, plate, smoothstep(0.15, 0.6, h));
      let flake = mix(vec3f(0.17, 0.08, 0.04), vec3f(0.3, 0.15, 0.075), smoothstep(0.8, 1.0, h));
      s.col = mix(flake, lower, thick) * tone;
      s.cavity = mix(0.9, mix(0.15, 1.0, smoothstep(0.05, 0.6, h)), thick);
      s.depth = mix(0.003, 0.05, thick);
      s.rough = mix(0.8, 0.95, thick);
      mossAmount = 0.35;
      lichenAmount = 1.0;
    }
    case BARK_BIRCH: {
      let b = birchHeight(c, r, height, foot);
      let paper = vec3f(0.6, 0.58, 0.53) * (0.86 + 0.14 * bvalue(vec3f(c.xy * 3.0, c.z * 12.0) + vec3f(seed)));
      // Pinkish-buff where the outer paper has peeled away in horizontal strips.
      let peeled = smoothstep(0.55, 0.6, gnoise3(vec3f(c.xy * 2.5, c.z * 9.0) + 21.0)) * 0.5 * (0.6 + 0.4 * bvalue(c * vec3f(30.0, 30.0, 4.0)));
      var white = mix(paper, vec3f(0.4, 0.3, 0.25), peeled);
      white = mix(vec3f(0.05, 0.036, 0.03), white, smoothstep(0.42, 0.7, h));
      // The black foot: near-black fissures, grey weathered ridges, and the odd fleck of white paper left on a ridge.
      let ridgeGrey = mix(vec3f(0.035, 0.032, 0.03), vec3f(0.1, 0.095, 0.09), bvalue(c * vec3f(18.0, 18.0, 6.0)));
      let black = mix(vec3f(0.015, 0.013, 0.012), ridgeGrey, smoothstep(0.5, 0.95, h));
      s.col = mix(white, black, smoothstep(0.25, 0.55, b.y));
      s.col = mix(s.col, vec3f(0.08, 0.045, 0.03) * (0.7 + 0.5 * h), twig);
      s.cavity = mix(0.95, mix(0.4, 1.0, h), b.y);
      s.depth = mix(0.0025, 0.025, b.y);
      s.rough = mix(0.7, 0.92, b.y);
      mossAmount = 0.4;
      lichenAmount = 0.4;
    }
    case BARK_BEECH: {
      let mottle = bvalue(vec3f(c.xy * 5.0, c.z * 2.0) + vec3f(seed * 9.0)) + 0.3 * bvalue(c * 25.0);
      s.col = mix(vec3f(0.19, 0.19, 0.18), vec3f(0.31, 0.3, 0.285), smoothstep(0.35, 1.0, mottle)) * (0.92 + 0.6 * (h - 0.8));
      // Green algae film on the weather side, common on smooth beech bark.
      s.col = mix(s.col, vec3f(0.11, 0.14, 0.07), 0.4 * smoothstep(0.55, 0.8, bvalue(c * 1.8 + vec3f(seed))) * smoothstep(-0.2, 0.6, -nw.z));
      s.col = mix(s.col, vec3f(0.11, 0.08, 0.06), twig);
      s.cavity = 0.95;
      s.depth = 0.002;
      s.rough = 0.75;
      mossAmount = 0.7;
      lichenAmount = 0.8;
    }
    case BARK_SPRUCE: {
      // Grey-brown weathered scale faces, each patch its own shade, over red-brown fresh bark showing at the scale edges; the cracks between
      // patches are dark.
      let weathered = bvalue(vec3f(c.xy * 9.0, c.z * 4.0) + 5.0);
      let face = mix(vec3f(0.085, 0.075, 0.065), vec3f(0.13, 0.12, 0.108), smoothstep(0.3, 0.75, weathered));
      let fresh = vec3f(0.095, 0.06, 0.042);
      let scale = mix(mix(vec3f(0.035, 0.028, 0.022), fresh, smoothstep(0.35, 0.55, h)), face, smoothstep(0.55, 0.75, h));
      // Branches are darker than the stem: brown-grey wood with red-brown fresh bark, the pale weathered grey only on the old trunk.
      let branch = 1.0 - smoothstep(0.04, 0.14, r);
      s.col = mix(mix(scale, scale * vec3f(0.62, 0.55, 0.5), branch), vec3f(0.06, 0.042, 0.03), twig) * tone;
      s.cavity = mix(0.45, 1.0, smoothstep(0.4, 0.75, h));
      s.depth = 0.018;
      mossAmount = 0.8;
      lichenAmount = 0.8;
    }
    case BARK_DEAD: {
      let d = deadHeight(c, r, foot);
      let wood = mix(vec3f(0.06, 0.055, 0.05), vec3f(0.27, 0.255, 0.23), smoothstep(0.3, 0.85, h)) * (0.85 + 0.3 * bvalue(vec3f(c.xy * 6.0, c.z * 0.5)));
      let bark = mix(vec3f(0.03, 0.025, 0.02), vec3f(0.1, 0.08, 0.062), smoothstep(0.85, 1.0, h));
      s.col = mix(wood, bark, d.y);
      s.cavity = mix(0.55, 1.0, h);
      s.depth = 0.008;
      s.rough = mix(0.85, 0.95, d.y);
      mossAmount = 0.8;
      lichenAmount = 1.0;
    }
    default: {
      var face = 1.0;
      if (near) { face = 0.78 + 0.3 * bvalue(vec3f(c.xy * 40.0, c.z * 15.0)) + 0.15 * bvalue(c * 130.0); }
      let plate = mix(vec3f(0.075, 0.065, 0.055), vec3f(0.125, 0.115, 0.1) * face, smoothstep(0.65, 1.0, h));
      let furrow = vec3f(0.028, 0.02, 0.015);
      let mature = smoothstep(0.05, 0.16, r);
      let young = vec3f(0.12, 0.105, 0.085) * (0.8 + 0.3 * h);
      s.col = mix(young, mix(furrow, plate, smoothstep(0.08, 0.6, h)), mature) * tone;
      s.cavity = mix(0.9, mix(0.3, 1.0, smoothstep(0.0, 0.65, h)), mature);
      s.depth = mix(0.003, 0.026, mature);
    }
  }
  return barkWeathering(s, c, r, h, height, nw, barkFine(foot), seed, mossAmount, lichenAmount, twig);
}

// Lichen, moss and the wet foot over a bark surface `s0` of height `h` (shared by the procedural and the scanned bark).
// How forest-grown the tree is (0 open-grown to 1 a long bare bole under a closed canopy), set per pixel by the caller (tree.wgsl) for oak
// and beech: such trunks stand in damp shade, so they carry more moss, higher up the north side, and their bark between the moss is
// darker. Photo trunks in a beech wood measure about 0.9 stop darker against the frame than open-grown ones lit by the sky.
var<private> barkForest : f32 = 0.0;

// `fine` (0 to 1, barkFine) weighs in the fine noise: faded in, not switched on, so the edges of moss and lichen do not jump along the line on
// a trunk where the pixel footprint crosses the threshold.
fn barkWeathering(s0 : BarkSurface, c : vec3f, r : f32, h : f32, height : f32, nw : vec3f, fine : f32, seed : f32, mossAmount : f32, lichenAmount : f32, twig : f32) -> BarkSurface {
  var s = s0;
  // Crustose lichen: pale grey-green crusts on the raised bark, in patches a hand to a forearm wide (crustLichen).
  let l = crustLichen(c, h, seed, lichenAmount, fine) * (1.0 - twig * 0.5);
  s.col = mix(s.col, l.rgb, l.a);
  s.rough = mix(s.rough, 1.0, l.a);
  // Moss: thickest round the foot and over the root swell, climbing the north (-Z) side and lying on the tops of near-level limbs. It fills
  // the furrows first and spreads over the plates only where it is thick, so its edge follows the bark relief; the edge is soft and frayed,
  // and the moss itself is a mat of small cushions, bright on their tops and dark between them.
  // Round the foot the moss is a mat on the shaded north side and in patches elsewhere, so the root flare and the surface roots keep bark
  // showing between the patches instead of wearing a solid green skirt.
  let foot01 = smoothstep(0.9 + 0.8 * seed, 0.0, height) * (0.45 + 0.55 * smoothstep(-0.3, 0.7, -nw.z));
  let north = smoothstep(-0.1, 0.8, -nw.z) * smoothstep(3.0 + 4.0 * seed + 5.0 * barkForest, 0.2, height) * (0.55 + 0.3 * barkForest);
  let top = smoothstep(0.5, 0.9, nw.y) * smoothstep(0.05, 0.15, r) * 0.5;
  // (select() would evaluate both sides, so the fine terms sit behind ifs.) Patches a hand wide break the mat up at every distance.
  var patchy = bvalue(vec3f(c.xy * 4.0, c.z * 2.0) + vec3f(seed * 17.0)) + 0.3 * (bvalue(c * 12.0 + 5.0) - 0.5);
  var cushion = 0.5;
  if (fine > 0.0) {
    patchy += fine * (0.35 * (bvalue(c * 45.0) - 0.5) + 0.2 * (bvalue(c * 110.0) - 0.5));
    cushion = mix(0.5, 0.6 * bvalue(c * 70.0) + 0.4 * bvalue(c * 180.0 + 9.0), fine);
  }
  let want = max(foot01 * 1.1, max(north, top)) * mossAmount * (1.0 + 0.8 * barkForest) * (0.45 + 0.6 * seed);
  let moss = smoothstep(0.88 - want, 1.12 - want, patchy + 0.45 * (0.65 - h)) * (1.0 - twig);
  // Thin moss at the edge of a patch is a yellower, sparser film; the thick mat is deeper green.
  let mossCol = mix(vec3f(0.032, 0.042, 0.016), mix(vec3f(0.075, 0.08, 0.03), vec3f(0.06, 0.085, 0.025), moss), smoothstep(0.15, 0.85, cushion));
  s.col = mix(s.col, mossCol, moss);
  s.rough = mix(s.rough, 1.0, moss);
  // Damp, shaded bark of a forest-grown trunk.
  s.col *= 1.0 - 0.25 * barkForest * (1.0 - moss);
  // The mat sits proud of the bark and fills its furrows; its own surface is the cushions.
  s.h = mix(h, max(h, 0.7) + 0.35 * (cushion - 0.5), moss);
  s.depth = mix(s.depth, max(s.depth, 0.012), moss);
  s.cavity = mix(s.cavity, 0.7 + 0.3 * smoothstep(0.2, 0.8, cushion), moss);
  // Soil splashed up by rain over the lowest hand-widths of bark, and the bark darkened where it meets the ground (the litter round the foot
  // shades it from the sky).
  let splash = smoothstep(0.3, 0.0, height + 0.1 * gnoise3(c * 9.0)) * (1.0 - moss);
  s.col = mix(s.col, vec3f(0.075, 0.058, 0.042), 0.55 * splash);
  s.cavity *= mix(0.5, 1.0, smoothstep(0.0, 0.4, height));
  // Wet, darker bark just above the soil, where splash and ground damp keep it moist.
  let wet = smoothstep(0.4, 0.0, height + 0.12 * gnoise3(c * 5.0));
  s.col *= 1.0 - 0.35 * wet;
  s.rough = mix(s.rough, 0.6, wet * (1.0 - moss));
  return s;
}
