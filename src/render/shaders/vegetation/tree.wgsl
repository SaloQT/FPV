// Trees and bushes: one indirect instanced draw per (variant, LOD). The vertex shader fetches the instance through the visible list built
// by tree_cull.wgsl and animates trunk sway, branch and leaf flutter and prop wash; the fragment shader alpha-tests leaf cards against the
// procedural atlas and shades bark procedurally. Vertex kind bytes are mirrored in src/render/vegetation/meshBuilder.ts (KIND).
#include "vegetation/veg_params.wgsl"
#include "vegetation/veg_wind.wgsl"
#include "vegetation/veg_instance.wgsl"
#include "terrain/gbuffer.wgsl"

@group(2) @binding(1) var<storage, read> instances : array<Instance>;
@group(2) @binding(2) var<storage, read> visible : array<u32>;
@group(2) @binding(3) var<storage, read> variants : array<Variant>;
@group(2) @binding(4) var atlas : texture_2d<f32>;

const FOLIAGE_ID : f32 = 5.0;
const ALPHA_CUT : f32 = 0.5;
const CLASS_PINE : u32 = 1u;
const CLASS_BIRCH : u32 = 2u;
const CLASS_FIRST_LEAF : u32 = 4u;
const BARK_ROUGHNESS : f32 = 0.9;
const LEAF_ROUGHNESS : f32 = 0.75;

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
  @location(3) @interpolate(flat) ids : vec3u,   // x = variant, y = tint, z = kind
  @location(4) shade : vec3f,                     // x = ambient occlusion, y = mesh height (m), z = branch phase
  @location(5) motion : vec2f,
};

// Displacement (m) of a vertex: crown lean and oscillation along the wind, branch sway, leaf flutter and prop wash.
fn treeSway(v : Variant, p : vec3f, local : vec3f, scale : f32, sway : f32, phase : f32, leaf : bool, idPhase : f32) -> vec3f {
  let time = frame.camPos.w;
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

@vertex
fn vs(in : VsIn) -> VsOut {
  let slot = visible[in.iid];
  let inst = instances[slot];
  let v = variants[inst.variant];
  let kind = u32(in.attr.z * 255.0 + 0.5);
  let idPhase = hash11(slot) * TAU;
  let local = yawRotate(in.pos, inst.yaw) * inst.scale;
  let pre = inst.pos + local;
  let world = pre + treeSway(v, pre, local, inst.scale, in.attr.y, in.attr.w, kind >= 128u, idPhase);

  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.world = world;
  o.nrm = yawRotate(octDecode(in.oct), inst.yaw);
  o.uv = in.uv;
  o.ids = vec3u(inst.variant, inst.tint, kind);
  o.shade = vec3f(in.attr.x, in.pos.y, in.attr.w);
  o.motion = motionVector(world);
  return o;
}

fn barkColor(cls : u32, uv : vec2f, height : f32, twig : bool) -> vec3f {
  let along = uv.y * 32.0;
  let ph = vegLattice(vec2f(0.5, along * 0.7)) * 6.0;
  let ridge = 0.5 + 0.5 * sin(uv.x * (TAU * 6.0) + ph);
  let fine = 0.5 + 0.5 * sin(uv.x * (TAU * 13.0) - ph * 1.7 + along * 3.0);
  let groove = mix(0.55, 1.0, ridge * (0.6 + 0.4 * fine));
  if (cls == CLASS_BIRCH) {
    let cell = vec2u(u32(floor(uv.x * 8.0)) & 7u, u32(floor(along * 7.0)));
    let mark = step(0.7, hash21(cell)) * step(fract(along * 7.0), 0.28);
    let paper = vec3f(0.62, 0.6, 0.55) * mix(0.85, 1.0, groove);
    return select(mix(paper, vec3f(0.05, 0.04, 0.035), mark * 0.85), vec3f(0.11, 0.075, 0.05) * groove, twig);
  }
  if (cls == CLASS_PINE) {
    let upper = smoothstep(3.0, 8.0, height);
    return mix(vec3f(0.11, 0.085, 0.07), vec3f(0.3, 0.14, 0.055), upper) * groove;
  }
  return vec3f(0.16, 0.105, 0.065) * mix(0.45, 1.0, groove);
}

@fragment
fn fs(in : VsOut) -> FsOut {
  let a = textureSample(atlas, linearClamp, in.uv);
  let kind = in.ids.z;
  let cls = kind >> 5u;
  let leaf = cls >= CLASS_FIRST_LEAF;
  if (leaf && a.a < ALPHA_CUT) { discard; }

  let v = variants[in.ids.x];
  let tint = unpack4x8unorm(in.ids.y).rgb * 2.0;
  var col : vec3f;
  var rough = BARK_ROUGHNESS;
  var translucency = 0.0;
  if (leaf) {
    col = v.leafTone.rgb * a.rgb * tint;
    rough = LEAF_ROUGHNESS;
    translucency = v.leafTone.a;
  } else {
    col = barkColor(cls, in.uv, in.shade.y, in.shade.z > 0.004) * mix(vec3f(1.0), tint, 0.5);
  }

  var o : FsOut;
  o.albedo = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), in.shade.x);
  o.normal = vec4f(octEncode(normalize(in.nrm)), rough, 0.0);
  o.misc = vec4f(FOLIAGE_ID / 255.0, translucency, 0.0, 0.0);
  o.motion = in.motion;
  return o;
}
