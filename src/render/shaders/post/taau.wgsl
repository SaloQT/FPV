// Temporal upsampling (TAAU) + resolve, one compute thread per OUTPUT pixel. Render res <= out res.
//   current  : 3x3 render-res taps around the pixel, weighted by the distance between each tap's jittered sample position and the output
//              pixel centre (gaussian fit of a Blackman-Harris window, Karis 2014), Karis 1/(1+luma) weights against fireflies
//   history  : out-res rgba16f (rgb pre-exposed, a = view depth of the closest sample), Catmull-Rom 5-tap reprojection by the motion
//              vector of the closest-depth tap, variance clipped in YCoCg (Salvi 2016), depth-based disocclusion
//   blend    : in the luma-compressed domain (c / (1 + luma)), which is a luminance-weighted average of the HDR values.
// Jitter convention (frameUniforms.ts): the jittered image is the scene shifted by +jitter NDC, so render pixel j samples the scene at the
// UNJITTERED position j + 0.5 - jitterPx, jitterPx = (jitter.x, -jitter.y) * 0.5 * renderSize.
#include "common/frame.wgsl"
#include "common/math.wgsl"

const HDR_MAX : f32 = 65000.0;
const SKY_W : f32 = 60000.0;
const KERNEL_K : f32 = ${KERNEL_K};
const KERNEL_SUM : f32 = 3.14159265 / KERNEL_K;
const VARIANCE_GAMMA : f32 = ${VARIANCE_GAMMA};
const FEEDBACK : f32 = ${FEEDBACK};
const FEEDBACK_MOTION : f32 = ${FEEDBACK_MOTION};
const MOTION_PX : f32 = ${MOTION_PX};
const DISOCC_LO : f32 = ${DISOCC_LO};
const DISOCC_HI : f32 = ${DISOCC_HI};

struct TaaParams {
  histScale : f32, // preExposure / prevPreExposure
  reset : u32,     // 1 = ignore the history texture
  pad : vec2u,
};

@group(1) @binding(0) var<uniform> taa : TaaParams;
@group(1) @binding(1) var histTex : texture_2d<f32>;
@group(1) @binding(2) var linSamp : sampler;
@group(1) @binding(3) var outResolved : texture_storage_2d<rgba16float, write>;
@group(1) @binding(4) var outHist : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var motionTex : texture_2d<f32>;
@group(1) @binding(6) var depthTex : texture_depth_2d;
@group(2) @binding(0) var inputTex : texture_2d<f32>;

fn toYCoCg(c : vec3f) -> vec3f {
  return vec3f(0.25 * c.x + 0.5 * c.y + 0.25 * c.z, 0.5 * c.x - 0.5 * c.z, -0.25 * c.x + 0.5 * c.y - 0.25 * c.z);
}

fn fromYCoCg(c : vec3f) -> vec3f {
  let t = c.x - c.z;
  return vec3f(t + c.y, c.x + c.z, t - c.y);
}

// Moves q along the ray towards the box centre until it is inside the box.
fn clipToBox(lo : vec3f, hi : vec3f, q : vec3f) -> vec3f {
  let centre = 0.5 * (lo + hi);
  let ext = 0.5 * (hi - lo) + 1e-5;
  let r = q - centre;
  let a = abs(r) / ext;
  let m = max(a.x, max(a.y, a.z));
  return select(q, centre + r / m, m > 1.0);
}

fn compress(c : vec3f) -> vec3f { return c / (1.0 + luminance(c)); }

fn decompress(c : vec3f) -> vec3f {
  let l = min(luminance(c), 0.99998);
  return clamp(c / (1.0 - l), vec3f(0.0), vec3f(HDR_MAX));
}

// 5-tap Catmull-Rom (corner taps dropped) on the bilinear hardware; the alpha channel (depth) is not interpolated.
fn historyCatmullRom(uv : vec2f, size : vec2f) -> vec3f {
  let pos = uv * size;
  let p1 = floor(pos - 0.5) + 0.5;
  let f = pos - p1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let p0 = (p1 - 1.0) / size;
  let p3 = (p1 + 2.0) / size;
  let p12 = (p1 + w2 / w12) / size;
  let sum = textureSampleLevel(histTex, linSamp, vec2f(p12.x, p0.y), 0.0).rgb * (w12.x * w0.y)
          + textureSampleLevel(histTex, linSamp, vec2f(p0.x, p12.y), 0.0).rgb * (w0.x * w12.y)
          + textureSampleLevel(histTex, linSamp, p12, 0.0).rgb * (w12.x * w12.y)
          + textureSampleLevel(histTex, linSamp, vec2f(p3.x, p12.y), 0.0).rgb * (w3.x * w12.y)
          + textureSampleLevel(histTex, linSamp, vec2f(p12.x, p3.y), 0.0).rgb * (w12.x * w3.y);
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(sum / wsum, vec3f(0.0));
}

