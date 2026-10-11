// Trees and bushes: one indirect instanced draw per (variant, LOD). The vertex shader fetches the instance through the visible list built
// by tree_cull.wgsl and animates trunk sway, branch and leaf flutter and prop wash (and reports last frame's position for TAA motion vectors);
// the fragment shader alpha-tests leaf cards against the procedural atlas, rounds their normals into the crown, and shades bark procedurally.
// Plants in a LOD hand-over band are dithered against the neighbouring LOD. Vertex kind bytes are mirrored in meshBuilder.ts (KIND).
// The bark's relief normal takes screen derivatives of its height inside the bark branch; a 2x2 pixel quad straddling bark and a leaf card is
// rare and only costs one pixel's bump, so the uniformity check on derivatives is switched off for this module.
diagnostic(off, derivative_uniformity);
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_wind.wgsl"
#include "vegetation/veg_instance.wgsl"
#include "vegetation/tree_bark.wgsl"
#include "terrain/gbuffer.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> visible : array<u32>;
@group(2) @binding(3) var<storage, read> variants : array<Variant>;
@group(2) @binding(4) var atlas : texture_2d<f32>;
@group(2) @binding(5) var atlasData : texture_2d<f32>;
@group(2) @binding(7) var leafSampler : sampler;
// One bit per instance slot: the tree has GI proxies (vegetation/index.ts publishProxied).
@group(2) @binding(11) var<storage, read> proxied : array<u32>;

// Share of the crown-scale occlusion the bake keeps (treeGen.ts CROWN_AO_SHARE): the GI rays against a tree's canopy proxies supply the rest.
const CROWN_AO_SHARE : f32 = 0.3;

// Depth (m) at which a leaf starts and finishes taking its crown's whole occlusion (crownAo): the outer shell is open to the sky whatever lies
// behind it.
const CROWN_SHELL_OUT : f32 = 1.0;
const CROWN_SHELL_IN : f32 = 2.0;

// The crown occlusion a vertex's baked `ao` stands for on this tree. A tree with GI proxies takes it as baked. One without (beyond the
// proxy set, nothing for the GI rays from its leaves to hit) takes the whole crown term the bake scaled down, ao = 1 - share * (1 - full),
// once the point lies more than CROWN_SHELL_IN metres inside its crown, and keeps the bake on the outer CROWN_SHELL_OUT metres: those
// leaves, sunlit or backlit, are not shaded by their own crown. `local` is the point in the tree's frame at scale 1. The far LOD's cards
// keep the bake as it is, to match the far-field canopy (veg_far.wgsl).
fn crownAo(baked : f32, slot : u32, v : Variant, local : vec3f, scale : f32, leaf : bool) -> f32 {
  if (LOD >= 2u || (proxied[slot >> 5u] & (1u << (slot & 31u))) != 0u) { return baked; }
  let r = max(v.crown.yzw, vec3f(0.1));
  // Bark, under the crown or inside it, is shaded by the leaves above whatever its depth: only the bake decides there.
  let depth = select(CROWN_SHELL_IN, (1.0 - length((local - vec3f(0.0, v.crown.x, 0.0)) / r)) * min(r.x, min(r.y, r.z)) * scale, leaf);
  // The plan's crown is a padded ellipsoid round a lumpy crown, so depth alone puts some outer leaves deep inside it: the bake (high on an
  // exposed leaf) has to agree that the leaf is shaded.
  return mix(baked, saturate1(1.0 - (1.0 - baked) / CROWN_AO_SHARE), smoothstep(CROWN_SHELL_OUT, CROWN_SHELL_IN, depth) * smoothstep(0.92, 0.84, baked));
}

override LOD : u32 = 0u;

