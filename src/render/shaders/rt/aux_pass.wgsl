// Aux pass: linear depth and normal/roughness/metalness of the full-res pixel each RT texel represents this frame (rtSourcePixel).
// Read by the trace passes, the temporal/a-trous filters and (via the same pixel mapping) the bilateral upsample in lighting.
#include "rt/rt_common.wgsl"
#include "common/world_bindings.wgsl"

@group(${GRP}) @binding(1) var gDepth : texture_depth_2d;
@group(${GRP}) @binding(2) var gNormal : texture_2d<f32>;
@group(${GRP}) @binding(3) var gMisc : texture_2d<f32>;
@group(${GRP}) @binding(4) var rtDepthOut : texture_storage_2d<r32float, write>;
@group(${GRP}) @binding(5) var rtNormalOut : texture_storage_2d<rgba16float, write>;

// Metalness value the aux normal's w carries for a leaf (above any real metalness, which is at most 1).
const AUX_FOLIAGE : f32 = 2.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let src = rtSrc(px);
  let z = linearDepth(textureLoad(gDepth, src, 0));
  var nrm = textureLoad(gNormal, src, 0);
  let misc = textureLoad(gMisc, src, 0);
  // misc.b is wetness, except on trees, where it is the shadow of the bark's furrows (tree.wgsl).
  let mat = u32(misc.r * 255.0 + 0.5);
  let wet = select(misc.b, 0.0, mat == 5u);
  // Thin grass alternates with the ground as coverage and sample pixels change. A blade's shading normal is unsuitable
  // for ray bias and history validation: use the underlying sward plane, while deferred lighting keeps the blade normal.
  let grass = u32(misc.r * 255.0 + 0.5) == 2u && misc.g > 0.0;
  if (grass && z > 0.0 && (rp.cfg.w & FLAG_TERRAIN) != 0u) {
    let pos = worldFromLinear(pixelUv(src), z);
    nrm = vec4f(octEncode(terrainNormalAt(pos.xz)), nrm.zw);
  }
  textureStore(rtDepthOut, px, vec4f(z, 0.0, 0.0, 0.0));
  // Foliage is never metal: its w carries AUX_FOLIAGE instead, so the trace passes know a leaf (rt_trace_io.wgsl loadPixel).
  textureStore(rtNormalOut, px, vec4f(nrm.xy, nrm.z * mix(1.0, 0.4, wet), select(nrm.w, AUX_FOLIAGE, mat == 5u)));
}
