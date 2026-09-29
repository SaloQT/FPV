// Rocks and boulders: the tree draw layout and instance path with a static vertex shader (the instance is tilted toward the terrain normal,
// scaled by its radius and yawed) and procedural strata, grain and moss in the fragment shader.
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_instance.wgsl"
#include "terrain/gbuffer.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> visible : array<u32>;
@group(2) @binding(3) var<storage, read> variants : array<Variant>;

const ROCK_ID : f32 = 6.0;
const ROCK_ROUGHNESS : f32 = 0.85;
// Share of the terrain tilt a rock follows: half-buried boulders sit on slopes without lying flat against them.
const TILT : f32 = 0.65;
// Normal tilt per unit of grain gradient (grain is sampled e metres apart).
const BUMP : f32 = 0.05;
const MOSS : vec3f = vec3f(0.055, 0.085, 0.03);

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

@fragment
fn fs(in : VsOut) -> FsOut {
  let v = variants[in.ids.x];
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  let lp = in.local;
  let warp = vnoise3(lp * 1.7 + 11.0);
  let strata = 0.5 + 0.5 * sin(lp.y * 9.0 + 3.0 * warp + lp.x * 1.3);
  let grain = rockGrain(lp);
  let rust = smoothstep(0.55, 0.85, vnoise3(lp * 2.3 + 5.0));
  var col = v.leafTone.rgb * tint * (0.7 + 0.4 * strata) * (0.78 + 0.44 * grain);
  col = mix(col, col * vec3f(1.25, 0.95, 0.7), 0.5 * rust);

  var n = normalize(in.nrm);
  let e = 0.04;
  let g = vec3f(rockGrain(lp + vec3f(e, 0.0, 0.0)), rockGrain(lp + vec3f(0.0, e, 0.0)), rockGrain(lp + vec3f(0.0, 0.0, e))) - grain;
  n = normalize(n - (g - n * dot(g, n)) * (BUMP / e));

  let moss = smoothstep(0.6, 0.92, n.y) * smoothstep(0.35, 0.65, vnoise3(lp * 3.1 + 2.0)) * smoothstep(0.0, 0.25, lp.y);
  col = mix(col, MOSS * (0.7 + 0.6 * grain), 0.7 * moss);

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), saturate1(in.ao * (0.75 + 0.25 * grain)));
  o.normal = vec4f(octEncode(n), mix(ROCK_ROUGHNESS, 0.95, moss), 0.0);
  o.misc = vec4f(ROCK_ID / 255.0, 0.0, 0.0, 0.0);
  o.motion = in.motion;
  return o;
}