const FOLIAGE_ID : f32 = 5.0;
const ALPHA_CUT : f32 = 0.5;
// Cosine of the view angle to a leaf card below which its coverage thins out (fully gone at EDGE_ON_LO, untouched from EDGE_ON_HI).
const EDGE_ON_LO : f32 = 0.15;
const EDGE_ON_HI : f32 = 0.55;
// The same for needle sprays, which are brushes of needles all round their shoots, a few centimetres deep: seen edge-on a spray is still a band of
// needles, so it thins only at truly grazing angles (with the broadleaf range a level spray seen from eye height lost most of its needles).
const NEEDLE_EDGE_ON : vec2f = vec2f(0.04, 0.2);
const CLASS_FIRST_LEAF : u32 = 4u;
const CLASS_NEEDLE : u32 = 5u;
const CLASS_BLOB : u32 = 6u;
const CLASS_CONE : u32 = 7u;
const BARK_ROUGHNESS : f32 = 0.95;
// Bark relief is bump-mapped while a pixel spans less than this (m); beyond it the shader keeps the averaged colour and the smooth normal.
const BARK_BUMP_FOOTPRINT : f32 = 0.02;
// The waxy upper face of a broadleaf (oak, birch, beech) has a cuticle with a sheen: a leaf turned toward the sun shows a pale glint, which is
// much of what makes a sunlit crown sparkle. Smoother than this, the sky's reflection washes whole cards grey-white (F0 0.04 against an albedo
// of 0.1), so the lobe stays broad. Undersides are hairy and matte; a needle spray, a mid-distance cluster card and a billboard each stand for
// leaves at every angle, which averages to a fully rough surface.
const LEAF_ROUGHNESS : f32 = 0.75;
const LEAF_BACK_ROUGHNESS : f32 = 1.0;
const NEEDLE_ROUGHNESS : f32 = 1.0;
const BLOB_ROUGHNESS : f32 = 0.95;
const CONE_ROUGHNESS : f32 = 1.0;
// The underside of a leaf has no palisade layer under its skin: it reflects about a fifth more and is a little greyer (less chlorophyll, more hairs).
const LEAF_BACK_LIGHTEN : f32 = 1.15;
const LEAF_BACK_GREY : f32 = 0.0;
// The atlas stores the colour multiplier divided by this (COLOUR_RANGE in leafAtlas.ts).
const COLOUR_RANGE : f32 = 3.0;
// How far the painted per-leaf tilt bends the crown normal.
const LEAF_TILT : f32 = 0.9;
// How far wind turns the leaves of a card about their stalks (normal tilt per unit of the calm-scaled wind), so their sheen and translucency flicker.
const LEAF_FLICKER : f32 = 0.45;
// A thin leaf lamina passes about 0.8 of what it reflects, and common/pbr.wgsl already applies that 0.8 to the translucency written here, so a lamina
// texel (atlas translucency 1) of a broadleaf variant ends up at 1. The yellow-green colour of the light a leaf passes is applied by the lighting.
const LEAF_TRANSMIT : f32 = 2.2;
// The lowest ambient factor of a leaf deep in a crown: sky light scattered and transmitted by the neighbouring leaves keeps shade foliage coloured, never
// black. Photographs of oak, beech and birch crowns show the interior at a third or less of the outer leaves' brightness, so the floor is low.
const LEAF_AO_FLOOR : f32 = 0.3;
// Sunflecks (see their use): extinction (1/m) of the sun through a crown's leaves, and the soft edge of a shoot's lit/shaded draw. A real
// crown's is about 0.3 (leaf area density 0.6 m2/m3, projected share 0.5), but the canopy shadow map already darkens a crown by its mean
// (shadow.wgsl), so at 0.3 the crown's median fell by a third of a stop; half of it splits the light into flecks with less of that loss.
const LEAF_SELF_EXTINCTION : f32 = 0.15;
const LEAF_FLECK_EDGE : f32 = 0.08;
const BLOB_AO_FLOOR : f32 = 0.7;
const NEEDLE_SHADE : vec3f = vec3f(0.55, 0.6, 0.4);
const BARK_AO_FLOOR : f32 = 0.4;
// Leaf flutter frequency (Hz), and the wave vectors (radians per metre) of its two ripples through the crown: a ripple about a metre long, so
// neighbouring leaves move nearly together and its slope stays small.
const LEAF_FLAP_HZ : f32 = 2.6;
const FLUTTER_K1 : vec3f = vec3f(0.78, 0.58, 0.92);
const FLUTTER_K2 : vec3f = vec3f(-1.05, 0.48, 0.65);
// A leaf's own twist on its stalk: the most its tip moves (m per unit of tree scale) and how often (Hz). Each leaf at its own phase.
const PETIOLE_TWIST : f32 = 0.0015;
const PETIOLE_HZ : f32 = 3.3;
// Outer branches bob this many metres per m/s of wind (2 to 3 cm in a 4 m/s breeze, twice that in its gusts), on top of the whole crown's lean.
const BRANCH_SWAY : f32 = 0.006;
// Wave vector (radians per metre) of the branch sway across the crown: limbs several metres apart swing out of step, while across one shoot card
// it barely bends, so cards that are apart at rest stay apart.
const BRANCH_WAVE : vec3f = vec3f(0.45, 0.28, 0.65);
// Colour variation inside a crown: patches about a branch across (m) differ in brightness and hue, so a crown is never one flat green.
const BRANCH_PATCH : f32 = 0.7;
// Far-LOD canopy cards only show their sunlit faces, so they are painted a little darker to match the average of the full-detail crown.
const BLOB_DARKEN : f32 = 0.78;

