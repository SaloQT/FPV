// Aerial-perspective froxels (32x32x32). UNIT CHAIN: lux * sum(T * sigma_s[1/km] * phase[1/sr] * T_light * ds[km]) = nits (not pre-exposed);
// distances along the pixel ray are metres (apSliceToDistance) and are converted to km for the medium. One thread per (x, y) column
// walks the 32 slices front to back, integrating sun and moonlight over [previous slice, this slice] and writing the running
// in-scatter (rgb) and the mean RGB transmittance (a) from the camera to the slice centre. Composite is colour * a + rgb.
#include "sky/lut_common.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(1) @binding(3) var outTex : texture_storage_3d<rgba16float, write>;
@group(1) @binding(5) var<uniform> ap : AtmosParams;

const SUBSTEPS : u32 = 2u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= 32u || gid.y >= 32u) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / 32.0;
  let dir = viewRayDir(uv);
  let p0 = vec3f(0.0, frame.sky.x + frame.sky.z, 0.0);
  let moonOn = ap.flags.x > 0.5;
  var lum = vec3f(0.0);
  var thr = vec3f(1.0);
  var dPrev = 0.0;
  for (var k = 0u; k < 32u; k++) {
    let d = apSliceToDistance((f32(k) + 0.5) / AP_SLICES);
    let segKm = (d - dPrev) * 0.001;
    let dt = segKm / f32(SUBSTEPS);
    for (var s = 0u; s < SUBSTEPS; s++) {
      let t = (dPrev * 0.001) + (f32(s) + 0.5) * dt;
      let p = p0 + dir * t;
      let sun = scatterStep(p, dir, dt, frame.sunDir.xyz, frame.sunIrradiance.rgb);
      var dL = sun.dL;
      if (moonOn) { dL += scatterStep(p, dir, dt, frame.moonDir.xyz, frame.moonIrradiance.rgb * MOON_SCATTER_TINT).dL; }
      lum += thr * dL;
      thr *= sun.trans;
    }
    textureStore(outTex, vec3i(i32(gid.x), i32(gid.y), i32(k)), vec4f(min(lum, vec3f(FP16_STORE_MAX)), (thr.x + thr.y + thr.z) * (1.0 / 3.0)));
    dPrev = d;
  }
}
