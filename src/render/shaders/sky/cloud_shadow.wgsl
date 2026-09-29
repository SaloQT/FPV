// Cloud shadow map (compute, 128x128): for every ground column around the camera, the transmittance of the cloud layers along the
// sun's and the moon's rays, marched through the same density functions the sky pass renders (sky/cloud_density.wgsl), so a shadow on
// the terrain lies under the cloud that casts it.
//
// UNIT CHAIN: unit-less transmittances exp(-tau) with tau = sigma_e [1/km] * density * ds [km], for a ground point at the datum
// (world y = 0). Texel (i, j) covers world x = cx + ((i + 0.5) / N - 0.5) * E, z = cz + ((j + 0.5) / N - 0.5) * E, with the map centre
// (cx, cz) = AtmosParams.cloudC.zw and side E = AtmosParams.cloudD.w, both in metres.
// Output: r = sun transmittance, g = moon transmittance (1 for a light below the horizon), b = zenith transmittance of both layers (how
// much sky light the cloud above lets through), a = 1.
//
// Group 1: 3 output (rgba16float), plus everything sky/cloud_density.wgsl declares.
#include "sky/cloud_light.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

const CUMULUS_STEPS : i32 = 16;
const CIRRUS_STEPS : i32 = 8;
const ZENITH_STEPS : i32 = 6;

fn layerTau(o : vec3f, l : vec3f, cirrus : bool, steps : i32, datumR : f32, jitter : f32) -> f32 {
  let iv = shellInterval(o, l, datumR + select(ap.cloudB.x, ap.cloudB.z, cirrus), datumR + select(ap.cloudB.y, ap.cloudB.w, cirrus));
  if (iv.x >= iv.y) { return 0.0; }
  let ds = (iv.y - iv.x) / f32(steps);
  var tau = 0.0;
  for (var i = 0; i < steps; i++) {
    let p = o + l * (iv.x + ds * (f32(i) + jitter));
    let h = length(p) - datumR;
    if (cirrus) {
      tau += CIRRUS_SIGMA_KM * ap.cloudA.z * cirrusDensity(layerPlane(p, ap.wind.zw), h) * ds;
    } else {
      tau += CUMULUS_SIGMA_KM * ap.cloudA.z * cumulusDensity(layerPlane(p, ap.wind.xy), h, 0.0) * ds;
    }
  }
  return tau;
}

fn columnTransmittance(o : vec3f, l : vec3f, steps : i32, datumR : f32, jitter : f32) -> f32 {
  if (l.y <= 0.0) { return 1.0; }
  var tau = 0.0;
  if (ap.cloudA.x > 0.0) { tau += layerTau(o, l, false, steps, datumR, jitter); }
  if (ap.cloudA.y > 0.0) { tau += layerTau(o, l, true, max(steps / 2, 4), datumR, jitter); }
  return exp(-tau);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let texel = vec2i(gid.xy);
  if (ap.sky2.z < 0.5) {
    textureStore(outTex, texel, vec4f(1.0));
    return;
  }
  let datumR = datumRadius();
  let world = vec2f(ap.cloudC.z, ap.cloudC.w) + ((vec2f(gid.xy) + 0.5) / vec2f(dims) - 0.5) * ap.cloudD.w;
  let o = vec3f((world.x - frame.camPos.x) * 0.001, datumR, (world.y - frame.camPos.z) * 0.001);
  let jitter = hash21(gid.xy + vec2u(u32(ap.cloudC.y) % 8u, 0u)) * 0.999;
  let sun = columnTransmittance(o, frame.sunDir.xyz, CUMULUS_STEPS, datumR, jitter);
  let moon = select(1.0, columnTransmittance(o, frame.moonDir.xyz, CUMULUS_STEPS, datumR, jitter), ap.flags.x > 0.5);
  let zenith = columnTransmittance(o, vec3f(0.0, 1.0, 0.0), ZENITH_STEPS, datumR, jitter);
  textureStore(outTex, texel, vec4f(sun, moon, zenith, 1.0));
}