struct VsIn {
  @builtin(instance_index) iid : u32,
  @location(0) pos : vec3f,
  @location(1) oct : vec2f,
  @location(2) uv : vec2f,
  @location(3) attr : vec4f,   // x = ambient occlusion, y = sway weight, z = kind / 255, w = phase
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) uv : vec2f,
  @location(3) @interpolate(flat) ids : vec4u,    // x = variant, y = tint, z = kind, w = instance slot
  @location(4) shade : vec3f,                      // x = ambient occlusion, y = mesh height (m), z = branch phase
  @location(5) motion : vec2f,
  @location(6) local : vec3f,                      // mesh-space position
  @location(7) @interpolate(flat) band : vec2f,    // dither interval [lo, hi) in which this LOD is drawn
};

// Displacement (m) of a vertex: crown lean and oscillation along the wind, branch sway, leaf flutter and prop wash.
fn treeSway(v : Variant, p : vec3f, local : vec3f, scale : f32, sway : f32, anchored : bool, idPhase : f32, time : f32) -> vec3f {
  let height = v.shape.x * scale;
  let w = windAt(p - local + vec3f(0.0, 0.6 * height, 0.0), time);
  let sp = length(w);
  let dir = w / max(sp, 1.0e-3);
  let across = vec2f(-dir.y, dir.x);
  // A continuous structural field gives a branch and its child the same displacement at their joint.
  // Park stems stay rigid with collision; their leaf-card roots therefore receive no crown displacement.
  let structural = select(min(pow(max(local.y, 0.0) / max(height, 0.1), 1.6), 1.0), 0.0, anchored);
  let amp = v.shape.z * height * structural;
  let a = TAU * v.shape.y * time + idPhase;
  var off = vec3f(0.0);
  let crown = w * amp + (dir * (0.35 * sin(a)) + across * (0.25 * sin(1.31 * a + 1.9))) * (sp * amp);
  off.x = crown.x;
  off.z = crown.y;
  off.y = -dot(crown, crown) / max(2.0 * (local.y + 0.5), 0.1);
  // Branch sway: a smooth field over the tree's own frame, so a branch and its child move together at their joint while limbs a few metres apart
  // swing out of step. It grows with distance from the trunk axis, so the trunk and the core of the crown stay put and the outer shoots bob most.
  let outer = smoothstep(0.15, 0.9, length(local.xz) / max(v.bound.y * scale, 0.1));
  if (!anchored) {
    let bs = TAU * 2.1 * v.shape.y * time + dot(local, BRANCH_WAVE) + idPhase;
    let swing = (sin(bs) + 0.5 * sin(1.73 * bs + 0.3 * local.y)) * (BRANCH_SWAY * sp * outer);
    off += vec3f(dir.x * swing, 0.45 * swing, dir.y * swing);
  }

  // Leaf flutter, the last level of the same hierarchy: ripples running through the outer crown at LEAF_FLAP_HZ, moving each leaf together with
  // its twig and its neighbours. Like every motion above it is a smooth function of position, and its slope (amplitude x FLUTTER_K) stays
  // well under one, so foliage that is apart at rest stays apart at every moment: no leaf can swing through another (foliageSpace.test.ts).
  // Park plants keep their wood rigid, so only their leaves flutter, by the sway weight (0 at the stalk).
  let calm = saturate1(0.25 + sp / 6.0);
  let fp = TAU * LEAF_FLAP_HZ * time + idPhase;
  let rise = sin(fp + dot(local, FLUTTER_K1));
  let side = sin(1.37 * fp + dot(local, FLUTTER_K2));
  off += vec3f(0.6 * across.x * side, rise, 0.6 * across.y * side) * (v.shape.w * calm * scale * select(outer, sway, anchored));

  let wash = washAt(p, local.y, time, fract(idPhase * 0.159));
  let bush = v.range.z == KIND_BUSH;
  let reach = select(select(0.03, 0.5 * local.y, bush) + 0.27 * scale * outer, 0.27 * sway * scale, anchored);
  off += vec3f(wash.x * reach, select(0.0, -0.25 * local.y * wash.z, bush && !anchored), wash.y * reach);
  return off;
}

