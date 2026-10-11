// Rocks and boulders: the tree draw layout and instance path with a static vertex shader (the instance is tilted toward the terrain normal,
// scaled by its radius and yawed) and a procedural weathered-stone material in the fragment shader: the regional bedrock colour (the
// same field the outcrops use, so a boulder matches the face it fell from), fracture grooves, crystalline grain, crustose lichen, moss on
// the tops and a soil-stained, shadowed foot where the stone meets the ground, so it reads as bedded in rather than set down.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_instance.wgsl"
#include "terrain/gbuffer.wgsl"
#include "terrain/ground_color.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> visible : array<u32>;
@group(2) @binding(3) var<storage, read> variants : array<Variant>;

const ROCK_ID : f32 = 6.0;
const ROCK_ROUGHNESS : f32 = 0.85;
// Share of the terrain tilt a rock follows: half-buried boulders sit on slopes without lying flat against them.
const TILT : f32 = 0.65;
// Relief of the grain in metres (it tilts the normal by its slope across the surface).
const BUMP : f32 = 0.05;
const MOSS : vec3f = vec3f(0.050, 0.080, 0.026);
const LICHEN_GREY : vec3f = vec3f(0.30, 0.32, 0.26);
const LICHEN_ORANGE : vec3f = vec3f(0.30, 0.18, 0.07);
const FOOT_SOIL : vec3f = vec3f(0.085, 0.068, 0.052);

struct VsIn {
  @builtin(instance_index) iid : u32,
  @location(0) pos : vec3f,
  @location(1) oct : vec2f,
  @location(2) uv : vec2f,
  @location(3) attr : vec4f,   // x = ambient occlusion
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) local : vec3f,
  @location(3) @interpolate(flat) ids : vec2u,   // x = variant, y = tint
  @location(4) ao : f32,
  @location(5) motion : vec2f,
  @location(6) @interpolate(flat) radius : f32,
};

// Rotation that takes +Y onto t (Rodrigues form with axis Y x t), applied to p.
fn tiltUp(p : vec3f, t : vec3f) -> vec3f {
  let k = vec3f(t.z, 0.0, -t.x);
  return p + cross(k, p) + cross(k, cross(k, p)) / (1.0 + t.y);
}

@vertex
fn vs(in : VsIn) -> VsOut {
  let inst = instances[visible[in.iid]];
  let tn2 = unpack2x16snorm(inst.nrm);
  let tn = vec3f(tn2.x, sqrt(max(1.0 - dot(tn2, tn2), 0.0)), tn2.y);
  let t = normalize(mix(vec3f(0.0, 1.0, 0.0), tn, TILT));
  let world = inst.pos + tiltUp(yawRotate(in.pos, inst.yaw), t) * inst.scale;

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = tiltUp(yawRotate(octDecode(in.oct), inst.yaw), t);
  o.local = in.pos * inst.scale;
  o.ids = vec2u(inst.variant, inst.tint);
  o.ao = in.attr.x;
  o.motion = motionVector(world);
  o.radius = inst.scale;
  return o;
}

