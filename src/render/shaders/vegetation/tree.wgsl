// Trees and bushes: one indirect instanced draw per (variant, LOD). The vertex shader fetches the instance through the visible list built
// by tree_cull.wgsl and animates trunk sway, branch and leaf flutter and prop wash (and reports last frame's position for TAA motion vectors);
// the fragment shader alpha-tests leaf cards against the procedural atlas, rounds their normals into the crown, and shades bark procedurally.
// Plants in a LOD hand-over band are dithered against the neighbouring LOD. Vertex kind bytes are mirrored in meshBuilder.ts (KIND).
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

override LOD : u32 = 0u;

const FOLIAGE_ID : f32 = 5.0;
const ALPHA_CUT : f32 = 0.5;
const CLASS_FIRST_LEAF : u32 = 4u;
const CLASS_NEEDLE : u32 = 5u;
const CLASS_BLOB : u32 = 6u;
const BARK_ROUGHNESS : f32 = 0.9;
const LEAF_ROUGHNESS : f32 = 0.78;
const NEEDLE_ROUGHNESS : f32 = 0.92;
// The atlas stores the colour multiplier divided by this (COLOUR_RANGE in leafAtlas.ts).
const COLOUR_RANGE : f32 = 3.0;
// How far the painted per-leaf tilt bends the crown normal, and the height (m) of the bark fissures for the bump normal.
const LEAF_TILT : f32 = 0.7;
const BARK_BUMP : f32 = 0.014;
// A leaf passes about as much light as it reflects (transmittance 0.05-0.1 against reflectance 0.1-0.15 in green), so the variant's translucency is scaled up.
const LEAF_TRANSMIT : f32 = 1.9;
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
fn treeSway(v : Variant, p : vec3f, local : vec3f, scale : f32, sway : f32, phase : f32, leaf : bool, idPhase : f32, time : f32) -> vec3f {
  let height = v.shape.x * scale;
  let w = windAt(p - local + vec3f(0.0, 0.6 * height, 0.0), time);
  let sp = length(w);
  let dir = w / max(sp, 1.0e-3);
  let across = vec2f(-dir.y, dir.x);
  let amp = v.shape.z * height * sway;
  let a = TAU * v.shape.y * time + idPhase;
  var off = vec3f(0.0);
  let crown = w * amp + (dir * (0.35 * sin(a)) + across * (0.25 * sin(1.31 * a + 1.9))) * (sp * amp);
  off.x = crown.x;
  off.z = crown.y;
  off.y = -dot(crown, crown) / (2.0 * (local.y + 0.5));

  let calm = saturate1(0.25 + sp / 6.0);
  if (phase > 0.004) {
    let bp = TAU * (1.2 + 1.6 * phase) * time + phase * 40.0 + idPhase;
    off += vec3f(dir.x, 0.3, dir.y) * (sin(bp) * sway * 0.05 * calm * scale);
  }
  if (leaf) {
    let lp = TAU * (2.0 + 2.2 * phase) * time + phase * (TAU * 5.0) + idPhase + dot(local, vec3f(2.1, 3.3, 1.7)) / max(scale, 0.1);
    off += vec3f(sin(lp), 0.6 * sin(lp * 1.37 + 0.8), sin(lp * 0.83 + 2.1)) * (v.shape.w * calm * (0.35 + 0.65 * sway) * scale);
  }

  let wash = washAt(p, local.y, time, fract(idPhase * 0.159));
  let bush = v.range.z == KIND_BUSH;
  let reach = select(select(0.03, 0.3, leaf), 0.5 * local.y, bush);
  off += vec3f(wash.x * reach, select(0.0, -0.25 * local.y * wash.z, bush), wash.y * reach);
  return off;
}

