// Sky-view LUT (192x108), rebuilt every frame from the camera's radius. UNIT CHAIN: light illuminance [lux] * sum(T * sigma_s[1/km] *
// phase[1/sr] * T_light * ds[km]) = radiance in nits, NOT pre-exposed (pre-exposure is applied only when writing the HDR target).
// The map folds the view azimuth around the SUN (common/atmosphere_sample.wgsl), so two passes build it:
//   MOON_PASS defined : moonlight scattering, folded around the MOON, into skyMoon (exact for the moon; the sky pass samples it directly).
//   otherwise         : sun scattering + night airglow + starlight floor into skySun, and world.skyView = skySun + the moon's map
//                       symmetrised over the two possible view sides (accurate for the low-frequency consumers: ambient and reflections).
#include "sky/lut_common.wgsl"
#include "sky/atmos_uniforms.wgsl"
#include "sky/night_light.wgsl"

@group(1) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var<uniform> ap : AtmosParams;
#ifndef MOON_PASS
@group(1) @binding(4) var outWorld : texture_storage_2d<rgba16float, write>;
@group(1) @binding(6) var skyMoon : texture_2d<f32>;
#endif

const STEPS : u32 = 32u;

// Radiance seen along dir from the camera at radius r, lit by one collimated light (single scattering + LUT multiple scattering + ground).
fn marchSky(dir : vec3f, r : f32, lightDir : vec3f, lightE : vec3f) -> vec3f {
  let p0 = vec3f(0.0, r, 0.0);
  let hitG = raySphere(p0, dir, frame.sky.x);
  let hitsGround = hitG.x > 0.0;
  let tTop = raySphere(p0, dir, frame.sky.y).y;
  let tMax = select(tTop, hitG.x, hitsGround);
  var lum = vec3f(0.0);
  var thr = vec3f(1.0);
  var t0 = 0.0;
  for (var i = 0u; i < STEPS; i++) {
    let f = f32(i + 1u) / f32(STEPS);
    let t1 = tMax * f * f;
    let s = scatterStep(p0 + dir * (0.5 * (t0 + t1)), dir, t1 - t0, lightDir, lightE);
    lum += thr * s.dL;
    thr *= s.trans;
    t0 = t1;
  }
  if (hitsGround) { lum += thr * groundRadianceAt(p0 + dir * tMax, lightDir, lightE); }
  return lum;
}

// Airglow and the starlight floor (sky/night_light.wgsl), attenuated by the atmosphere above.
fn nightSky(cosZ : f32, r : f32) -> vec3f {
  if (cosZ <= 0.0) { return vec3f(0.0); }
  let horizon = smoothstep(0.0, 0.04, cosZ);
  return nightSkyNits(cosZ, frame.sky.x) * sampleTransmittance(r, cosZ) * (frame.sky.w * ap.flags.y * horizon);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  let r = frame.sky.x + frame.sky.z;
  let cp = skyViewParams(uv, r);
  let cosZ = cp.x;
  let sinZ = sqrt(max(1.0 - cosZ * cosZ, 0.0));
  let sinAz = sqrt(max(1.0 - cp.y * cp.y, 0.0));
  let dir = vec3f(sinZ * cp.y, cosZ, sinZ * sinAz);
#ifdef MOON_PASS
  let mu = clamp(frame.moonDir.y, -1.0, 1.0);
  let light = vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  textureStore(outTex, vec2i(gid.xy), vec4f(marchSky(dir, r, light, frame.moonIrradiance.rgb * MOON_SCATTER_TINT), 1.0));
#else
  let mu = clamp(frame.sunDir.y, -1.0, 1.0);
  let light = vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  let sky = marchSky(dir, r, light, frame.sunIrradiance.rgb) + nightSky(cosZ, r);
  textureStore(outTex, vec2i(gid.xy), vec4f(sky, 1.0));

  var world = sky;
  if (ap.flags.x > 0.5) {
    let sxz = vec2f(frame.sunDir.x, frame.sunDir.z);
    let mxz = vec2f(frame.moonDir.x, frame.moonDir.z);
    let denom = length(sxz) * length(mxz);
    let cosD = select(1.0, clamp(dot(sxz, mxz) / max(denom, 1e-9), -1.0, 1.0), denom > 1e-8);
    let sinD = sqrt(max(1.0 - cosD * cosD, 0.0));
    let cosA = cosD * cp.y - sinD * sinAz;
    let cosB = cosD * cp.y + sinD * sinAz;
    let a = textureSampleLevel(skyMoon, linearClamp, skyViewUvCos(cosZ, cosA, r), 0.0).rgb;
    let b = textureSampleLevel(skyMoon, linearClamp, skyViewUvCos(cosZ, cosB, r), 0.0).rgb;
    world += 0.5 * (a + b);
  }
  textureStore(outWorld, vec2i(gid.xy), vec4f(world, 1.0));
#endif
}
