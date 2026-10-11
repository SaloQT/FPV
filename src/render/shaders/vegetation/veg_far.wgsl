// Far-field canopy: one camera-facing card per clump of trees (treePlanFar.ts). The cards stand in for trees the real instances do not
// cover: beyond the tree draw distance (they dither in over the same band the real trees dither out of) and over ground where the tree
// instance cap left no trees at all. A card is drawn as up to three procedural crowns (cones for conifers, ellipses for broadleaves) with
// a ragged edge and a rounded normal, so the sun, sky and aerial perspective shade it like the real canopy. All culling is in the vertex
// shader (a rejected card collapses to a point outside the clip volume); the draw is 4 vertices per card.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_noise.wgsl"
#include "terrain/gbuffer.wgsl"

struct Card {
  pos : vec3f,
  height : f32,
  width : f32,
  tint : u32,   // unorm8x4 colour multiplier, decoded as value * 2
  near : f32,   // camera distance the card shows from; 0 = the real-tree draw distance
  info : u32,   // species 3 bits | lobes - 1 2 bits | 16-bit random
};

@group(2) @binding(1) var<storage, read> cards : array<Card>;

const FOLIAGE_ID : f32 = 5.0;
// Same band as the real trees' fade-out in tree.wgsl.
const FADE_START : f32 = 0.86;
const FADE_END_START : f32 = 0.88;
// Far-LOD blobs of the real trees are painted this much darker than the leaf tone (tree.wgsl BLOB_DARKEN).
const DARKEN : f32 = 0.78;
// Conifer needles are shaded darker and less blue than their tone (tree.wgsl NEEDLE_SHADE).
const NEEDLE_SHADE : vec3f = vec3f(0.55, 0.6, 0.4);
const SINK : f32 = 0.05;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) uv : vec2f,                       // metres from the card's bottom centre
  @location(2) @interpolate(flat) card : vec4f,  // xy = horizontal direction to the camera, zw = card size (m)
  @location(3) @interpolate(flat) ids : vec4u,   // x = tint, y = info, z = card index
  @location(4) @interpolate(flat) fade : vec2f,  // draws where t >= 1 - x and t < y
};

// Leaf albedo and translucency of spruce, pine, oak and birch: defines from the variant table (farToneDefines in treePlanFar.ts).
fn toneOf(species : u32) -> vec4f {
  switch (species) {
    case 0u: { return vec4f(${TONE0}); }
    case 1u: { return vec4f(${TONE1}); }
    case 2u: { return vec4f(${TONE2}); }
    default: { return vec4f(${TONE3}); }
  }
}

