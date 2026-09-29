// Cloud temporal resolve (compute): blends this frame's jittered march with the reprojected history, clamped to the current 3x3
// neighbourhood (Karis 2014) so a moving cloud edge or a camera turn never smears. Clouds are km away, so the history is reprojected by
// DIRECTION: a direction (w = 0) carries no camera translation through frame.prevViewProj (previous frame, unjittered).
//
// UNIT CHAIN: texels are (rgb = in-scattered radiance [nits] / CLOUD_STORE_SCALE, a = transmittance), linear and never pre-exposed;
// this pass only averages them. AtmosParams.cloudD.x = history weight (0.9), cloudD.y = 1 when the history holds the previous frame.
//
// Group 1: 0 linearClamp, 3 output (rgba16float), 5 AtmosParams, 9 this frame's march, 10 history.
#include "common/math.wgsl"
#include "common/frame.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(1) @binding(0) var linearClamp : sampler;
@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var<uniform> ap : AtmosParams;
@group(1) @binding(9) var currentTex : texture_2d<f32>;
@group(1) @binding(10) var historyTex : texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel = vec2i(gid.xy);
  let hi = vec2i(dims) - vec2i(1);
  var lo4 = vec4f(1e9);
  var hi4 = vec4f(-1e9);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let v = textureLoad(currentTex, clamp(texel + vec2i(x, y), vec2i(0), hi), 0);
      lo4 = min(lo4, v);
      hi4 = max(hi4, v);
    }
  }
  let cur = textureLoad(currentTex, texel, 0);

  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let q = frame.prevViewProj * vec4f(viewRayDir(uv), 0.0);
  var blend = ap.cloudD.x * ap.cloudD.y;
  var prevUv = vec2f(-1.0);
  if (q.w > 1e-6) {
    let ndc = q.xy / q.w;
    prevUv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  }
  if (any(prevUv < vec2f(0.0)) || any(prevUv > vec2f(1.0))) { blend = 0.0; }
  let history = clamp(textureSampleLevel(historyTex, linearClamp, prevUv, 0.0), lo4, hi4);
  textureStore(outTex, texel, mix(cur, history, blend));
}
