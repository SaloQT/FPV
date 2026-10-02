// Diffuse GI: `giRays` cosine-weighted rays per RT texel (blue noise rotated per frame). A hit returns its shaded radiance (direct light with a
// secondary shadow ray, probe bounce, emission), a miss the sky / ground colour. out0 = (mean radiance, mean short-range visibility),
// out1 = the probe-grid irradiance at the pixel, used by the temporal pass to re-seed disoccluded history and as the whole result at 0 rays.
#include "rt/rt_trace_io.wgsl"

const CONTACT_RANGE : f32 = 2.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  if (!pix.ok) {
    textureStore(out0, px, vec4f(0.0));
    textureStore(out1, px, vec4f(0.0));
    return;
  }
  let e = envAt(pix.pos.y);
  let probeE = probeIrradiance(pix.pos + pix.n * 0.3, pix.n, e);
  textureStore(out1, px, fp16Safe(vec4f(probeE, 1.0)));
  let rays = rp.cfg.z;
  if (rays == 0u || rp.dbg.x == 5u) {
    textureStore(out0, px, fp16Safe(vec4f(probeE, 1.0)));
    return;
  }
  let basis = basisFromNormal(pix.n);
  let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
  let steps = rp.cfg.y;
  var sum = vec3f(0.0);
  var vis = 0.0;
  for (var r = 0u; r < rays; r++) {
    let d = basis * cosineHemisphere(noise2(px, 1u + r));
    let h = traceScene(origin, d, rp.f.w, steps);
    if (h.kind == KIND_MISS) {
      sum += skyRadiance(d, e);
      vis += 1.0;
    } else {
      sum += hitRadiance(h, origin, d, e, steps);
      vis += 1.0 - hitSolidity(h, origin, d) * (1.0 - saturate1(h.t / CONTACT_RANGE));
    }
  }
  let inv = 1.0 / f32(rays);
  textureStore(out0, px, fp16Safe(vec4f(sum * inv, vis * inv)));
}
