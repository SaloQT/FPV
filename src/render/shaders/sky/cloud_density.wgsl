// Cloud geometry and density, shared by the march and the shadow-map passes. Mirrors the macro model in src/render/atmosphere/cloudModel.ts
// (hash, value noise, presence, height gradient), which the CPU uses for cloudSunVisibility().
//
// UNIT CHAIN: positions are planet-centred KILOMETRES (camera at (0, Rb + frame.sky.z, 0), +Y local up; horizontal offsets from the camera
// are world x / z offsets in km). Heights are above the world datum (world y = 0), so a layer's shell radius is
// Rb + frame.sky.z - frame.camPos.y / 1000 + height. Density is unit-less 0..1; extinction sigma_e [1/km] = CUMULUS_SIGMA_KM * density *
// cloudDensity, and a segment of length ds [km] has optical depth sigma_e * ds.
//
// Cumulus: a 2D weather map (convective cells on a 2.6 km grid, a 1.6 km and a 0.7 km value-noise octave; fair-weather cumulus 0.5-2 km
// across) picks where clouds stand and, through the local presence L, how
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
// Night clearing: weather taken off where the broad mask is above NIGHT_CLEAR_LO (about 1 - NIGHT_CUMULUS_SCALE of the sky clears), the
// mask's scale (km), and how much flatter the remaining clouds are.
const NIGHT_CLEAR_DEPTH : f32 = 0.6;
const NIGHT_CLEAR_LO : f32 = 0.3;
const NIGHT_CLEAR_KM : f32 = 12.0;
const NIGHT_CUMULUS_TALL : f32 = 0.7;
const CIRRUS_SIGMA_KM : f32 = 0.9;
const SHAPE_TILE_KM : f32 = 1.6;
const DETAIL_TILE_KM : f32 = 0.45;
// Extreme tier (ap.cloudE.x): a second erosion octave this much finer, the shape lookup pushed around by the detail volume by up to
// WISP_KM so edges tear into wisps and curls, and the erosion this much stronger.
const FINE_DETAIL_TILE_KM : f32 = 0.13;
const FINEST_DETAIL_TILE_KM : f32 = 0.04;
const WISP_KM : f32 = 0.05;
const FINE_EROSION : f32 = 1.6;
const EDGE_SHARPEN : f32 = 3.0;
const BASE_RAG : f32 = 0.12;
const TOP_LUMPS : f32 = 0.6;
const CIRRUS_STREAK_KM : vec3f = vec3f(24.0, 4.0, 4.0);

fn datumRadius() -> f32 { return frame.sky.x + frame.sky.z - frame.camPos.y * 0.001; }

