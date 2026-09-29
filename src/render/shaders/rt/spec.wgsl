// Specular reflection: one GGX-distributed ray per RT texel for surfaces with roughness < 0.6 (rougher ones use the deferred pass's own
// environment lookup). out0 = (radiance * confidence, confidence): the a-trous filter averages premultiplied values and divides at the end.
#include "rt/rt_trace_io.wgsl"

const SPEC_ROUGH_MAX : f32 = 0.6;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  var res = vec4f(0.0);
  if (pix.ok && (rp.cfg.w & FLAG_SPEC) != 0u && pix.rough < SPEC_ROUGH_MAX) {
    let v = normalize(frame.camPos.xyz - pix.pos);
    let a = max(pix.rough * pix.rough, 0.004);
    let u = noise2(px, 11u);
    let cosT = sqrt((1.0 - u.x) / (1.0 + (a * a - 1.0) * u.x));
    let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    let phi = TAU * u.y;
    let h = basisFromNormal(pix.n) * vec3f(sinT * cos(phi), sinT * sin(phi), cosT);
    let d = reflect(-v, h);
    let conf = 1.0 - smoothstep(0.4, SPEC_ROUGH_MAX, pix.rough);
    if (dot(d, pix.n) > 0.02) {
      let pre = frame.params.y;
      let e = envAt(pix.pos.y);
      let origin = pix.pos + pix.n * (0.04 + 0.004 * pix.z);
      let steps = rp.cfg.y;
      let hit = traceScene(origin, d, rp.f.w, steps);
      var radiance : vec3f;
      if (hit.kind == KIND_MISS) {
        radiance = envRadiance(d, e) * pre;
      } else {
        let p = origin + d * hit.t;
        radiance = shadeSurface(surfaceAt(hit, p, d), p, hit.t, hit.kind, e, steps);
      }
      res = vec4f(radiance * conf, conf);
    }
  }
  textureStore(out0, px, res);
}