// Sky pixels have no useful motion vector: a point at infinity only rotates, so project the view ray with the previous rotation.
// Returns the previous-frame UV in xy and 1 in z when the ray was in front of the previous camera.
fn skyPrevUv(jitteredUv : vec2f) -> vec3f {
  let clip = frame.prevViewProj * vec4f(viewRayDir(jitteredUv), 0.0);
  let ndc = clip.xy / max(clip.w, 1e-6);
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, select(0.0, 1.0, clip.w > 1e-6));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let outSize = textureDimensions(outResolved);
  if (gid.x >= outSize.x || gid.y >= outSize.y) { return; }
  let oSize = vec2f(outSize);
  let rDim = textureDimensions(inputTex);
  let rSize = vec2f(rDim);
  let rMax = vec2i(rDim) - vec2i(1);
  let uv = (vec2f(gid.xy) + 0.5) / oSize;
  let jit = vec2f(frame.jitter.x, -frame.jitter.y) * 0.5 * rSize;
  let c = uv * rSize;
  let base = vec2i(floor(c + jit));
  // Supersampled input (ratio > 1) widens the kernel to output-pixel units; the 3x3 gather then truncates it.
  let rk = max(rSize / oSize, vec2f(1.0));

  var cSum = vec3f(0.0);
  var lSum = 0.0;
  var wSum = 0.0;
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var bMin = vec3f(1e9);
  var bMax = vec3f(-1e9);
  var dMax = 0.0;
  var dPix = clamp(base, vec2i(0), rMax);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let p = base + vec2i(i, j);
      let t = clamp(p, vec2i(0), rMax);
      let s = clamp(textureLoad(inputTex, t, 0).rgb, vec3f(0.0), vec3f(HDR_MAX));
      let d = (vec2f(p) + 0.5 - jit - c) / rk;
      let w = exp(-KERNEL_K * dot(d, d));
      let kw = 1.0 / (1.0 + luminance(s));
      cSum += s * (w * kw);
      lSum += w * kw;
      wSum += w;
      let q = toYCoCg(s * kw);
      m1 += q;
      m2 += q * q;
      bMin = min(bMin, q);
      bMax = max(bMax, q);
      let z = textureLoad(depthTex, t, 0);
      if (z > dMax) { dMax = z; dPix = t; }
    }
  }
  let cur = cSum / max(lSum, 1e-9);
  let curC = compress(cur);
  let storeW = select(SKY_W, min(frame.params.z / max(dMax, 1e-9), SKY_W), dMax > 0.0);

  var result = curC;
  if (taa.reset == 0u) {
    var mv = textureLoad(motionTex, dPix, 0).rg;
    var valid = true;
    if (dMax <= 0.0) {
      let sp = skyPrevUv((c + jit) / rSize);
      mv = sp.xy - uv;
      valid = sp.z > 0.5;
    }
    let prevUv = uv + mv;
    valid = valid && all(prevUv >= vec2f(0.0)) && all(prevUv <= vec2f(1.0));
    if (valid) {
      let hist = clamp(historyCatmullRom(prevUv, oSize) * taa.histScale, vec3f(0.0), vec3f(HDR_MAX));
      let mean = m1 / 9.0;
      let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
      let lo = max(bMin, mean - VARIANCE_GAMMA * sigma);
      let hi = min(bMax, mean + VARIANCE_GAMMA * sigma);
      let histC = fromYCoCg(clipToBox(lo, hi, toYCoCg(compress(hist))));

      let speedPx = length(mv * oSize);
      let feedback = mix(FEEDBACK, FEEDBACK_MOTION, smoothstep(0.0, MOTION_PX, speedPx));
      // Current-frame weight scales with how much kernel mass this frame's jitter placed on the pixel (expected mass = KERNEL_SUM).
      var alpha = clamp((1.0 - feedback) * wSum / KERNEL_SUM, 0.0, 1.0);
      if (dMax > 0.0) {
        // The previous view depth of this surface vs the depth stored in the history: a closer history means it was occluded then.
        let world = worldFromDepth((vec2f(dPix) + 0.5) / rSize, dMax);
        let prevW = (frame.prevViewProj * vec4f(world, 1.0)).w;
        if (prevW > 1e-3) {
          let g = textureGather(3, histTex, linSamp, prevUv);
          let hw = min(min(g.x, g.y), min(g.z, g.w));
          alpha = max(alpha, smoothstep(DISOCC_LO, DISOCC_HI, (prevW - hw) / prevW));
        }
      }
      result = mix(histC, curC, alpha);
    }
  }
  let outC = decompress(max(result, vec3f(0.0)));
  textureStore(outResolved, gid.xy, vec4f(outC, 1.0));
  textureStore(outHist, gid.xy, vec4f(outC, storeW));
}

// TAA disabled: plain bilinear resample of the render-res image (jitter-corrected, so it is exact when the ratio is 1).
@compute @workgroup_size(8, 8, 1)
fn upsample(@builtin(global_invocation_id) gid : vec3u) {
  let outSize = textureDimensions(outResolved);
  if (gid.x >= outSize.x || gid.y >= outSize.y) { return; }
  let rSize = vec2f(textureDimensions(inputTex));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(outSize);
  let jit = vec2f(frame.jitter.x, -frame.jitter.y) * 0.5 * rSize;
  let s = clamp(textureSampleLevel(inputTex, linSamp, (uv * rSize + jit) / rSize, 0.0).rgb, vec3f(0.0), vec3f(HDR_MAX));
  textureStore(outResolved, gid.xy, vec4f(s, 1.0));
}
