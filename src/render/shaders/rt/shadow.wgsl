// Key-light (sun or moon) soft shadow: one binary visibility ray per RT texel, aimed at a random point inside the light's angular disc
// (blue noise + R2 per frame), so the penumbra width follows the occluder distance. The temporal + a-trous passes turn it into a soft value.
#include "rt/rt_trace_io.wgsl"

const SHADOW_RANGE : f32 = 6000.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (!inRt(gid.xy)) { return; }
  let px = vec2i(gid.xy);
  let pix = loadPixel(px);
  let key = keyDir();
  var vis = 1.0;
  if (pix.ok && key.y > -0.03) {
    let ndl = dot(pix.n, key.xyz);
    let bias = min((0.04 + 0.006 * pix.z) / max(abs(ndl), 0.15), 1.5);
    let o = pix.pos + pix.n * select(-bias, bias, ndl >= 0.0);
    let u = noise2(px, 0u);
    let basis = basisFromNormal(key.xyz);
    let r = sqrt(u.x);
    let phi = TAU * u.y;
    let tanA = tan(min(key.w, 0.2)) * rp.f.x;
    let dir = normalize(key.xyz + tanA * (r * cos(phi) * basis[0] + r * sin(phi) * basis[1]));
    vis = select(1.0, 0.0, occluded(o, dir, SHADOW_RANGE, rp.cfg.y));
  }
  textureStore(out0, px, vec4f(vis, 0.0, 0.0, 0.0));
}
