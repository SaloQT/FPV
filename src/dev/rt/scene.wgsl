// RT dev scene: the terrain heightfield and every registered proxy as world-space triangles, written into the G-buffer.
// Prepended with rc.shader('common/world_bindings.wgsl'). Material 0 is the ground; the moving prop is stored around the origin
// and offset by `mover` (current, previous position) so its motion vectors are exact.
struct Mat {
  albedo : vec4f,  // rgb = albedo, a = roughness
  mat : vec4f,     // x = metalness, y = wetness, z = emissive strength, w = checker amplitude
  id : vec4f,      // x = MaterialId, y = 1 when the mover offset applies
};
@group(2) @binding(0) var<storage, read> mats : array<Mat>;
@group(2) @binding(1) var<uniform> mover : array<vec4f, 2>;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) normal : vec3f,
  @location(1) prevClip : vec4f,
  @location(2) currClip : vec4f,
  @location(3) @interpolate(flat) mat : u32,
  @location(4) world : vec3f,
};

fn uvOfClip(clip : vec4f) -> vec2f {
  let ndc = clip.xy / clip.w;
  return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

@vertex fn vs(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) m : f32) -> VsOut {
  let mi = u32(m);
  let moving = mats[mi].id.y > 0.5;
  let world = p + select(vec3f(0.0), mover[0].xyz, moving);
  let prevWorld = p + select(vec3f(0.0), mover[1].xyz, moving);
  var o : VsOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.normal = n;
  o.prevClip = frame.prevViewProj * vec4f(prevWorld, 1.0);
  o.currClip = frame.viewProjUnjittered * vec4f(world, 1.0);
  o.mat = mi;
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
  let mt = mats[in.mat];
  let cell = vec2i(floor(in.world.xz * 0.5));
  let checker = select(-0.5, 0.5, ((cell.x + cell.y) & 1) == 0);
  var o : FsOut;
  o.albedo = vec4f(mt.albedo.rgb * (1.0 + mt.mat.w * checker), 1.0);
  o.normal = vec4f(octEncode(normalize(in.normal)), mt.albedo.a, mt.mat.x);
  o.misc = vec4f(mt.id.x / 255.0, 0.0, mt.mat.y, mt.mat.z);
  o.motion = uvOfClip(in.prevClip) - uvOfClip(in.currClip);
  return o;
}
