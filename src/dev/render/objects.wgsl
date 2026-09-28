// Dev props for the render harness. Each instance is a unit mesh scaled per axis, then rotated about +Y and translated.
// Prepended with rc.shader('common/world_bindings.wgsl') (frame, world bindings, math helpers) by objects.ts.
struct Inst {
  posYaw : vec4f,  // xyz = centre, w = yaw (rad)
  scale : vec4f,   // xyz = per-axis scale, w = MaterialId
  albedo : vec4f,  // rgb = albedo, a = roughness
  mat : vec4f,     // x = metalness, y = wetness, z = translucency, w = emissive strength
};
@group(2) @binding(0) var<storage, read> insts : array<Inst>;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) normal : vec3f,
  @location(1) prevClip : vec4f,
  @location(2) currClip : vec4f,
  @location(3) @interpolate(flat) inst : u32,
  @location(4) world : vec3f,
};

fn rotY(v : vec3f, yaw : f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn uvOfClip(clip : vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

@vertex fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @builtin(instance_index) ii : u32) -> VsOut {
  let inst = insts[ii];
  let world = inst.posYaw.xyz + rotY(p * inst.scale.xyz, inst.posYaw.w);
  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.normal = rotY(n / inst.scale.xyz, inst.posYaw.w);
  o.prevClip = frame.prevViewProj * vec4f(world, 1.0);
  o.currClip = frame.viewProjUnjittered * vec4f(world, 1.0);
  o.inst = ii;
  o.world = world;
  return o;
}

struct FsOut {
  @location(0) albedo : vec4f,
  @location(1) normal : vec4f,
  @location(2) misc : vec4f,
  @location(3) motion : vec2f,
};

@fragment fn fs(in : VsOut) -> FsOut {
  let inst = insts[in.inst];
  var o : FsOut;
  // Instance 0 is the ground: a faint fading pattern so perspective and motion are readable on an otherwise flat plane.
  let fade = 1.0 / (1.0 + 0.01 * length(in.world - frame.camPos.xyz));
  let pattern = 1.0 + select(0.0, 0.14 * fade * sin(in.world.x * 0.7) * sin(in.world.z * 0.7), in.inst == 0u);
  o.albedo = vec4f(inst.albedo.rgb * pattern, 1.0);
  o.normal = vec4f(octEncode(normalize(in.normal)), inst.albedo.a, inst.mat.x);
  o.misc = vec4f(inst.scale.w / 255.0, inst.mat.z, inst.mat.y, inst.mat.w);
  o.motion = uvOfClip(in.prevClip) - uvOfClip(in.currClip);
  return o;
}
