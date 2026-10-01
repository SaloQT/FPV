// Temporal accumulation of one raw trace signal (SVGF-lite). Defines: SHADOW | GI | SPEC (signal), CAP (history length cap, float literal).
// Reprojects the previous accumulated value with the motion vector, validates it against the previous frame's depth and normal, blends
// with alpha = max(1/(len+1), 1/CAP), and writes the moments (m1, m2, history length, variance) that steer the a-trous filter.
#include "rt/rt_common.wgsl"

@group(${GRP}) @binding(1) var auxDepth : texture_2d<f32>;
@group(${GRP}) @binding(2) var auxNormal : texture_2d<f32>;
@group(${GRP}) @binding(3) var prevDepth : texture_2d<f32>;
@group(${GRP}) @binding(4) var prevNormal : texture_2d<f32>;
@group(${GRP}) @binding(5) var gMotion : texture_2d<f32>;
@group(${GRP}) @binding(6) var rawTex : texture_2d<f32>;
@group(${GRP}) @binding(7) var raw2Tex : texture_2d<f32>;
@group(${GRP}) @binding(8) var histPrev : texture_2d<f32>;
@group(${GRP}) @binding(9) var momPrev : texture_2d<f32>;
@group(${GRP}) @binding(10) var<storage, read> prevPre : array<f32>;
@group(${GRP}) @binding(11) var histCur : texture_storage_2d<rgba16float, write>;
@group(${GRP}) @binding(12) var momCur : texture_storage_2d<rgba16float, write>;

const HIST_CAP : f32 = ${CAP};
const MAX_LEN : f32 = 64.0;
const MIN_WEIGHT : f32 = 0.05;
const MIN_INCIDENCE : f32 = 0.01;
const SLOPE_SLACK_PX : f32 = 0.35;
// Luminance is capped before it enters the moments: m2 = l^2 is stored in fp16, which overflows from l = 255 (an Inf there becomes NaN in the a-trous weights).
const LUMA_CAP : f32 = 100.0;

// Depth (m) that the surface plane through posW with normal n gains per full-resolution pixel step in x and y. The history texel sampled a
// different pixel of its block (and TAA jitter moved the grid), and at grazing angles one pixel is metres of depth: the depth test must
// compare against the plane extrapolated to that texel's sample position, not against the depth at the reprojected point.
fn planeDepthSlope(posW : vec3f, n : vec3f, z : f32) -> vec2f {
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let up = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  let nd = dot(n, posW - frame.camPos.xyz) / z;
  let k = -z / (select(-1.0, 1.0, nd >= 0.0) * max(abs(nd), MIN_INCIDENCE));
  return vec2f(k * dot(n, right) * 2.0 * frame.screen.z / frame.proj[0][0], -k * dot(n, up) * 2.0 * frame.screen.w / frame.proj[1][1]);
}

fn signalLuma(v : vec4f) -> f32 {
#ifdef SHADOW
  return v.x;
#else
  return luminance(v.rgb);
#endif
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let dims = rtSize();
  let raw = fp16Safe(textureLoad(rawTex, px, 0));
  let z = textureLoad(auxDepth, px, 0).x;
  if (z <= 0.0) {
    textureStore(histCur, px, raw);
    textureStore(momCur, px, vec4f(0.0, 0.0, 1.0, 0.0));
    return;
  }

  var mean = 0.0;
  var sq = 0.0;
  var nCnt = 0.0;
  var nLuma = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(px + vec2i(i, j), vec2i(0), dims - vec2i(1));
      let s = fp16Safe(textureLoad(rawTex, q, 0));
      let l = min(signalLuma(s), LUMA_CAP);
      mean += l;
      sq += l * l;
      if ((i != 0 || j != 0) && s.a > 0.0) {
        nLuma += l;
        nCnt += 1.0;
      }
    }
  }
  mean = mean / 9.0;
  let spatialVar = max(sq / 9.0 - mean * mean, 0.0);

  var cur = raw;
#ifndef SHADOW
  if (nCnt > 0.0) {
    let lim = 3.0 * (nLuma / nCnt) + 0.02;
    let l = luminance(cur.rgb);
    if (l > lim) { cur = vec4f(cur.rgb * (lim / l), cur.a); }
  }
