// Cloud geometry and density, shared by the march and the shadow-map passes. Mirrors the macro model in src/render/atmosphere/cloudModel.ts
// (hash, value noise, presence, height gradient), which the CPU uses for cloudSunVisibility().
//
// UNIT CHAIN: positions are planet-centred KILOMETRES (camera at (0, Rb + frame.sky.z, 0), +Y local up; horizontal offsets from the camera
// are world x / z offsets in km). Heights are above the world datum (world y = 0), so a layer's shell radius is
// Rb + frame.sky.z - frame.camPos.y / 1000 + height. Density is unit-less 0..1; extinction sigma_e [1/km] = CUMULUS_SIGMA_KM * density *
// cloudDensity, and a segment of length ds [km] has optical depth sigma_e * ds.
//
// Cumulus: a 2D value-noise weather map (three octaves, 9 / 4 / 1.8 km) picks where clouds stand and, through the local presence L, how
// tall they grow; the vertical profile is Schneider's height gradient; the 128^3 Perlin-Worley / Worley volume carves the billows
// (density = saturate(shape * gradient - 1 + L), which is his remap-by-coverage in closed form) and the 32^3 volume erodes the edges.
// Cirrus: a thin slab of the same volume stretched along the wind into 24 x 4 km streaks.
//
// Group 1 (each stage adds its own outputs): 0 linearClamp, 1 transmittanceLUT, 2 multiScatterLUT, 5 AtmosParams, 6 shape volume,
// 7 detail volume, 8 repeating sampler, 40 world sky-view LUT, 41 world aerial-perspective froxels.
#include "sky/lut_common.wgsl"
#include "sky/atmos_uniforms.wgsl"

@group(1) @binding(5) var<uniform> ap : AtmosParams;
@group(1) @binding(6) var shapeNoise : texture_3d<f32>;
@group(1) @binding(7) var detailNoise : texture_3d<f32>;
@group(1) @binding(8) var noiseSampler : sampler;

const CUMULUS_SIGMA_KM : f32 = 40.0;
const NIGHT_CUMULUS_SCALE : f32 = 0.35;
const NIGHT_CUMULUS_SIN_LO : f32 = -0.2;
const NIGHT_CUMULUS_SIN_HI : f32 = 0.05;
const CIRRUS_SIGMA_KM : f32 = 0.9;
const SHAPE_TILE_KM : f32 = 7.0;
const DETAIL_TILE_KM : f32 = 1.2;
const CIRRUS_STREAK_KM : vec3f = vec3f(24.0, 4.0, 4.0);

fn datumRadius() -> f32 { return frame.sky.x + frame.sky.z - frame.camPos.y * 0.001; }

// Fair-weather cumulus is convective and dissipates after sunset (nightCumulusScale() in cloudModel.ts): the night keeps a fraction of the day's cover.
fn cumulusCoverage() -> f32 {
  return ap.cloudA.x * mix(NIGHT_CUMULUS_SCALE, 1.0, smoothstep(NIGHT_CUMULUS_SIN_LO, NIGHT_CUMULUS_SIN_HI, frame.sunDir.y));
}

fn seedOffset() -> vec2f { return vec2f(ap.cloudA.w * 13.37, ap.cloudA.w * 7.13 + 100.0); }

// World-plane position (km) of a planet-centred point, with the layer's wind drift (m) and the seed applied.
fn layerPlane(p : vec3f, driftM : vec2f) -> vec2f {
  return (frame.camPos.xz + p.xz * 1000.0 - driftM) * 0.001 + seedOffset();
}

fn vnoise2(p : vec2f) -> f32 {
  let b = floor(p);
  let f = p - b;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let i = bitcast<vec2u>(vec2i(b));
  let a = hash21(i);
  let c = hash21(i + vec2u(1u, 0u));
  let d = hash21(i + vec2u(0u, 1u));
  let e = hash21(i + vec2u(1u, 1u));
  return mix(mix(a, c, u.x), mix(d, e, u.x), u.y);
}

