// Camera auto white balance. `meter` reads the light falling on each sampled surface the way the deferred pass computes it: the key
// light (sun irradiance through the atmosphere, times its traced visibility and cosine) plus the diffuse GI (irradiance / pi and its
// visibility). That is a grey card at every pixel, whatever colour the surface is, so a frame of green leaves is not taken for a green
// light (a grey-world camera's mistake). Their mean log-chromaticity (ln r/g, ln b/g) is the illuminant estimate, each pixel weighted by the
// square root of its light: bright surfaces lead, as they do in a camera's white balance, so an open field balances on the sun and sky even
// with the shaded sides of trees in view, while a frame of forest shade, a few sunflecks aside, balances on the skylight there. `resolve` smooths it over time and turns
// it into the partial correction toward D65 a camera makes (post/whiteBalance.ts, whiteBalanceGains, mirrors it), written as red and blue
// gains into exposure.look.zw.
#include "common/world_bindings.wgsl"
#include "lighting/sky_safe.wgsl"

const WB_STRIDE : u32 = ${WB_STRIDE}u;
const WB_MAX_DIST : f32 = ${WB_MAX_DIST};
const WB_MIN_COUNT : f32 = ${WB_MIN_COUNT};
const WB_STRENGTH : f32 = ${WB_STRENGTH};
const WB_SOFT : f32 = ${WB_SOFT};
const WB_TAU : f32 = ${WB_TAU};
const WB_MAX_DT : f32 = ${WB_MAX_DT};
const WB_GAIN_LO : f32 = ${WB_GAIN_LO};
const WB_GAIN_HI : f32 = ${WB_GAIN_HI};
const WB_SUN_LO : f32 = ${WB_SUN_LO};
const WB_WARM_RG : f32 = ${WB_WARM_RG};
const WB_WARM_BG : f32 = ${WB_WARM_BG};
const WB_WARM_SUN_HI : f32 = ${WB_WARM_SUN_HI};
const WB_SUN_HI : f32 = ${WB_SUN_HI};
// ln(r/g), ln(b/g) of the fixed white point the night camera locks to (about 3600 K): it draws a moonless sky navy and the land cool grey.
const WB_NIGHT : vec2f = vec2f(${WB_NIGHT_RG}, ${WB_NIGHT_BG});
const WB_FIXED : f32 = 1024.0;
const WB_LIMIT : f32 = 2.0;
// Weights are sqrt(pre-exposed irradiance / pi), at most WB_MAX_WEIGHT (a sunlit surface is about 1.2, deep shade 0.3), stored x WB_WEIGHT_FIXED.
const WB_MAX_WEIGHT : f32 = 4.0;
const WB_WEIGHT_FIXED : f32 = 256.0;

struct Params { dt : f32, reset : u32, pad0 : u32, pad1 : u32 };

@group(2) @binding(0) var gNormal : texture_2d<f32>;
@group(2) @binding(1) var gMisc : texture_2d<f32>;
@group(2) @binding(2) var gDepth : texture_depth_2d;
@group(2) @binding(3) var sunShadowTex : texture_2d<f32>;
@group(2) @binding(4) var giDiffuseTex : texture_2d<f32>;
@group(2) @binding(5) var<uniform> params : Params;
// Weighted sums of ln(r/g) and ln(b/g), and the weight (fixed point).
@group(2) @binding(6) var<storage, read_write> sums : array<atomic<i32>, 3>;
// state[0..1] = smoothed estimate (ln r/g, ln b/g), state[2] = 1 once initialised.
@group(2) @binding(7) var<storage, read_write> state : array<f32, 4>;
// The exposure buffer (post/exposure.ts): [1] = sensor gain EV over daylight, written by the exposure reduce this frame; [6], [7] = the
// red and blue gains this pass writes (0 = none, the composite then uses 1).
@group(2) @binding(8) var<storage, read_write> exposureOut : array<f32, 8>;

var<workgroup> wgA : array<i32, 64>;
var<workgroup> wgB : array<i32, 64>;
var<workgroup> wgN : array<i32, 64>;