// Dither interval of this draw's LOD: the two LODs of a hand-over band split the pixels between them with no overlap and no gap.
fn lodBand(v : Variant, inst : Instance) -> vec2f {
  let c = inst.pos + vec3f(0.0, v.bound.x * inst.scale, 0.0);
  let d = distance(c, frame.camPos.xyz);
  let e = lodEdges(v, inst);
  let b = select(LOD_FADE_BAND, 0.0, v.range.z == 2u);
  let a01 = smoothstep(e.x * (1.0 - b), e.x * (1.0 + b) + 1.0e-3, d);
  let a12 = smoothstep(e.y * (1.0 - b), e.y * (1.0 + b) + 1.0e-3, d);
  let far = smoothstep(0.86 * vp.tree.y, vp.tree.y, d);
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
  let local = yawRotate(in.pos, inst.yaw) * inst.scale;
  let pre = inst.pos + local;
  let time = frame.camPos.w;
  let leafKind = kind >= 128u;
  let world = pre + treeSway(v, pre, local, inst.scale, in.attr.y, in.attr.w, leafKind, idPhase, time);
  let prev = pre + treeSway(v, pre, local, inst.scale, in.attr.y, in.attr.w, leafKind, idPhase, time - frame.params.x);

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
  let c = textureSample(atlas, linearClamp, in.uv);
  let d = textureSample(atlasData, linearClamp, in.uv);

  if (in.band.x > 0.0 || in.band.y < 1.0) {
    let t = ditherThreshold(vec2u(in.pos.xy), in.ids.w);
    if (t < in.band.x || t >= in.band.y) { discard; }
  }
  let kind = in.ids.z;
  let cls = kind >> 5u;
  let leaf = cls >= CLASS_FIRST_LEAF;
  if (leaf && c.a < ALPHA_CUT) { discard; }

  let v = variants[in.ids.x];
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  var n = normalize(in.nrm);
  var col : vec3f;
  var rough = BARK_ROUGHNESS;
  var translucency = 0.0;
  var ao = in.shade.x;
  if (leaf) {
    // Per-card colour drift (sun leaves vs shade leaves) from the branch phase, painted colour from the atlas.
    let drift = vec3f(1.0 + 0.22 * (in.shade.z - 0.5), 1.0 + 0.06 * (in.shade.z - 0.5), 1.0 - 0.25 * (in.shade.z - 0.5));
    col = v.leafTone.rgb * c.rgb * COLOUR_RANGE * tint * drift;
    let tb = uvTangents(dpx, dpy, dux, duy);
    let tilt = d.rg * 2.0 - 1.0;
    n = normalize(n + (tb[0] * tilt.x + tb[1] * tilt.y) * LEAF_TILT);
    rough = select(LEAF_ROUGHNESS, NEEDLE_ROUGHNESS, cls == CLASS_NEEDLE);
    translucency = min(v.leafTone.a * d.b * LEAF_TRANSMIT, 1.0);
    ao = saturate1(in.shade.x * (0.4 + 0.6 * d.a));
    col *= (0.3 + 0.7 * ao) * select(1.0, BLOB_DARKEN, cls >= CLASS_BLOB);
  } else {
    let twig = in.shade.z > 0.004;
    let tan = uvTangents(dlx, dly, dux, duy);
    var axis = tan[1];
    if (dot(axis, axis) < 0.5) { axis = vec3f(0.0, 1.0, 0.0); }
    let seed = f32(in.ids.w & 255u);
    let h = barkHeight(in.local, axis, cls, seed, twig);
    col = barkAlbedo(h, in.local, cls, in.shade.y, seed, twig) * mix(vec3f(1.0), tint, 0.5);
    let hx = barkHeight(in.local + dlx, axis, cls, seed, twig) - h;
    let hy = barkHeight(in.local + dly, axis, cls, seed, twig) - h;
    let r1 = cross(dpy, n);
    let r2 = cross(n, dpx);
    let det = dot(dpx, r1);
    if (abs(det) > 1.0e-12) {
      let grad = (hx * r1 + hy * r2) / det;
      n = normalize(n - BARK_BUMP * (grad - n * dot(n, grad)));
    }
    ao = in.shade.x * (0.55 + 0.45 * smoothstep(0.0, 0.5, h));
  }

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), ao);
  o.normal = vec4f(octEncode(n), rough, 0.0);
  o.misc = vec4f(FOLIAGE_ID / 255.0, translucency, 0.0, 0.0);
  o.motion = in.motion;
  return o;
}