// The foot of a plant follows the slope it stands on: below about 1.8 m the trunk, its root flare, roots and low foliage are sheared onto the
// plane of the ground under the plant, so the downhill side meets the soil instead of standing proud of it. Park plants stand on level ground.
fn footOnSlope(local : vec3f, inst : Instance) -> vec3f {
  if (inst.nrm == PARK_PLANT_NORMAL) { return local; }
  let g = unpack2x16snorm(inst.nrm);
  let ny = sqrt(max(1.0 - dot(g, g), 0.1));
  let w = 1.0 - smoothstep(0.3, 1.8, local.y);
  return vec3f(local.x, local.y - w * dot(g, local.xz) / ny, local.z);
}

// A broadleaf in a closed stand spreads its crown out to meet its neighbours' (placementRules.ts withCrownSpread, stored in the tint's alpha as
// value * 2): everything above about a third of the tree's height is pushed out from the axis, the trunk and its collider stay as they are.
// Largest share by which a crown differs from its variant in width (and 1.3 times that in height); tree_cull.wgsl grows the cull sphere by it.
const CROWN_JITTER : f32 = 0.12;
const TRUNK_JITTER : f32 = 0.16;
// Largest lean of a tree's top off its foot, as a share of its height; tree_cull.wgsl grows the cull sphere by it.
const TREE_LEAN : f32 = 0.03;

fn crownSpread(local : vec3f, v : Variant, inst : Instance, slot : u32) -> vec3f {
  let spread = max(unpack4x8unorm(inst.tint).a * 2.0, 1.0);
  let h = v.shape.x * inst.scale;
  let w = smoothstep(0.28 * h, 0.55 * h, local.y);
  // Every tree's crown is its own size: up to CROWN_JITTER wider or narrower and taller or shorter than its variant's, so a stand seen from
  // above is a rough canopy of crowns at different heights rather than a carpet of copies. The trunk and its collider are left as they are.
  let wide = spread * (1.0 + CROWN_JITTER * (2.0 * hash11(slot * 31u + 5u) - 1.0));
  let tall = 1.0 + CROWN_JITTER * 1.3 * (2.0 * hash11(slot * 17u + 11u) - 1.0);
  let y = local.y + w * (local.y - 0.4 * h) * (tall - 1.0);
  // The bole is up to TRUNK_JITTER slimmer than the variant's (never thicker, so it stays inside its collider box).
  let girth = 1.0 - TRUNK_JITTER * hash11(slot * 13u + 3u);
  let across = mix(girth, wide, w);
  var out = vec3f(local.x * across, y, local.z * across);
  // Every tree leans its own way, by up to TREE_LEAN of its height at the top: the stem bows with the square of the height, so the lower bole,
  // where a drone passes between the trunks, stays inside its collider box (4 % of the lean at a fifth of the height: 2 cm on a 20 m tree). Park plants and bushes
  // stand as built.
  if (inst.nrm != PARK_PLANT_NORMAL && v.range.z != KIND_BUSH) {
    let a = TAU * hash11(slot * 23u + 7u);
    let f = saturate1(local.y / max(h, 0.1));
    let lean = TREE_LEAN * h * hash11(slot * 29u + 19u) * f * f;
    out += vec3f(cos(a) * lean, 0.0, sin(a) * lean);
  }
  return out;
}

