// Transmittance LUT (256x64): T(r, mu) = exp(-integral of extinction[1/km] ds[km]) from radius r along zenith cosine mu to the top of the
// atmosphere, planet ignored (occlusion by the planet is applied by the users). Dimensionless, rgb. Computed once.
// The integral is a midpoint rule over segments whose edges grow quadratically so the dense low atmosphere is resolved on long slants.
#include "sky/lut_common.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

const STEPS : u32 = 128u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let rm = transmittanceParams(uv);
  let r = rm.x;
  let mu = rm.y;
  let rt = frame.sky.y;
  let d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + rt * rt, 0.0)));
  var tau = vec3f(0.0);
  var t0 = 0.0;
  for (var i = 0u; i < STEPS; i++) {
    let f = f32(i + 1u) / f32(STEPS);
    let t1 = d * f * f;
    let tm = 0.5 * (t0 + t1);
    let rp = sqrt(max(r * r + 2.0 * r * mu * tm + tm * tm, 0.0));
    tau += mediumAt(rp - frame.sky.x).extinction * (t1 - t0);
    t0 = t1;
  }
  textureStore(outTex, vec2i(gid.xy), vec4f(exp(-tau), 1.0));
}
