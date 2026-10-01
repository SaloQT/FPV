// Static tree, bush and rock instances and the per-variant table, shared by the cull and draw shaders.
// Layouts mirrored by src/render/vegetation/instanceData.ts.
#include "vegetation/veg_params.wgsl"

struct Instance {
  pos : vec3f,
  scale : f32,     // uniform scale; a rock's radius in metres. 0 marks a padding slot
  yaw : f32,
  variant : u32,
  tint : u32,      // unorm8x4 colour multiplier, decoded as value * 2
  nrm : u32,       // terrain normal (x, z) as two snorm16
};

struct Variant {
  range : vec4u,     // x = first instance slot (multiple of 64), y = instance count, z = kind (0 tree, 1 bush, 2 rock)
  bound : vec4f,     // x = bounding sphere centre height, y = radius (m at scale 1), z = LOD0 range, w = LOD1 range (in radii)
  shape : vec4f,     // x = mesh height, y = sway Hz, z = sway strength (crown offset per m/s of wind, as a fraction of height), w = leaf flutter (m)
  leafTone : vec4f,  // rgb = leaf or rock albedo, a = translucency
};

const KIND_BUSH : u32 = 1u;

fn yawRotate(p : vec3f, yaw : f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Instances inside this relative band around a LOD hand-over distance are drawn at both LODs and dithered against each other.
const LOD_FADE_BAND : f32 = 0.12;

// Distances (m) at which an instance hands over from LOD0 to LOD1 and from LOD1 to LOD2 (the cull and the draw shaders must agree).
fn lodEdges(v : Variant, inst : Instance) -> vec2f {
  let reach = v.bound.y * inst.scale * vp.tree.x;
  return vec2f(v.bound.z, v.bound.w) * reach;
}