// Dither interval of this draw's LOD: the two LODs of a hand-over band split the pixels between them with no overlap and no gap.
fn lodBand(v : Variant, inst : Instance) -> vec2f {
  let c = inst.pos + vec3f(0.0, v.bound.x * inst.scale, 0.0);
  let d = distance(c, frame.camPos.xyz);
  let e = lodEdges(v, inst);
  let b = select(LOD_FADE_BAND, 0.0, v.range.z == 2u);
  let a01 = smoothstep(e.x * (1.0 - b), e.x * (1.0 + b) + 1.0e-3, d);
  let a12 = smoothstep(e.y * (1.0 - b), e.y * (1.0 + b) + 1.0e-3, d);
  var far = smoothstep(0.86 * vp.tree.y, vp.tree.y, d);
  if (inst.nrm == PARK_PLANT_NORMAL) { far = smoothstep(0.86 * PARK_PLANT_DISTANCE, PARK_PLANT_DISTANCE, d); }
  var lo = 0.0;
  var hi = 1.0 - far;
  if (LOD == 0u) { hi = 1.0 - a01; }
  if (LOD == 1u) { lo = 1.0 - a01; hi = 1.0 - a12; }
  if (LOD == 2u) { lo = 1.0 - a12; }
  return vec2f(lo, hi);
}

@vertex
fn vs(in : VsIn) -> VsOut {
  let slot = visible[in.iid];
  let inst = instances[slot];
  let v = variants[inst.variant];
  let kind = u32(in.attr.z * 255.0 + 0.5);
  let idPhase = hash11(slot) * TAU;
  // Extreme tier, near LOD: the finely cut trunks and heavy limbs take their bark relief as real geometry (tree_bark.wgsl barkDisplacement).
  var modelPos = in.pos;
  if (LOD == 0u && vp.tree.w > 0.5 && kind < 128u) {
    let radius = in.attr.w * in.attr.w * BARK_RADIUS_MAX * inst.scale;
    let sink = barkDisplacement(kind >> 3u, barkPoint(in.uv, radius, inst.scale), radius, in.pos.y * inst.scale, in.uv, inst.scale, hash11(slot * 7919u + 13u));
    modelPos += octDecode(in.oct) * (sink / inst.scale);
  }
  let local = crownSpread(footOnSlope(yawRotate(modelPos, inst.yaw) * inst.scale, inst), v, inst, slot);
  let pre = inst.pos + local;
  let time = frame.camPos.w;
  let leafKind = kind >= 128u;
  // Park's solid wood follows the same fixed skeleton used by collision and RT.
  // Flexible leaves retain wind/flutter and prop-wash response.
  let rigidWood = inst.nrm == PARK_PLANT_NORMAL && !leafKind;
  var world = pre;
  var prev = pre;
  if (!rigidWood) {
    world += treeSway(v, pre, local, inst.scale, in.attr.y, inst.nrm == PARK_PLANT_NORMAL, idPhase, time);
    prev += treeSway(v, pre, local, inst.scale, in.attr.y, inst.nrm == PARK_PLANT_NORMAL, idPhase, time - frame.params.x);
  }
  // Each leaf or spray also twists a little on its stalk, out of step with its neighbours: its tip (sway weight) swings along its normal by at
  // most PETIOLE_TWIST, under half the room the build leaves between neighbouring leaves (treeGen.ts), so two never meet.
  if (leafKind) {
    let n = yawRotate(octDecode(in.oct), inst.yaw) * (PETIOLE_TWIST * inst.scale * min(in.attr.y, 1.0));
    let tp = TAU * in.attr.w + idPhase;
    world += n * sin(TAU * PETIOLE_HZ * time + tp);
    prev += n * sin(TAU * PETIOLE_HZ * (time - frame.params.x) + tp);
  }

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = yawRotate(octDecode(in.oct), inst.yaw);
  o.uv = in.uv;
  o.ids = vec4u(inst.variant, inst.tint, kind, slot);
  o.shade = vec3f(in.attr.x, in.pos.y, in.attr.w);
  o.motion = motionVectorPrev(world, prev);
  o.local = in.pos;
  o.band = lodBand(v, inst);
  return o;
}

// Per-pixel threshold in [0, 1): blue noise, rotated every frame (golden ratio) when TAA is on so the history averages the two LODs.
fn ditherThreshold(px : vec2u, slot : u32) -> f32 {
  var t = textureLoad(blueNoise, vec2i(px & vec2u(127u)), 0).x + hash11(slot);
  if ((frame.misc.y & 4u) != 0u) { t += f32(frame.misc.x & 255u) * 0.6180339887; }
  return fract(t);
}

