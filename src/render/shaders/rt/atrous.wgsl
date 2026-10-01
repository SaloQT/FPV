// One a-trous (edge-avoiding wavelet) iteration over a temporally accumulated signal. Defines: SHADOW | GI | SPEC, ITER (0.0/1.0/2.0),
// OUTFMT (storage format of the destination), FINAL (last iteration: applies the debug views and writes the G-buffer's own formats).
// Edge stops: world-space plane distance, normal, and luminance scaled by the temporal variance (tighter every iteration).
// Specular values are premultiplied by their confidence in .a; the FINAL pass divides it out and widens the stride with roughness.
#include "rt/rt_common.wgsl"

@group(${GRP}) @binding(1) var auxDepth : texture_2d<f32>;
@group(${GRP}) @binding(2) var auxNormal : texture_2d<f32>;
@group(${GRP}) @binding(3) var srcTex : texture_2d<f32>;
@group(${GRP}) @binding(4) var momTex : texture_2d<f32>;
@group(${GRP}) @binding(5) var dstTex : texture_storage_2d<${OUTFMT}, write>;

const ITER : f32 = ${ITER};
const LUMA_FLOOR : f32 = 0.01;
const AO_VIEW_NITS : f32 = 4000.0;

fn tapWeight(i : i32) -> f32 {
  let a = abs(i);
  return select(select(1.0 / 16.0, 4.0 / 16.0, a == 1), 6.0 / 16.0, a == 0);
}

fn tapLuma(v : vec4f) -> f32 {
#ifdef SHADOW
  return v.x;
#else
  return luminance(v.rgb);
#endif
}

fn dstValue(v : vec4f, px : vec2i) -> vec4f {
#ifdef FINAL
  let dbg = rp.dbg.x;
#ifdef SHADOW
  return vec4f(select(0.0, v.x, dbg <= 1u), 0.0, 0.0, 0.0);
#endif
#ifdef GI
  let pre = frame.params.y;
  let a = max(v.a, 1.0 / 255.0);
  switch (dbg) {
    case 1u: { return vec4f(0.0, 0.0, 0.0, 1.0 / 255.0); }
    case 3u: { return vec4f(vec3f(AO_VIEW_NITS * pre * v.a), 1.0); }
    case 4u: { return vec4f(0.0, 0.0, 0.0, 1.0); }
    case 6u: {
      let m = textureLoad(momTex, px, 0);
      return vec4f(vec3f(min(sqrt(m.w) * 4.0, 1.0), min(m.z / 16.0, 1.0), 0.0) * (AO_VIEW_NITS * pre), 1.0);
    }
    default: { return vec4f(max(v.rgb, vec3f(0.0)), a); }
  }
#endif
#ifdef SPEC
  let on = dbg == 0u || dbg == 4u;
  return select(vec4f(0.0), vec4f(max(v.rgb, vec3f(0.0)) / max(v.a, 0.02), v.a), on);
#endif
#else
  return v;
#endif
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (any(gid.xy >= rp.dims.xy)) { return; }
  let px = vec2i(gid.xy);
  let dims = rtSize();
  let z = textureLoad(auxDepth, px, 0).x;
  let centre = textureLoad(srcTex, px, 0);
  if (z <= 0.0) {
    textureStore(dstTex, px, fp16Safe(dstValue(centre, px)));
    return;
  }
  let an = textureLoad(auxNormal, px, 0);
  let n = octDecode(an.xy);
  let pos = worldFromLinear(pixelUv(rtSrc(px)), z);

  var varSum = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let q = clamp(px + vec2i(i, j), vec2i(0), dims - vec2i(1));
      varSum += textureLoad(momTex, q, 0).w * select(0.5, 0.25, i != 0) * select(0.5, 0.25, j != 0);
    }
  }
  let sigmaL = 4.0 * pow(0.6, ITER) * sqrt(max(varSum, 0.0)) + LUMA_FLOOR;
  let lc = tapLuma(centre);
  let zTol = 0.005 * z + 0.02;

  var stride = exp2(ITER);
#ifdef SPEC
  stride = max(1.0, round(stride * clamp(an.z / 0.6, 0.0, 1.0) * 1.5));
#endif
  let stepPx = i32(stride);
  var sum = vec4f(0.0);
  var wSum = 0.0;
  for (var j = -2; j <= 2; j++) {
    for (var i = -2; i <= 2; i++) {
      let q = px + vec2i(i, j) * stepPx;
      if (any(q < vec2i(0)) || any(q >= dims)) { continue; }
      let zq = textureLoad(auxDepth, q, 0).x;
      if (zq <= 0.0) { continue; }
      let s = textureLoad(srcTex, q, 0);
      let nq = octDecode(textureLoad(auxNormal, q, 0).xy);
      let pq = worldFromLinear(pixelUv(rtSrc(q)), zq);
      let wz = exp(-abs(dot(n, pq - pos)) / zTol);
      let wn = pow(max(dot(n, nq), 0.0), 16.0);
      let wl = exp(-abs(lc - tapLuma(s)) / sigmaL);
      let w = tapWeight(i) * tapWeight(j) * wz * wn * wl;
      sum += s * w;
      wSum += w;
    }
  }
  textureStore(dstTex, px, fp16Safe(dstValue(select(centre, sum / wSum, wSum > 1e-6), px)));
}