// Fair-weather cumulus is convective and dissipates after sunset: the night keeps about NIGHT_CUMULUS_SCALE of the day's cover. It is taken
// away region by region (a broad mask clears whole areas, NIGHT_CLEAR_KM across) while the clouds left keep their daytime shapes, a little
// flattened (NIGHT_CUMULUS_TALL). Raising the cover threshold instead left only the cells' weather maxima: rows of identical domes, the
// full layer tall, which read as bullets and mushrooms at night.
fn cumulusCoverage() -> f32 { return ap.cloudA.x; }
fn cumulusDay() -> f32 { return smoothstep(NIGHT_CUMULUS_SIN_LO, NIGHT_CUMULUS_SIN_HI, frame.sunDir.y); }
fn nightClearing(xz : vec2f, day : f32) -> f32 {
  // By day nothing is cleared: skip the mask's noise (it ran on every density sample and cost 0.5 ms at ultra). `day` comes from the sun
  // direction, a frame uniform, so the branch is coherent.
  if (day >= 1.0) { return 0.0; }
  return (1.0 - day) * NIGHT_CLEAR_DEPTH * smoothstep(NIGHT_CLEAR_LO, NIGHT_CLEAR_LO + 0.15, vnoise2(xz / NIGHT_CLEAR_KM + vec2f(71.3, 19.7)));
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

// Convective cells 0..1: one rounded dome per CELL_KM cell, jittered, of its own radius (0.3-0.65 of a cell) and strength, so the cover
// breaks up into separate clouds with blue sky between them instead of the meandering worms a thresholded smooth noise draws.
// Mirrors cumulusCells in cloudModel.ts (the hashes are the same integer lattice hashes).
const CELL_KM : f32 = 2.6;
// Share of the cells that hold no cloud at all, so the clouds stand in an irregular scatter rather than one per grid square.
const CELL_EMPTY : f32 = 0.5;

fn cellHash(x : i32, y : i32) -> f32 { return hash21(bitcast<vec2u>(vec2i(x, y))); }

fn cumulusCells(xz : vec2f) -> f32 {
  let g = xz / CELL_KM;
  let b = vec2i(floor(g));
  // A cell's dome reaches at most 0.65 of a cell from a centre that keeps 0.15 from its edges, so only the cells on the near side of
  // each axis can reach this point: a 2 x 2 block, not 3 x 3.
  let side = select(vec2i(1), vec2i(-1), g - vec2f(b) < vec2f(0.5));
  var best = 0.0;
  for (var j = 0; j <= 1; j++) {
    for (var i = 0; i <= 1; i++) {
      let c = b + vec2i(i, j) * side;
      let p = vec2f(c) + vec2f(0.15 + 0.7 * cellHash(c.x, c.y + 7919), 0.15 + 0.7 * cellHash(c.x + 7919, c.y));
      let r = 0.3 + 0.35 * cellHash(c.x + 104729, c.y);
      let s = cellHash(c.x, c.y + 104729);
      if (s < CELL_EMPTY) { continue; }
      let d = length(g - p) / r;
      if (d < 1.0) { best = max(best, (1.0 - smoothstep(0.0, 1.0, d)) * (0.55 + 0.45 * (s - CELL_EMPTY) / (1.0 - CELL_EMPTY))); }
    }
  }
  return best;
}

// The cells, with a 1.6 km and a 0.7 km noise octave that break their outlines into lobes, then remapped (a log curve fitted to the
// field's quantiles) so the clouds, whose soft rims reach a little below presence()'s threshold, cover about the requested fraction.
fn cumulusWeather(xz : vec2f) -> f32 {
  let raw = 0.45 * cumulusCells(xz) + 0.35 * vnoise2(xz / 1.6 + vec2f(17.3, 9.1)) + 0.2 * vnoise2(xz / 0.7 + vec2f(3.7, 41.9));
  return saturate(1.156 + 0.583 * log(max(raw, 1e-4)));
}

fn cirrusWeather(xz : vec2f) -> f32 {
  return 0.6 * vnoise2(xz / 30.0 + vec2f(5.1, 2.3)) + 0.4 * vnoise2(xz / 11.0 + vec2f(29.7, 13.9));
}

// Local cloud presence 0..1 for a weather value and a sky-cover setting (about `coverage` of the plane is above 0.5).
fn presence(n : f32, coverage : f32) -> f32 {
  let t = 0.80 - 0.62 * coverage;
  return smoothstep(t - 0.09, t + 0.09, n);
}

// How tall the cloud grows at a weather value: unlike presence, which switches over a narrow band so outlines stay crisp, this climbs
// slowly to the weather maxima, so each cloud's top is a dome peaking over its core instead of a flat lid at the layer ceiling.
fn cumulusTallness(n : f32, coverage : f32) -> f32 {
  let t = 0.80 - 0.62 * coverage;
  return smoothstep(t - 0.09, t + 0.3, n);
}

// The base is the condensation level: density climbs within the lowest 4% of the layer (about 50 m), a flat, sharp base.
fn cumulusGradient(hs : f32) -> f32 {
  return smoothstep(0.0, 0.04, hs) * (1.0 - smoothstep(0.62, 1.0, hs));
}

// Cumulus density 0..1 at a plane position (km) and height above the datum (km). detail 0..1 blends the erosion volume in (0 = mean erosion).
fn cumulusDensity(xz : vec2f, hKm : f32, detail : f32) -> f32 {
  let hf = (hKm - ap.cloudB.x) / (ap.cloudB.y - ap.cloudB.x);
  if (hf <= 0.0 || hf >= 1.0) { return 0.0; }
  let day = cumulusDay();
  let n = cumulusWeather(xz) - nightClearing(xz, day);
  let l = presence(n, cumulusCoverage());
  if (l <= 0.0) { return 0.0; }
  let fine = ap.cloudE.x * detail;
  var q = vec3f(xz.x, hKm, xz.y);
  var v = vec4f(0.5);
  var hg = hf;
  if (detail > 0.0) {
    v = textureSampleLevel(detailNoise, noiseSampler, q / DETAIL_TILE_KM, 0.0);
    // Wisps: the billows are looked up a little off their place, by an amount that itself varies, so their outlines curl and tear.
    if (fine > 0.0) { q += (v.rgb - 0.5) * (2.0 * WISP_KM * fine); }
    // The base is level overall but sags and lifts by tens of metres in rolls and lumps, which is what the low sun picks out from below.
    hg += BASE_RAG * detail * (v.r - 0.5) * (1.0 - smoothstep(0.05, 0.25, hf));
  }
  let hs = hg / (mix(0.25, 1.0, cumulusTallness(n, cumulusCoverage())) * mix(NIGHT_CUMULUS_TALL, 1.0, day));
  if (hs >= 1.0 + 0.5 * TOP_LUMPS) { return 0.0; }
  let s = textureSampleLevel(shapeNoise, noiseSampler, q / SHAPE_TILE_KM, 0.0);
  // Cauliflower tops: the top of the cloud rises over the low-frequency Worley blobs (s.g, 400 m) and sinks between them, so the upper
  // half is a cluster of turrets rather than one smooth dome.
  let grad = cumulusGradient(hs - TOP_LUMPS * (s.g - 0.5) * smoothstep(0.2, 0.6, hs));
  if (grad <= 0.0) { return 0.0; }
  let low = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
  let shape = saturate((s.r - low + 1.0) / (2.0 - low));
  let d = saturate(shape * grad - 1.0 + l);
  if (d <= 0.0) { return 0.0; }
  var erosion = 0.5;
  if (detail > 0.0) {
    var f = v.r * 0.625 + v.g * 0.25 + v.b * 0.125;
    if (fine > 0.0) {
      let w = textureSampleLevel(detailNoise, noiseSampler, q / FINE_DETAIL_TILE_KM + vec3f(0.37, 0.71, 0.13), 0.0);
      var fw = w.r * 0.5 + w.g * 0.3 + w.b * 0.2;
      // Extreme only (cloudDetail 1): a third octave of tens of metres, the small cauliflower bumps on the billows of a near cloud.
      let finest = saturate((ap.cloudE.x - 0.8) * 5.0) * detail;
      if (finest > 0.0) {
        let u = textureSampleLevel(detailNoise, noiseSampler, q / FINEST_DETAIL_TILE_KM + vec3f(0.11, 0.53, 0.29), 0.0);
        fw = mix(fw, 0.65 * fw + 0.35 * (u.r * 0.5 + u.g * 0.3 + u.b * 0.2), finest);
      }
      f = mix(f, 0.6 * f + 0.4 * fw, fine);
    }
    erosion = mix(0.5, mix(f, 1.0 - f, saturate(hf * 10.0)), detail);
  }
  let e = 0.35 * exp(-l * 0.75) * erosion * 2.0 * mix(1.0, FINE_EROSION, fine);
  // A cumulus has a sharp skin: droplets evaporate within metres of its edge, so density climbs from nothing to the core's within a few
  // tens of metres rather than over the whole billow. With the detail in, the ramp above the erosion threshold is steepened (the
  // threshold itself, and so the cloud's outline and cover, stays put); without it (shadow map, light march, CPU model) it is unchanged.
  return saturate((d - e) / (1.0 - e) * (1.0 + EDGE_SHARPEN * detail));
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