fn vnoise3(p : vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let b = bitcast<vec3u>(vec3i(i));
  let x00 = mix(hash31(b), hash31(b + vec3u(1u, 0u, 0u)), u.x);
  let x10 = mix(hash31(b + vec3u(0u, 1u, 0u)), hash31(b + vec3u(1u, 1u, 0u)), u.x);
  let x01 = mix(hash31(b + vec3u(0u, 0u, 1u)), hash31(b + vec3u(1u, 0u, 1u)), u.x);
  let x11 = mix(hash31(b + vec3u(0u, 1u, 1u)), hash31(b + vec3u(1u, 1u, 1u)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn rockGrain(p : vec3f) -> f32 {
  return 0.6 * vnoise3(p * 5.0) + 0.3 * vnoise3(p * 13.0 + 3.7) + 0.1 * vnoise3(p * 31.0 + 9.1);
}

// Fracture grooves: thin valleys where a stretched 3D noise crosses its mid value, fading in and out along their length.
fn rockFracture(p : vec3f) -> f32 {
  let a = 1.0 - smoothstep(0.0, 0.035, abs(vnoise3(p * vec3f(1.1, 3.2, 1.1) + 7.0) - 0.5));
  let b = 1.0 - smoothstep(0.0, 0.03, abs(vnoise3(p * vec3f(3.0, 1.2, 2.6) + 19.0) - 0.5));
  return max(a * smoothstep(0.45, 0.65, vnoise3(p * 0.9 + 3.0)), b * smoothstep(0.5, 0.7, vnoise3(p * 1.1 + 11.0)));
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  let lp = in.local;
  let warp = vnoise3(lp * 1.7 + 11.0);
  let strata = 0.5 + 0.5 * sin(lp.y * 9.0 + 3.0 * warp + lp.x * 1.3);
  let grain = rockGrain(lp);
  let crystals = vnoise3(lp * 90.0);
  let fracture = rockFracture(lp);
  let stain = smoothstep(0.58, 0.85, vnoise3(lp * 2.3 + 5.0));
  // Bedrock of the district, the stone's own tone, banding, grain and salt-and-pepper crystals.
  // Weathered, lichen-dulled stone sits below the bare outcrop's albedo.
  var col = 0.75 * glBaseColor(GL_ROCK) * bedrockTone(in.world.xz) * tint * (0.82 + 0.3 * strata) * (0.8 + 0.4 * grain) * (0.88 + 0.24 * crystals);
  col = mix(col, col * vec3f(1.25, 0.98, 0.72), 0.45 * stain);
  col *= 1.0 - 0.55 * fracture;

  // Bump from one evaluation: the relief height in metres, differentiated across the pixel quad (surface-gradient bump mapping).
  var n = normalize(in.nrm);
  let relief = BUMP * grain - 0.012 * fracture;
  let dpx = dpdx(in.world);
  let dpy = dpdy(in.world);
  let r1 = cross(dpy, n);
  let r2 = cross(n, dpx);
  let det = dot(dpx, r1);
  let surfGrad = sign(det) * (dpdx(relief) * r1 + dpdy(relief) * r2);
  n = normalize(abs(det) * n - surfGrad);

  // Height of this point above the ground under it: the foot is stained with soil, damp and in the stone's own shadow.
  let above = in.world.y - terrainHeightAt(in.world.xz);
  let footN = vnoise3(lp * 6.0 + 2.0);
  let foot = 1.0 - smoothstep(0.02, 0.10 + 0.12 * footN + 0.05 * in.radius, above);
  let footAo = mix(0.55, 1.0, smoothstep(0.0, 0.25 + 0.2 * in.radius, above));

  // Crustose lichen rosettes on exposed faces (pale grey-green, the odd orange one) and moss cushions on the tops and the shaded foot.
  // Rosettes a few centimetres across with ragged, lobed rims (a fine noise eats into the edge) and only a modest contrast with the stone.
  let lcell = vnoise3(lp * 16.0 + 31.0) + 0.18 * (vnoise3(lp * 55.0 + 7.0) - 0.5);
  let lichen = smoothstep(0.62, 0.74, lcell) * smoothstep(0.4, 0.65, vnoise3(lp * 1.5 + 17.0)) * (1.0 - foot);
  let lichenCol = select(LICHEN_GREY, LICHEN_ORANGE, vnoise3(lp * 0.8 + 51.0) > 0.8) * (0.8 + 0.4 * grain);
  col = mix(col, lichenCol, 0.55 * lichen);
  let mossTop = smoothstep(0.55, 0.9, n.y) * smoothstep(0.4, 0.65, vnoise3(lp * 3.1 + 2.0)) * smoothstep(0.0, 0.25, lp.y);
  let mossFoot = foot * smoothstep(0.45, 0.7, vnoise3(lp * 4.0 + 9.0)) * 0.7;
  let moss = max(mossTop, mossFoot);
  col = mix(col, MOSS * (0.7 + 0.6 * grain), 0.75 * moss);
  col = mix(col, FOOT_SOIL * (0.8 + 0.4 * footN), 0.7 * foot * (1.0 - moss));

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), saturate1(in.ao * footAo * (0.75 + 0.25 * grain) * (1.0 - 0.4 * fracture)));
  o.normal = vec4f(octEncode(n), mix(mix(ROCK_ROUGHNESS, 0.92, lichen), 0.95, moss), 0.0);
  o.misc = vec4f(ROCK_ID / 255.0, 0.0, 0.35 * foot, 0.0);
  o.motion = in.motion;
  return o;
}