@vertex
fn vs(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VsOut {
  let c = cards[iid];
  let mid = c.pos + vec3f(0.0, 0.5 * c.height, 0.0);
  let toCam = frame.camPos.xyz - mid;
  let d = length(toCam);
  let near = select(c.near, vp.tree.y, c.near <= 0.0);
  let fadeIn = smoothstep(FADE_START * near, near, d);
  let fadeOut = 1.0 - smoothstep(FADE_END_START * vp.far.x, vp.far.x, d);
  var o : VsOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (fadeIn <= 0.0 || fadeOut <= 0.0 || !frustumSphereVisible(mid, 0.5 * length(vec2f(c.width, c.height)))) { return o; }
  let horiz = normalize(vec2f(toCam.x, toCam.z) + vec2f(1.0e-4, 0.0));
  let right = vec3f(horiz.y, 0.0, -horiz.x);
  let u = select(-0.5, 0.5, (vid & 1u) == 1u) * c.width;
  let v = select(0.0, c.height, (vid & 2u) == 2u);
  let world = c.pos + right * u + vec3f(0.0, v - SINK * c.height, 0.0);
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.uv = vec2f(u, v);
  o.card = vec4f(horiz, c.width, c.height);
  o.ids = vec4u(c.tint, c.info, iid, 0u);
  o.fade = vec2f(fadeIn, fadeOut);
  return o;
}

fn ditherThreshold(px : vec2u, id : u32) -> f32 {
  var t = textureLoad(blueNoise, vec2i(px & vec2u(127u)), 0).x + hash11(id);
  if ((frame.misc.y & 4u) != 0u) { t += f32(frame.misc.x & 255u) * 0.6180339887; }
  return fract(t);
}

struct Crown {
  inside : bool,
  local : vec2f,   // x in -1..1 across the crown, y in 0..1 up it
  shade : f32,     // the crown's own brightness: neighbouring trees in one card differ in vigour and light
};

fn noise2(p : vec2f, s : f32) -> f32 { return vnoise3(vec3f(p, s)); }

// Is metre position `p` inside crown `k` of the card? Conifers are cones with a serrated edge, broadleaves lumpy ellipses.
fn crown(k : u32, lobes : u32, conifer : bool, p : vec2f, width : f32, height : f32, rnd : u32, fine : bool) -> Crown {
  var r = vec3f(u01(pcg(rnd * 7u + k * 131u + 1u)), u01(pcg(rnd * 13u + k * 17u + 5u)), u01(pcg(rnd * 29u + k * 61u + 9u)));
  var cr : Crown;
  cr.inside = false;
  cr.local = vec2f(0.0);
  cr.shade = 0.72 + 0.5 * u01(pcg(rnd * 41u + k * 977u + 3u));
  let cx = select((r.x - 0.5) * 0.55 * width, 0.0, lobes == 1u && k == 0u);
  let h = height * select(0.62 + 0.38 * r.y, 1.0, k == 0u);
  let jag = noise2(p * select(1.3, 0.9, conifer), f32(k) * 3.7 + 1.0) - 0.5;
  if (conifer) {
    let base = 0.07 * h;
    let ly = (p.y - base) / max(h - base, 1.0e-3);
    if (ly < 0.0 || ly > 1.0) { return cr; }
    var half = (0.17 + 0.05 * r.z) * h * pow(1.0 - ly, 0.8) + 0.4;
    var edge = 0.45 * jag * (1.0 - ly * 0.6);
    if (fine) {
      // Whorls: each ring of branches droops out wide at its tip and the next ring starts narrower, a saw-toothed spruce outline, and the
      // needle sprays fray the edge finely.
      let tier = fract((p.y - base) / 1.1 + r.x);
      half *= 0.72 + 0.38 * smoothstep(0.0, 0.85, tier);
      edge += 0.35 * (noise2(p * 3.3, f32(k) * 5.1 + 9.0) - 0.5);
    }
    let x = (p.x - cx) / half;
    cr.local = vec2f(clamp(x, -1.0, 1.0), ly);
    cr.inside = abs(x) < 1.0 + edge;
  } else {
    let a = (0.36 + 0.1 * r.z) * h + 0.5;
    let b = 0.36 * h;
    let cy = 0.3 * h + b;
    let x = (p.x - cx) / a;
    let y = (p.y - cy) / b;
    let rr = length(vec2f(x, y));
    cr.local = vec2f(clamp(x, -1.0, 1.0), clamp(0.5 + 0.5 * y, 0.0, 1.0));
    var edge = 0.5 * jag;
    // A broadleaf crown is a heap of leaf clumps a metre or two across: their bulges and notches break the outline at a finer scale.
    if (fine) { edge += 0.3 * (noise2(p * 1.9, f32(k) * 7.3 + 3.0) - 0.5) + 0.12 * (noise2(p * 4.5, f32(k) + 21.0) - 0.5); }
    cr.inside = rr < 1.0 + edge;
  }
  return cr;
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let t = ditherThreshold(vec2u(in.pos.xy), in.ids.z);
  if (t < 1.0 - in.fade.x || t >= in.fade.y) { discard; }

  let info = in.ids.y;
  let species = info & 7u;
  let lobes = ((info >> 3u) & 3u) + 1u;
  let rnd = info >> 5u;
  let conifer = species < 2u;
  let width = in.card.z;
  let height = in.card.w;
  let p = in.uv + vec2f(0.0, SINK * height);
  // The extreme tier (vp.tree.w = 1) draws the cards with a real silhouette: whorled or clumped edges, sky gaps through the crown, lit and
  // shaded clumps and the trunk below the crown.
  let fine = vp.tree.w > 0.5;
  var hit : Crown;
  hit.inside = false;
  for (var k = 0u; k < lobes; k++) {
    let cr = crown(k, lobes, conifer, p, width, height, rnd, fine);
    if (cr.inside && (!hit.inside || cr.local.y > hit.local.y)) { hit = cr; }
  }
  var trunk = false;
  if (!hit.inside) {
    // The trunk under the crown: a dark stem a few percent of the tree's height wide, from the ground to where the crown starts.
    let stem = select(0.035, 0.025, conifer) * height;
    if (!fine || p.y > select(0.32, 0.12, conifer) * height || abs(p.x) > stem) { discard; }
    trunk = true;
    hit.local = vec2f(p.x / stem, 0.0);
  }
  var clump = 0.5;
  if (fine && !trunk) {
    clump = noise2(p * select(1.4, 2.2, conifer), 31.0 + f32(rnd & 15u));
    // Gaps: sky shows through between clumps and branch tiers, more toward the rim and the top.
    let rim = max(abs(hit.local.x), select(abs(hit.local.y * 2.0 - 1.0), hit.local.y, conifer));
    if (clump < 0.12 + 0.22 * smoothstep(0.55, 1.0, rim)) { discard; }
  }

  // Rounded normal in the card frame (x right, y up, z towards the camera): a sphere for broadleaves, a cone for conifers.
  let lx = hit.local.x;
  let ly = hit.local.y;
  var nl : vec3f;
  if (conifer) {
    nl = vec3f(lx * 0.85, 0.5, sqrt(max(1.0 - lx * lx, 0.1)));
  } else {
    let yy = (ly - 0.5) * 2.0;
    nl = vec3f(lx, yy, sqrt(max(1.0 - lx * lx - yy * yy, 0.05)));
  }
  let horiz = in.card.xy;
  let right = vec3f(horiz.y, 0.0, -horiz.x);
  var n = normalize(right * nl.x + vec3f(0.0, nl.y, 0.0) + vec3f(horiz.x, 0.0, horiz.y) * nl.z);
  if (fine && !trunk) {
    // Each clump bulges toward the light on its own: tilt the normal by the clump noise's slope.
    let e = 0.35;
    let gx = noise2((p + vec2f(e, 0.0)) * select(1.4, 2.2, conifer), 31.0 + f32(rnd & 15u)) - clump;
    let gy = noise2((p + vec2f(0.0, e)) * select(1.4, 2.2, conifer), 31.0 + f32(rnd & 15u)) - clump;
    n = normalize(n - (right * gx + vec3f(0.0, gy, 0.0)) * 2.5);
  }

  let tone = toneOf(species);
  let tint = unpack4x8unorm(in.ids.x).rgb * 2.0;
  let tex = 0.7 + 0.6 * noise2(p * 0.9, 17.0 + f32(species));
  let ao = mix(0.3, 1.0, smoothstep(0.0, 0.8, ly)) * (1.0 - 0.35 * lx * lx);
  var col = tone.rgb * tint * tex * (0.3 + 0.7 * ao) * DARKEN * select(vec3f(1.0), NEEDLE_SHADE, conifer);
  // Clumps facing out are brighter, the hollows between them darker.
  if (fine) { col *= 0.75 + 0.5 * clump; }
  col *= hit.shade;
  if (trunk) { col = select(vec3f(0.07, 0.06, 0.05), vec3f(0.08, 0.05, 0.035), conifer); }

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), ao);
  o.normal = vec4f(octEncode(n), 1.0, 0.0);
  o.misc = vec4f(FOLIAGE_ID / 255.0, min(tone.a * 1.9, 1.0), 0.0, 0.0);
  o.motion = motionVectorPrev(in.world, in.world);
  return o;
}
