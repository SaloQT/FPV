// Sky pass: fullscreen triangle at reverse-Z depth 0 (the depth test 'equal' keeps it to pixels no geometry covered), replacing the
// zero the lighting pass left in the HDR target.
//
// UNIT CHAIN: everything below is radiance in nits (cd/m2) until the very last line, where it is multiplied by frame.params.y
// (pre-exposure) exactly once. Sky = sky-view LUT (sun + moon scattering + airglow, lux -> nits, see sky/skyview.wgsl); sun disc =
// E_sun[lux] / (pi R^2 [sr]) * limb darkening * T; moon = albedo * E_sun / pi * Lommel-Seeliger * T (sky/moon.wgsl); Milky Way = baked
// map [nits] * T; clouds = (inscatter [nits] / CLOUD_STORE_SCALE, transmittance) composited as  colour * a + rgb * CLOUD_STORE_SCALE. T is
// the LUT transmittance from the camera to the top of the atmosphere along the pixel's own direction, so discs redden and dim toward
// the horizon. Stars are drawn afterwards by sky/stars.wgsl. The total is scaled (hue kept) so no channel exceeds SUN_MAX_EXPOSED =
// 58976 (the fp16 value just under 59000; fp16 holds 65504).
// The one exception to "pre-exposure exactly once" is the moon disc: when the auto exposure is opened up for a night landscape
// (pre-exposure ~1e2) a full moon would be 5e5 and clip to a flat white disc, so its exposure is capped at MOON_EXPOSED_PEAK for a
// MOON_REFERENCE_NITS highland patch (a local-adaptation stand-in; all ratios inside the disc, and so the maria, are preserved).
//
// Group 2: 0 AtmosParams, 1 sky-view (sun + night), 2 sky-view (moon only), 3 Milky Way map, 4 clouds (rgb nits / CLOUD_STORE_SCALE, a transmittance).
#include "common/world_bindings.wgsl"
#include "common/atmosphere_sample.wgsl"
#include "sky/atmos_params.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(2) @binding(0) var<uniform> ap : AtmosParams;
@group(2) @binding(1) var skySunTex : texture_2d<f32>;
@group(2) @binding(2) var skyMoonTex : texture_2d<f32>;
@group(2) @binding(3) var milkyWayTex : texture_2d<f32>;
@group(2) @binding(4) var cloudTex : texture_2d<f32>;

#include "sky/moon.wgsl"

const SUN_MAX_EXPOSED : f32 = 58976.0;
const SUN_LIMB_U : vec3f = vec3f(0.55, 0.66, 0.80);
const MOON_REFERENCE_NITS : f32 = 5000.0;
const MOON_EXPOSED_PEAK : f32 = 2.5;

struct VsOut {
  @builtin(position) pos : vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var o : VsOut;
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return o;
}

fn azimuthCosTo(dir : vec3f, light : vec3f) -> f32 {
  let s = light.xz;
  let v = dir.xz;
  let sl = length(s);
  let vl = length(v);
  if (sl < 1e-5 || vl < 1e-5) { return 1.0; }
  return dot(s, v) / (sl * vl);
}

// Sun and moon scattering plus airglow from the LUTs. The moon's LUT is folded around the moon's own azimuth.
fn skyLuts(dir : vec3f, r : f32) -> vec3f {
  var c = textureSampleLevel(skySunTex, linearClamp, skyViewUv(dir, r), 0.0).rgb;
  if (ap.flags.x > 0.5) {
    let uv = skyViewUvCos(dir.y, azimuthCosTo(dir, frame.moonDir.xyz), r);
    c += textureSampleLevel(skyMoonTex, linearClamp, uv, 0.0).rgb;
  }
  return c;
}

// Radiance of the sun's disc along dir (antialiased over one pixel), before atmospheric extinction.
fn sunDisc(dir : vec3f, pixelAngle : f32) -> vec3f {
  let s = frame.sunDir.xyz;
  let radius = frame.sunDir.w;
  let c = dot(dir, s);
  if (c <= 0.0) { return vec3f(0.0); }
  let theta = atan2(length(cross(dir, s)), c);
  let coverage = saturate((radius - theta) / pixelAngle + 0.5);
  if (coverage <= 0.0) { return vec3f(0.0); }
  let mu = sqrt(max(1.0 - sq(min(theta / radius, 1.0)), 0.0));
  let limb = (vec3f(1.0) - SUN_LIMB_U * (1.0 - mu)) / (vec3f(1.0) - SUN_LIMB_U / 3.0);
  return frame.sunIrradiance.rgb * (limb * coverage / (PI * radius * radius));
}

// Milky Way radiance (nits) toward a world direction: rotate into J2000 equatorial axes (celestial is orthonormal, so its transpose is
// its inverse), then into galactic axes, and read the map by longitude/latitude.
fn milkyWay(dir : vec3f) -> vec3f {
  let m = mat3x3f(frame.celestial[0].xyz, frame.celestial[1].xyz, frame.celestial[2].xyz);
  let eq = dir * m;
  let g = vec3f(dot(eq, ap.gal0.xyz), dot(eq, ap.gal1.xyz), dot(eq, ap.gal2.xyz));
  let uv = vec2f(atan2(g.y, g.x) / TAU + 0.5, 0.5 - asin(clamp(g.z, -1.0, 1.0)) / PI);
  return textureSampleLevel(milkyWayTex, linearRepeat, uv, 0.0).rgb * ap.sky2.x;
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4f {
  let uv = in.pos.xy * frame.screen.zw;
  let dir = viewRayDir(uv);
  let r = frame.sky.x + frame.sky.z;
  let camera = vec3f(0.0, r, 0.0);
  let pixelAngle = 2.0 / (frame.proj[1][1] * frame.screen.y);
  let aboveHorizon = planetVisibility(camera, dir);
  let trans = sampleTransmittance(r, dir.y);

  var col = skyLuts(dir, r);
  if (aboveHorizon > 0.5) {
    let moon = moonRadiance(dir, pixelAngle);
    let moonGain = min(1.0, MOON_EXPOSED_PEAK / (MOON_REFERENCE_NITS * frame.params.y));
    col += trans * (milkyWay(dir) * (1.0 - moon.a) + moon.rgb * (moon.a * moonGain));
    col += trans * sunDisc(dir, pixelAngle);
  }

  let cloud = textureSampleLevel(cloudTex, linearClamp, uv, 0.0);
  col = col * cloud.a + cloud.rgb * CLOUD_STORE_SCALE;

  col = col * frame.params.y;
  let peak = max(col.r, max(col.g, col.b));
  if (peak > SUN_MAX_EXPOSED) { col = col * (SUN_MAX_EXPOSED / peak); }
  return vec4f(col, 1.0);
}
