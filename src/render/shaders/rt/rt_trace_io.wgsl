// Bindings shared by the per-pixel trace passes (shadow, gi, spec): RT-domain aux inputs and two raw outputs.
#include "rt/rt_scene.wgsl"

@group(${GRP}) @binding(6) var auxDepth : texture_2d<f32>;
@group(${GRP}) @binding(7) var auxNormal : texture_2d<f32>;
@group(${GRP}) @binding(8) var out0 : texture_storage_2d<rgba16float, write>;
@group(${GRP}) @binding(9) var out1 : texture_storage_2d<rgba16float, write>;

struct PixelInfo { ok : bool, z : f32, n : vec3f, rough : f32, metal : f32, pos : vec3f }

// Surface seen by RT texel `px` this frame (from the aux pass): world position, normal, effective roughness, metalness.
fn loadPixel(px : vec2i) -> PixelInfo {
  let z = textureLoad(auxDepth, px, 0).x;
  let a = textureLoad(auxNormal, px, 0);
  if (z <= 0.0) { return PixelInfo(false, 0.0, vec3f(0.0, 1.0, 0.0), 1.0, 0.0, vec3f(0.0)); }
  return PixelInfo(true, z, octDecode(a.xy), a.z, a.w, worldFromLinear(pixelUv(rtSrc(px)), z));
}

fn inRt(gid : vec2u) -> bool { return all(gid < rp.dims.xy); }
