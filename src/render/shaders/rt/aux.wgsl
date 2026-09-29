// Aux pass: linear depth and normal/roughness/metalness of the full-res pixel each RT texel represents this frame (rtSourcePixel).
// Read by the trace passes, the temporal/a-trous filters and (via the same pixel mapping) the bilateral upsample in lighting.
#include "rt/rt_common.wgsl"

@group(${GRP}) @binding(1) var gDepth : texture_depth_2d;
@group(${GRP}) @binding(2) var gNormal : texture_2d<f32>;
@group(${GRP}) @binding(3) var gMisc : texture_2d<f32>;
@group(${GRP}) @binding(4) var rtDepthOut : texture_storage_2d<r32float, write>;
@group(${GRP}) @binding(5) var rtNormalOut : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let src = rtSrc(px);
  let z = linearDepth(textureLoad(gDepth, src, 0));
  let nrm = textureLoad(gNormal, src, 0);
  let wet = textureLoad(gMisc, src, 0).b;
  textureStore(rtDepthOut, px, vec4f(z, 0.0, 0.0, 0.0));
  textureStore(rtNormalOut, px, vec4f(nrm.xy, nrm.z * mix(1.0, 0.4, wet), nrm.w));
}