fn cumulusWeather(xz : vec2f) -> f32 {
  return 0.45 * vnoise2(xz / 9.0) + 0.35 * vnoise2(xz / 4.0 + vec2f(17.3, 9.1)) + 0.2 * vnoise2(xz / 1.8 + vec2f(3.7, 41.9));
}

fn cirrusWeather(xz : vec2f) -> f32 {
  return 0.6 * vnoise2(xz / 30.0 + vec2f(5.1, 2.3)) + 0.4 * vnoise2(xz / 11.0 + vec2f(29.7, 13.9));
}

// Local cloud presence 0..1 for a weather value and a sky-cover setting (about `coverage` of the plane is above 0.5).
fn presence(n : f32, coverage : f32) -> f32 {
  let t = 0.80 - 0.62 * coverage;
  return smoothstep(t - 0.09, t + 0.09, n);
}

fn cumulusGradient(hs : f32) -> f32 {
  return smoothstep(0.0, 0.10, hs) * (1.0 - smoothstep(0.62, 1.0, hs));
}

// Cumulus density 0..1 at a plane position (km) and height above the datum (km). detail 0..1 blends the erosion volume in (0 = mean erosion).
fn cumulusDensity(xz : vec2f, hKm : f32, detail : f32) -> f32 {
  let hf = (hKm - ap.cloudB.x) / (ap.cloudB.y - ap.cloudB.x);
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  let l = presence(cumulusWeather(xz), cumulusCoverage());
  if (l <= 0.0) { return 0.0; }
  let grad = cumulusGradient(hf / mix(0.3, 1.0, l));
  if (grad <= 0.0) { return 0.0; }
  let s = textureSampleLevel(shapeNoise, noiseSampler, vec3f(xz.x, hKm, xz.y) / SHAPE_TILE_KM, 0.0);
  let low = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  let shape = saturate((s.r - low + 1.0) / (2.0 - low));
  let d = saturate(shape * grad - 1.0 + l);
  if (d <= 0.0) { return 0.0; }
  var erosion = 0.5;
  if (detail > 0.0) {
    let v = textureSampleLevel(detailNoise, noiseSampler, vec3f(xz.x, hKm, xz.y) / DETAIL_TILE_KM, 0.0);
    let f = v.r * 0.625 + v.g * 0.25 + v.b * 0.125;
    erosion = mix(0.5, mix(f, 1.0 - f, saturate(hf * 10.0)), detail);
  }
  let e = 0.35 * exp(-l * 0.75) * erosion * 2.0;
  return saturate((d - e) / (1.0 - e));
}

// Cirrus density 0..1: fibrous streaks along the wind bearing (ap.eclNorth.w, radians clockwise from north).
fn cirrusDensity(xz : vec2f, hKm : f32) -> f32 {
  let hf = (hKm - ap.cloudB.z) / (ap.cloudB.w - ap.cloudB.z);
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  let l = presence(cirrusWeather(xz), ap.cloudA.y);
  if (l <= 0.0) { return 0.0; }
  let a = ap.eclNorth.w;
  let along = dot(xz, vec2f(sin(a), -cos(a)));
  let across = dot(xz, vec2f(cos(a), sin(a)));
  let s = textureSampleLevel(shapeNoise, noiseSampler, vec3f(along / CIRRUS_STREAK_KM.x, across / CIRRUS_STREAK_KM.y, hKm / CIRRUS_STREAK_KM.z), 0.0);
  let fibre = 0.55 * s.r + 0.45 * s.b;
  return saturate((fibre - (1.0 - l) * 0.9) / 0.5) * sin(PI * hf);
}

// Interval [t0, t1] (km along o + t d) of the ray inside the spherical shell rBot..rTop; x >= y means the ray misses it.
fn shellInterval(o : vec3f, d : vec3f, rBot : f32, rTop : f32) -> vec2f {
  let top = raySphere(o, d, rTop);
  if (top.x > top.y) { return vec2f(1.0, -1.0); }
  var t0 = max(top.x, 0.0);
  var t1 = top.y;
  let bot = raySphere(o, d, rBot);
  if (bot.x <= bot.y) {
    if (bot.x > t0) { t1 = min(t1, bot.x); } else if (bot.y > t0) { t0 = bot.y; }
  }
  return vec2f(t0, t1);
}