// Leaf alpha threshold: blue noise offset from the LOD dither's so the two do not correlate, rotated every frame (golden ratio) when TAA is on so
// the history averages an edge pixel to its coverage. The noise only resolves while TAA keeps a pixel's history, i.e. while the leaf moves
// less than about a pixel a frame; faster (an FPV pass at speed) it would stay as speckle, so it fades to the plain, stable 0.5 cut, as it is
// without TAA.
fn alphaThreshold(px : vec2u, motion : vec2f) -> f32 {
  if ((frame.misc.y & 4u) == 0u) { return 0.5; }
  let t = fract(textureLoad(blueNoise, vec2i((px + vec2u(67u, 29u)) & vec2u(127u)), 0).x + f32(frame.misc.x & 255u) * 0.6180339887);
  return mix(t, 0.5, saturate1(length(motion * frame.screen.xy) - 0.5));
}

// Unit tangent of increasing uv.x and uv.y from screen-space derivatives (zero vectors when the card is edge-on).
fn uvTangents(dpx : vec3f, dpy : vec3f, dux : vec2f, duy : vec2f) -> mat2x3f {
  let det = dux.x * duy.y - dux.y * duy.x;
  if (abs(det) < 1.0e-12) { return mat2x3f(vec3f(0.0), vec3f(0.0)); }
  let inv = 1.0 / det;
  let tu = (dpx * duy.y - dpy * dux.y) * inv;
  let tv = (dpy * dux.x - dpx * duy.x) * inv;
  return mat2x3f(tu / max(length(tu), 1.0e-6), tv / max(length(tv), 1.0e-6));
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let dpx = dpdx(in.world);
  let dpy = dpdy(in.world);
  let dux = dpdx(in.uv);
  let duy = dpdy(in.uv);
  let dlx = dpdx(in.local);
  let dly = dpdy(in.local);
  let c = textureSample(atlas, leafSampler, in.uv);
  let d = textureSample(atlasData, leafSampler, in.uv);
  let alphaWidth = max(fwidth(c.a), 1.0e-3);

  if (in.band.x > 0.0 || in.band.y < 1.0) {
    let t = ditherThreshold(vec2u(in.pos.xy), in.ids.w);
    if (t < in.band.x || t >= in.band.y) { discard; }
  }
  let kind = in.ids.z;
  let cls = kind >> 5u;
  let leaf = cls >= CLASS_FIRST_LEAF;
  // The mask is sharpened to a one-pixel ramp across the leaf edge and kept where it beats a blue-noise threshold, so an edge pixel is covered
  // in proportion to how much leaf it holds and TAA resolves an anti-aliased, stable outline (a fixed 0.5 cut crawls and shimmers in motion).
  // A shoot card seen nearly edge-on would smear its leaves into long streaks; real leaves at that angle are thin slivers with sky between
  // them. The coverage thins out as the card turns edge-on (the cut rises), so grazing cards show gaps instead of streaks.
  let edgeOn = abs(dot(normalize(cross(dpx, dpy)), normalize(frame.camPos.xyz - in.world)));
  let band = select(vec2f(EDGE_ON_LO, EDGE_ON_HI), NEEDLE_EDGE_ON, cls == CLASS_NEEDLE);
  let cut = ALPHA_CUT + (1.0 - ALPHA_CUT) * (1.0 - smoothstep(band.x, band.y, edgeOn));
  if (leaf && saturate1((c.a - cut) / alphaWidth + 0.5) <= alphaThreshold(vec2u(in.pos.xy), in.motion)) { discard; }

  let v = variants[in.ids.x];
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  var n = normalize(in.nrm);
  var col : vec3f;
  var rough = BARK_ROUGHNESS;
  var translucency = 0.0;
  let crownOpen = crownAo(in.shade.x, in.ids.w, v, in.local, instances[in.ids.w].scale, leaf);
  var ao = crownOpen;
  // Sunlight shadowed at this point by the bark's own relief (furrows) or, on a leaf, by the leaves between it and the sun (sunflecks), passed
  // to the lighting in misc.b (deferred.wgsl).
  var sunOcc = 0.0;
  if (leaf) {
    // Per-card colour drift (sun leaves vs shade leaves) from the branch phase, painted colour from the atlas.
    let drift = vec3f(1.0 + 0.22 * (in.shade.z - 0.5), 1.0 + 0.06 * (in.shade.z - 0.5), 1.0 - 0.25 * (in.shade.z - 0.5));
    // Patches of the crown about a branch across: brighter and yellower, or darker and bluer, the way one limb's leaves differ from the next.
    let q = in.local / BRANCH_PATCH + vec3f(hash11(in.ids.w) * 40.0);
    let limbPatch = 0.5 * sin(q.x + 1.7 * sin(q.y)) * sin(q.z + 1.3 * sin(q.x));
    let branch = vec3f(1.0 + 0.4 * limbPatch, 1.0 + 0.32 * limbPatch, 1.0 + 0.08 * limbPatch);
    col = v.leafTone.rgb * c.rgb * COLOUR_RANGE * tint * drift * branch;
    let tb = uvTangents(dpx, dpy, dux, duy);
    // Wind turns each leaf a little about its stalk: a slow noise over the card, advected along it, so neighbouring leaves flicker out of step.
    // Only the full-detail LOD flickers (every LOD at the extreme tier); beyond it a leaf is under a pixel and the flicker would mostly cost time.
    var tilt = d.rg * 2.0 - 1.0;
    if (LOD == 0u || vp.tree.w > 0.5) {
      let calm = saturate1(vp.wind.z / 6.0);
      let w = in.uv * 90.0 + vec2f(2.3, 1.9) * frame.camPos.w;
      tilt += 0.5 * vec2f(sin(w.x + 2.0 * sin(w.y)), sin(w.y + 2.0 * sin(w.x * 0.8))) * (LEAF_FLICKER * calm);
    }
    n = normalize(n + (tb[0] * tilt.x + tb[1] * tilt.y) * LEAF_TILT);
    // Leaves are thin and double sided: a normal facing away from the eye is mirrored about the view plane (continuous at the silhouette),
    // so the underside of a sunlit crown shows transmitted light and ground bounce instead of the sunlit top's reflection. The face whose crown
    // normal points away from the eye is the leaf's underside: paler, greyer and matte.
    let eye = normalize(frame.camPos.xyz - in.world);
    let underside = smoothstep(0.15, -0.15, dot(normalize(in.nrm), eye));
    n = normalize(n - 2.0 * min(dot(n, eye), 0.0) * eye);
    var front = LEAF_ROUGHNESS;
    if (cls == CLASS_NEEDLE) { front = NEEDLE_ROUGHNESS; }
    if (cls == CLASS_BLOB) { front = BLOB_ROUGHNESS; }
    if (cls == CLASS_CONE) { front = CONE_ROUGHNESS; }
    let broad = select(0.0, underside, cls == CLASS_FIRST_LEAF);
    rough = mix(front, LEAF_BACK_ROUGHNESS, broad);
    col = mix(col, vec3f(dot(col, vec3f(0.3, 0.59, 0.11))), LEAF_BACK_GREY * broad) * mix(1.0, LEAF_BACK_LIGHTEN, broad);
    translucency = min(v.leafTone.a * d.b * LEAF_TRANSMIT, 1.0);
    // Openness: the baked crown occlusion times the atlas's own cavity term. Leaves deep in a crown are shade leaves: darker and
    // lit mostly by what the outer leaves let through; outer sun leaves are a little yellower.
    let occ = saturate1(crownOpen * (0.55 + 0.45 * d.a));
    // The mid- and far-LOD cards keep the shallower shading the far-field canopy (veg_far.wgsl) is matched to, so the hand-over does not pop.
    let far = cls >= CLASS_BLOB;
    // Sunflecks: inside a crown a leaf is either in the sun, through a gap, or in the shade of the leaves between it and the sun; it is not lit
    // by the crown's average (which smooths a crown into a gradient with half the local contrast of a photograph). Its chance of sun is its own
    // crown's transmittance along the sun (Beer-Lambert over its depth to the crown ellipsoid's surface). Each shoot (its phase byte) of each
    // tree (slot) draws once, so a shoot is lit or shaded as a whole and stays so as it moves. Passed as sun occlusion in misc.b (deferred.wgsl).
    if (!far && v.crown.y > 0.0) {
      let inst = instances[in.ids.w];
      let r = v.crown.yzw;
      let q = (in.local - vec3f(0.0, v.crown.x, 0.0)) / r;
      let ds = yawRotate(frame.sunDir.xyz, -inst.yaw) / r;
      let a = dot(ds, ds);
      let b = dot(q, ds);
      let cq = dot(q, q) - 1.0;
      let depth = select(0.0, (-b + sqrt(max(b * b - a * cq, 0.0))) / a, cq < 0.0) * inst.scale;
      let draw = hash11(u32(in.shade.z * 255.0 + 0.5) * 7919u + in.ids.w * 104729u);
      sunOcc = 1.0 - smoothstep(draw - LEAF_FLECK_EDGE, draw + LEAF_FLECK_EDGE, exp(-LEAF_SELF_EXTINCTION * depth));
    }
    ao = mix(select(LEAF_AO_FLOOR, BLOB_AO_FLOOR, far), 1.0, occ);
    // Spruce, fir and pine needles are a darker, less blue green than the variant tone alone gives them under sky light (veg_far.wgsl matches).
    if (cls == CLASS_NEEDLE || cls == CLASS_CONE) { col *= NEEDLE_SHADE; }
    col *= select(mix(vec3f(0.84, 0.86, 0.84), vec3f(1.03, 1.02, 0.96), occ), vec3f(mix(0.85, 1.0, occ) * BLOB_DARKEN), far);
  } else {
    // Bark on the limb's cylinder in real metres (tree_bark.wgsl): angle round the limb, metres along it, and the limb's radius from the phase byte.
    let scale = instances[in.ids.w].scale;
    let barkKind = kind >> 3u;
    let radius = in.shade.z * in.shade.z * BARK_RADIUS_MAX * scale;
    let height = in.shade.y * scale;
    let footprint = max(length(dpx), length(dpy));
    let seed = hash11(in.ids.w * 7919u + 13u);
    let p = barkPoint(in.uv, radius, scale);
    let smoothN = n;
    // Photoscanned bark where it is loaded (tree_bark.wgsl scanBark).
    // A forest-grown oak or beech (its crown starting high up the tree) stands in damp shade (tree_bark.wgsl barkForest).
    let crownBase = (v.crown.x - v.crown.z) / max(v.shape.x, 1.0);
    barkForest = select(0.0, smoothstep(0.25, 0.45, crownBase), barkKind == BARK_OAK || barkKind == BARK_BEECH);
    var scanW = select(0.0, 1.0, barkScansReady() && scannedKind(barkKind));
    var bark : BarkSurface;
    if (scanW < 1.0) {
      let h = barkHeight(barkKind, p, radius, height, footprint);
      bark = barkSurface(barkKind, p, radius, h, height, n, footprint, seed);
      // Relief normal from the change of the bark height to the next pixel across and down (the height fades to flat where furrows are
      // narrower than a pixel, so far bark keeps its smooth normal).
      if (LOD < 2u && footprint < BARK_BUMP_FOOTPRINT) {
        let hx = dpdxFine(bark.h);
        let hy = dpdyFine(bark.h);
        let r1 = cross(dpy, n);
        let r2 = cross(n, dpx);
        let det = dot(dpx, r1);
        if (abs(det) > 1.0e-12) {
          let grad = (hx * r1 + hy * r2) / det;
          n = normalize(n - bark.depth * (grad - n * dot(n, grad)));
        }
      }
    }
    if (scanW > 0.0) {
      let toEye = normalize(frame.camPos.xyz - in.world);
      let sb = scanBark(barkKind, in.uv, radius, scale, height, seed, p, smoothN, dpx, dpy, footprint, toEye, frame.sunDir.xyz, LOD == 0u,
        select(10, 20, vp.tree.w > 0.5));
      if (scanW >= 1.0) { bark = sb.s; n = sb.n; } else {
        bark.col = mix(bark.col, sb.s.col, scanW);
        bark.rough = mix(bark.rough, sb.s.rough, scanW);
        bark.cavity = mix(bark.cavity, sb.s.cavity, scanW);
        n = normalize(mix(n, sb.n, scanW));
      }
      sunOcc = sb.sunOcc * scanW;
    }
    col = bark.col * mix(vec3f(1.0), tint, 0.35);
    rough = bark.rough;
    ao = mix(BARK_AO_FLOOR, 1.0, crownOpen) * bark.cavity;
  }

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), ao);
  o.normal = vec4f(octEncode(n), rough, 0.0);
  o.misc = vec4f(FOLIAGE_ID / 255.0, translucency, sunOcc, 0.0);
  o.motion = in.motion;
  return o;
}