#endif

  let src = rtSrc(px);
  let uv = pixelUv(src);
  let n = octDecode(textureLoad(auxNormal, px, 0).xy);
  // From the texel centre rather than this frame's sample pixel, so a still camera reads its own history texel exactly (no bilinear blur).
  let motion = textureLoad(gMotion, src, 0).xy;
  let prevUv = (vec2f(px) + 0.5) / vec2f(dims) + motion;
  let posW = worldFromLinear(uv, z);
  let zPrev = (frame.prevViewProj * vec4f(posW, 1.0)).w;
  let slope = planeDepthSlope(posW, n, z);
  let fullPx = vec2f(fullSize());
  // Where the previous sample pixel sits relative to the reprojected point, in full-res pixels (jitter shifts the sampled position by -jitter).
  let gridShift = (frame.jitter.xy - frame.jitter.zw) * vec2f(0.5, -0.5) * fullPx - motion * fullPx;
  let prevFrame = frameIndex() - 1u;
  let tol = 0.03 * zPrev + 0.05 + SLOPE_SLACK_PX * (abs(slope.x) + abs(slope.y));
  let p = prevUv * vec2f(dims) - 0.5;
  let base = vec2i(floor(p));
  let f = p - floor(p);
  var hist = vec4f(0.0);
  var mom = vec4f(0.0);
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let q = base + o;
    if (any(q < vec2i(0)) || any(q >= dims)) { continue; }
    let pz = textureLoad(prevDepth, q, 0).x;
    let sp = rtSourcePixel(q, rtDivisor(), fullSize(), prevFrame);
    if (pz <= 0.0 || abs(pz - (zPrev + dot(slope, vec2f(sp - src) + gridShift))) > tol) { continue; }
    let pn = octDecode(textureLoad(prevNormal, q, 0).xy);
    let bil = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let w = bil * saturate1((dot(n, pn) - 0.7) / 0.25);
    let hq = textureLoad(histPrev, q, 0);
    let mq = textureLoad(momPrev, q, 0);
    // A non-finite history texel (NaN * 0 is still NaN) must never be blended in, or it spreads through every reprojection.
    if (!(all(abs(hq) <= vec4f(FP16_SAFE)) && all(abs(mq) <= vec4f(FP16_SAFE)))) { continue; }
    hist += hq * w;
    mom += mq * w;
    wSum += w;
  }

  let l = min(signalLuma(cur), LUMA_CAP);
  var res = cur;
  var len = 1.0;
  var m1 = l;
  var m2 = l * l;
  if (wSum > MIN_WEIGHT) {
    hist = hist / wSum;
    mom = mom / wSum;
#ifndef SHADOW
    let pp = prevPre[0];
    let ratio = select(1.0, frame.params.y / pp, pp > 0.0);
    hist = vec4f(hist.rgb * ratio, hist.a);
    mom = vec4f(min(mom.x * ratio, LUMA_CAP), min(mom.y * ratio * ratio, LUMA_CAP * LUMA_CAP), mom.z, min(mom.w, LUMA_CAP * LUMA_CAP));
#else
    let sigma = max(sqrt(spatialVar), 0.05);
    let clamped = clamp(hist.x, mean - 2.0 * sigma, mean + 2.0 * sigma);
    // A history the neighbourhood rejects outright is a shadow edge that moved: restart its length and moments so the variance does not stay inflated.
    let keep = 1.0 - saturate1((abs(clamped - hist.x) - 0.1) * 4.0);
    hist.x = clamped;
    mom = vec4f(mix(vec2f(l, l * l), mom.xy, keep), mom.z * keep, mom.w);
#endif
    let alpha = max(1.0 / (mom.z + 1.0), 1.0 / HIST_CAP);
    res = mix(hist, cur, alpha);
    len = min(mom.z + 1.0, MAX_LEN);
    m1 = mix(mom.x, l, alpha);
    m2 = mix(mom.y, l * l, alpha);
  }
  else {
#ifdef GI
    res = vec4f(mix(cur.rgb, textureLoad(raw2Tex, px, 0).rgb, 0.5), cur.a);
#endif
  }
  let temporalVar = max(m2 - m1 * m1, 0.0);
  let variance = mix(spatialVar, temporalVar, saturate1(len / 4.0));
  textureStore(histCur, px, fp16Safe(res));
  textureStore(momCur, px, fp16Safe(vec4f(m1, m2, len, min(variance, LUMA_CAP * LUMA_CAP))));
}
