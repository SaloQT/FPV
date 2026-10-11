// Bindings shared by the per-pixel trace passes (shadow, gi, spec): RT-domain aux inputs and two raw outputs.
#include "rt/rt_scene.wgsl"

@group(${GRP}) @binding(6) var auxDepth : texture_2d<f32>;
@group(${GRP}) @binding(7) var auxNormal : texture_2d<f32>;
#ifdef VISIBILITY_ONLY
@group(${GRP}) @binding(8) var out0 : texture_storage_2d<r32float, write>;
@group(${GRP}) @binding(9) var out1 : texture_storage_2d<r32float, write>;
#else
#ifdef TRACE_ONLY
@group(${GRP}) @binding(8) var out0 : texture_storage_2d<rg32float, write>;
@group(${GRP}) @binding(9) var out1 : texture_storage_2d<rg32float, write>;
#else
@group(${GRP}) @binding(8) var out0 : texture_storage_2d<rgba16float, write>;
@group(${GRP}) @binding(9) var out1 : texture_storage_2d<rgba16float, write>;
#endif
#endif

struct PixelInfo { ok : bool, z : f32, n : vec3f, rough : f32, metal : f32, pos : vec3f, leaf : bool }

// Surface seen by RT texel `px` this frame (from the aux pass): world position, normal, effective roughness, metalness, and whether it is a
// leaf (aux_pass.wgsl puts AUX_FOLIAGE, 2, in the metalness of foliage).
fn loadPixel(px : vec2i) -> PixelInfo {
  let z = textureLoad(auxDepth, px, 0).x;
  if (z <= 0.0) { return PixelInfo(false, 0.0, vec3f(0.0, 1.0, 0.0), 1.0, 0.0, vec3f(0.0), false); }
  let a = textureLoad(auxNormal, px, 0);
  return PixelInfo(true, z, octDecode(a.xy), a.z, min(a.w, 1.0), worldFromLinear(pixelUv(rtSrc(px)), z), a.w > 1.5);
}

fn inRt(gid : vec2u) -> bool { return all(gid < rp.dims.xy); }