// Pre-exposed irradiance / pi on the surface at full-resolution pixel q, or 0 where there is no opaque, lit, near surface.
fn cardLight(q : vec2i, dims : vec2i) -> vec3f {
  let depth = textureLoad(gDepth, q, 0);
  if (depth <= 0.0 || frame.params.z / depth > WB_MAX_DIST) { return vec3f(0.0); }
  if (textureLoad(gMisc, q, 0).a > 0.0) { return vec3f(0.0); }
  let rtDims = vec2i(textureDimensions(giDiffuseTex));
  let rq = clamp(q * rtDims / dims, vec2i(0), rtDims - 1);
  let gi = textureLoad(giDiffuseTex, rq, 0);
  if (gi.a <= 0.0) { return vec3f(0.0); }
  let n = octDecode(textureLoad(gNormal, q, 0).xy);
  var light = gi.rgb * gi.a;
  if (frame.sunIrradiance.w != 0.0 && frame.misc.w != 1u) {
    let sunE = frame.sunIrradiance.rgb * frame.sunIrradiance.w * sampleTransmittance(atmosRadiusAtHeight(frame.camPos.y), frame.sunDir.y);
    let vis = saturate1(textureLoad(sunShadowTex, rq, 0).x);
    light += sunE * (vis * max(dot(n, frame.sunDir.xyz), 0.0) * INV_PI * frame.params.y);
  }
  return light;
}

@compute @workgroup_size(8, 8)
fn meter(@builtin(global_invocation_id) gid : vec3u, @builtin(local_invocation_index) li : u32) {
  let dims = vec2i(textureDimensions(gDepth));
  let q = vec2i(gid.xy * WB_STRIDE + vec2u(WB_STRIDE / 2u));
  var s = vec3f(0.0);
  if (all(q < dims)) {
    let light = cardLight(q, dims);
    if (all(light > vec3f(1e-9)) && all(light < vec3f(1e9))) {
      let w = min(sqrt(dot(light, vec3f(0.2126, 0.7152, 0.0722))), WB_MAX_WEIGHT);
      s = vec3f(clamp(log(light.r / light.g), -WB_LIMIT, WB_LIMIT), clamp(log(light.b / light.g), -WB_LIMIT, WB_LIMIT), 1.0) * w;
    }
  }
  wgA[li] = i32(round(s.x * WB_FIXED));
  wgB[li] = i32(round(s.y * WB_FIXED));
  wgN[li] = i32(round(s.z * WB_WEIGHT_FIXED));
  workgroupBarrier();
  for (var o = 32u; o > 0u; o >>= 1u) {
    if (li < o) { wgA[li] += wgA[li + o]; wgB[li] += wgB[li + o]; wgN[li] += wgN[li + o]; }
    workgroupBarrier();
  }
  if (li == 0u && wgN[0] > 0) {
    atomicAdd(&sums[0], wgA[0]);
    atomicAdd(&sums[1], wgB[0]);
    atomicAdd(&sums[2], wgN[0]);
  }
}

@compute @workgroup_size(1)
fn resolve() {
  let a = f32(atomicExchange(&sums[0], 0)) / WB_FIXED;
  let b = f32(atomicExchange(&sums[1], 0)) / WB_FIXED;
  let n = f32(atomicExchange(&sums[2], 0)) / WB_WEIGHT_FIXED;
  var est = vec2f(state[0], state[1]);
  let fresh = state[2] < 0.5 || params.reset != 0u;
  if (n >= WB_MIN_COUNT) {
    let want = vec2f(a, b) / n;
    let k = select(1.0 - exp(-clamp(params.dt, 0.0, WB_MAX_DT) / WB_TAU), 1.0, fresh);
    est += (want - est) * k;
    state[2] = 1.0;
  } else if (fresh) {
    est = vec2f(0.0);
  }
  state[0] = est.x;
  state[1] = est.y;
  // Partial correction: nearly all of a small cast, less of a strong one. It fades out once the sun is down (blue hour stays blue); at
  // golden hour it balances the skylit shade, so the sunlit parts read warm. In the dark the camera locks to its fixed night white point.
  let night = smoothstep(WB_GAIN_LO, WB_GAIN_HI, exposureOut[1]);
  let lowSun = 1.0 - smoothstep(WB_SUN_LO, WB_SUN_HI, frame.sunDir.y);
  let f = WB_STRENGTH / (1.0 + length(est) / WB_SOFT) * (1.0 - night) * (1.0 - lowSun);
  // Golden hour keeps part of its amber (goldenWarmth in whiteBalance.ts): a camera does not neutralise a low sun completely.
  let warm = smoothstep(WB_SUN_LO, 0.0, frame.sunDir.y) * (1.0 - smoothstep(WB_SUN_HI, WB_WARM_SUN_HI, frame.sunDir.y)) * (1.0 - night);
  let g = exp(-f * est + night * WB_NIGHT + warm * vec2f(WB_WARM_RG, WB_WARM_BG));
  // Gains (red, 1, blue) rescaled so a grey keeps its luminance; the composite rebuilds green from the two.
  let y = 0.2126 * g.x + 0.7152 + 0.0722 * g.y;
  exposureOut[6] = g.x / y;
  exposureOut[7] = g.y / y;
}
