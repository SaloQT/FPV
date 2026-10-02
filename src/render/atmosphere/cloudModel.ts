import { DEG } from './celestial';
import { PLANET_RADIUS_KM } from './physics';
import type { AtmosphereSettings } from './settings';
import { windOffset } from './uniforms';

/** Cloud shadow map: texels per side and the world extent it covers around the camera (metres). */
export const CLOUD_SHADOW_SIZE = 128;
export const CLOUD_SHADOW_EXTENT_M = 8000;
/** Extinction of a full-density cumulus core and of a full-density cirrus streak, 1/km (shaders/sky/cloud_density.wgsl). */
export const CUMULUS_SIGMA_KM = 40;
export const CIRRUS_SIGMA_KM = 0.9;

const SHAPE_TILE_KM = 7;
const CIRRUS_STREAK_KM: readonly [number, number, number] = [24, 4, 4];
const CUMULUS_STEPS = 32;
const CIRRUS_STEPS = 12;
const CIRRUS_WIND_SCALE = 1.8;
const CIRRUS_WIND_TURN_DEG = 15;
const H = new Uint32Array(3);
const SHAPE = new Float64Array(4);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const saturate = (x: number): number => Math.min(1, Math.max(0, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** PCG hash, bit-identical to pcg() in shaders/common/math.wgsl. */
export function pcg(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul((s >>> ((s >>> 28) + 4)) ^ s, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** Uniform 0..1 from a 32-bit hash (u01 in math.wgsl: top 24 bits). */
export const u01 = (h: number): number => (h >>> 8) / 16777216;

/** hash21 of math.wgsl for integer lattice coordinates (negative values wrap as u32, like bitcast<vec2u>(vec2i)). */
export const hash21 = (x: number, y: number): number => u01(pcg((x + pcg(y >>> 0)) >>> 0));

function pcg3(a: number, b: number, c: number): void {
  let x = (Math.imul(a, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(b, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(c, 1664525) + 1013904223) >>> 0;
  for (let round = 0; round < 2; round++) {
    x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
    if (round === 0) { x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0; }
  }
  H[0] = x; H[1] = y; H[2] = z;
}

const wrap = (c: number, period: number): number => ((c % period) + period) % period;

function cellHash(cx: number, cy: number, cz: number, period: number): void {
  pcg3((wrap(cx, period) + 0x9e3779b9) >>> 0, (wrap(cy, period) + 0x85ebca6b) >>> 0, (wrap(cz, period) + 0xc2b2ae35) >>> 0);
}

function gradientDot(cx: number, cy: number, cz: number, period: number, dx: number, dy: number, dz: number): number {
  cellHash(cx, cy, cz, period);
  const gx = u01(H[0]) * 2 - 1, gy = u01(H[1]) * 2 - 1, gz = u01(H[2]) * 2 - 1;
  return (gx * dx + gy * dy + gz * dz) / Math.max(Math.hypot(gx, gy, gz), 1e-3);
}

const fade = (f: number): number => f * f * f * (f * (f * 6 - 15) + 10);

/** Gradient noise on a lattice of `period` cells (cloud_noise.wgsl perlin()). */
function perlin(px: number, py: number, pz: number, period: number): number {
  const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
  const fx = px - bx, fy = py - by, fz = pz - bz;
  const ux = fade(fx), uy = fade(fy), uz = fade(fz);
  const g = (ox: number, oy: number, oz: number): number => gradientDot(bx + ox, by + oy, bz + oz, period, fx - ox, fy - oy, fz - oz);
  const x00 = mix(g(0, 0, 0), g(1, 0, 0), ux), x10 = mix(g(0, 1, 0), g(1, 1, 0), ux);
  const x01 = mix(g(0, 0, 1), g(1, 0, 1), ux), x11 = mix(g(0, 1, 1), g(1, 1, 1), ux);
  return 1.15 * mix(mix(x00, x10, uy), mix(x01, x11, uy), uz);
}

/** 1 - F1 of the jittered lattice (cloud_noise.wgsl worley()). */
function worley(px: number, py: number, pz: number, period: number): number {
  const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
  const fx = px - bx, fy = py - by, fz = pz - bz;
  let d2 = 4;
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    cellHash(bx + x, by + y, bz + z, period);
    const qx = x + u01(H[0]) - fx, qy = y + u01(H[1]) - fy, qz = z + u01(H[2]) - fz;
    d2 = Math.min(d2, qx * qx + qy * qy + qz * qz);
  }
  return 1 - saturate(Math.sqrt(d2));
}

function perlinFbm(px: number, py: number, pz: number, period: number): number {
  let sum = 0, amp = 0.5, norm = 0, freq = 1;
  for (let o = 0; o < 3; o++) {
    sum += amp * perlin(px * freq, py * freq, pz * freq, period * freq);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return saturate(0.5 + (0.5 * sum) / norm);
}

/** The 128^3 shape volume evaluated continuously at texture coordinate (u, v, w) (a wrapping coordinate): SHAPE = (r, g, b, a). */
function shapeNoise(u: number, v: number, w: number): void {
  const w4 = worley(u * 4, v * 4, w * 4, 4);
  SHAPE[0] = mix(w4, 1, perlinFbm(u * 4, v * 4, w * 4, 4));
  SHAPE[1] = w4;
  SHAPE[2] = worley(u * 8, v * 8, w * 8, 8);
  SHAPE[3] = worley(u * 16, v * 16, w * 16, 16);
}

/** Everything the cloud density depends on, resolved once per query. */
export interface CloudField {
  cumulusCoverage: number;
  cirrusCoverage: number;
  density: number;
  cumulusBaseKm: number;
  cumulusTopKm: number;
  cirrusBaseKm: number;
  cirrusTopKm: number;
  seedX: number;
  seedY: number;
  cumulusDrift: [number, number];
  cirrusDrift: [number, number];
  streakBearing: number;
  datumRadiusKm: number;
}

/** The field for a settings block, a world seed, a sim time and the observer's altitude above sea level (m). */
export function cloudField(s: AtmosphereSettings, seed: number, timeSeconds: number, observerAltitudeM: number, out?: CloudField): CloudField {
  const f: CloudField = out ?? {
    cumulusCoverage: 0, cirrusCoverage: 0, density: 1, cumulusBaseKm: 0, cumulusTopKm: 0, cirrusBaseKm: 0, cirrusTopKm: 0,
    seedX: 0, seedY: 0, cumulusDrift: [0, 0], cirrusDrift: [0, 0], streakBearing: 0, datumRadiusKm: 0,
  };
  f.cumulusCoverage = s.cloudsEnabled ? s.cloudCoverage : 0;
  f.cirrusCoverage = s.cloudsEnabled ? s.cirrusCoverage : 0;
  f.density = s.cloudDensity;
  f.cumulusBaseKm = s.cumulusBaseKm; f.cumulusTopKm = s.cumulusTopKm; f.cirrusBaseKm = s.cirrusBaseKm; f.cirrusTopKm = s.cirrusTopKm;
  f.seedX = seed * 13.37; f.seedY = seed * 7.13 + 100;
  windOffset(s.windSpeed, s.windDirectionDeg, timeSeconds, f.cumulusDrift);
  windOffset(s.windSpeed * CIRRUS_WIND_SCALE, s.windDirectionDeg + CIRRUS_WIND_TURN_DEG, timeSeconds, f.cirrusDrift);
  f.streakBearing = (s.windDirectionDeg + CIRRUS_WIND_TURN_DEG) * DEG;
  f.datumRadiusKm = PLANET_RADIUS_KM + observerAltitudeM / 1000;
  return f;
}

function vnoise2(x: number, y: number): number {
  const bx = Math.floor(x), by = Math.floor(y);
  const fx = x - bx, fy = y - by;
  const ux = fade(fx), uy = fade(fy);
  const a = hash21(bx, by), c = hash21(bx + 1, by), d = hash21(bx, by + 1), e = hash21(bx + 1, by + 1);
  return mix(mix(a, c, ux), mix(d, e, ux), uy);
}

/** Weather value 0..1 of the cumulus map at a world-plane position (km), including the seed offset. */
export const cumulusWeather = (x: number, y: number): number =>
  0.45 * vnoise2(x / 9, y / 9) + 0.35 * vnoise2(x / 4 + 17.3, y / 4 + 9.1) + 0.2 * vnoise2(x / 1.8 + 3.7, y / 1.8 + 41.9);

export const cirrusWeather = (x: number, y: number): number =>
  0.6 * vnoise2(x / 30 + 5.1, y / 30 + 2.3) + 0.4 * vnoise2(x / 11 + 29.7, y / 11 + 13.9);

/** Local cloud presence 0..1 for a weather value and a sky-cover setting: about `coverage` of the plane is above 0.5. */
export function presence(n: number, coverage: number): number {
  const t = 0.8 - 0.62 * coverage;
  return smoothstep(t - 0.09, t + 0.09, n);
}

/** Fair-weather cumulus is convective and dissipates after sunset, so a night keeps this fraction of the daytime cover (a mostly clear night is the default). */
export const NIGHT_CUMULUS_SCALE = 0.35;
export const NIGHT_CUMULUS_SIN_LO = -0.2;
export const NIGHT_CUMULUS_SIN_HI = 0.05;

/** Factor on the cumulus sky cover for a sun whose elevation has the given sine: 1 by day, NIGHT_CUMULUS_SCALE from about -11.5 degrees down. */
export function nightCumulusScale(sinSunElevation: number): number {
  return mix(NIGHT_CUMULUS_SCALE, 1, smoothstep(NIGHT_CUMULUS_SIN_LO, NIGHT_CUMULUS_SIN_HI, sinSunElevation));
}

/** Schneider's height gradient: ramps up over the first 10 % and down over the last 38 % of the (per-cloud scaled) layer. */
export const cumulusGradient = (hs: number): number => smoothstep(0, 0.1, hs) * (1 - smoothstep(0.62, 1, hs));

/** Cumulus density 0..1 at a plane position (km) and height above the datum (km), with the detail volume at its mean erosion. */
export function cumulusDensity(f: CloudField, x: number, y: number, hKm: number): number {
  const hf = (hKm - f.cumulusBaseKm) / (f.cumulusTopKm - f.cumulusBaseKm);
  if (hf <= 0 || hf >= 1) return 0;
  const l = presence(cumulusWeather(x, y), f.cumulusCoverage);
  if (l <= 0) return 0;
  const grad = cumulusGradient(hf / mix(0.3, 1, l));
  if (grad <= 0) return 0;
  shapeNoise(x / SHAPE_TILE_KM, hKm / SHAPE_TILE_KM, y / SHAPE_TILE_KM);
  const low = SHAPE[1] * 0.625 + SHAPE[2] * 0.25 + SHAPE[3] * 0.125;
  const shape = saturate((SHAPE[0] - low + 1) / (2 - low));
  const d = saturate(shape * grad - 1 + l);
  if (d <= 0) return 0;
  const e = 0.35 * Math.exp(-l * 0.75);
  return saturate((d - e) / (1 - e));
}

export function cirrusDensity(f: CloudField, x: number, y: number, hKm: number): number {
  const hf = (hKm - f.cirrusBaseKm) / (f.cirrusTopKm - f.cirrusBaseKm);
  if (hf <= 0 || hf >= 1) return 0;
  const l = presence(cirrusWeather(x, y), f.cirrusCoverage);
  if (l <= 0) return 0;
  const a = f.streakBearing;
  const along = x * Math.sin(a) - y * Math.cos(a), across = x * Math.cos(a) + y * Math.sin(a);
  shapeNoise(along / CIRRUS_STREAK_KM[0], across / CIRRUS_STREAK_KM[1], hKm / CIRRUS_STREAK_KM[2]);
  const fibre = 0.55 * SHAPE[0] + 0.45 * SHAPE[2];
  return saturate((fibre - (1 - l) * 0.9) / 0.5) * Math.sin(Math.PI * hf);
}

/** Near / far hit of a ray from (0, oy, 0) [km] with the sphere of radius r about the origin; near > far means a miss. */
function raySphere(oy: number, dy: number, r: number, out: [number, number]): [number, number] {
  const b = oy * dy, disc = b * b - (oy * oy - r * r);
  if (disc < 0) { out[0] = 1; out[1] = -1; return out; }
  const s = Math.sqrt(disc);
  out[0] = -b - s; out[1] = -b + s;
  return out;
}

const TOP: [number, number] = [0, 0];
const BOT: [number, number] = [0, 0];
const SPAN: [number, number] = [0, 0];

/** The ray's interval inside the shell rBot..rTop (mirrors shellInterval() in cloud_density.wgsl); SPAN[0] >= SPAN[1] means a miss. */
function shellInterval(oy: number, dy: number, rBot: number, rTop: number): [number, number] {
  raySphere(oy, dy, rTop, TOP);
  if (TOP[0] > TOP[1]) { SPAN[0] = 1; SPAN[1] = -1; return SPAN; }
  let t0 = Math.max(TOP[0], 0), t1 = TOP[1];
  raySphere(oy, dy, rBot, BOT);
  if (BOT[0] <= BOT[1]) {
    if (BOT[0] > t0) t1 = Math.min(t1, BOT[0]);
    else if (BOT[1] > t0) t0 = BOT[1];
  }
  SPAN[0] = t0; SPAN[1] = t1;
  return SPAN;
}

/**
 * Optical depth of both cloud layers along a ray from a world position (metres; y above the datum) in a unit direction, through the
 * same density functions the sky pass renders (detail volume at its mean erosion, midpoint sampling). Rays that point below the
 * horizontal see no cloud (the sun/moon are then below the horizon and the caller's own horizon term applies).
 */
export function cloudOpticalDepth(f: CloudField, camX: number, camY: number, camZ: number, dx: number, dy: number, dz: number): number {
  if (dy <= 0) return 0;
  const oy = f.datumRadiusKm + camY / 1000;
  let tau = 0;
  for (let layer = 0; layer < 2; layer++) {
    const cirrus = layer === 1;
    if ((cirrus ? f.cirrusCoverage : f.cumulusCoverage) <= 0) continue;
    const rBot = f.datumRadiusKm + (cirrus ? f.cirrusBaseKm : f.cumulusBaseKm), rTop = f.datumRadiusKm + (cirrus ? f.cirrusTopKm : f.cumulusTopKm);
    const span = shellInterval(oy, dy, rBot, rTop);
    const t0 = span[0], t1 = span[1];
    if (t0 >= t1) continue;
    const steps = cirrus ? CIRRUS_STEPS : CUMULUS_STEPS, ds = (t1 - t0) / steps;
    const drift = cirrus ? f.cirrusDrift : f.cumulusDrift;
    for (let i = 0; i < steps; i++) {
      const t = t0 + ds * (i + 0.5);
      const px = dx * t, py = oy + dy * t, pz = dz * t;
      const h = Math.hypot(px, py, pz) - f.datumRadiusKm;
      const x = (camX + px * 1000 - drift[0]) * 0.001 + f.seedX, y = (camZ + pz * 1000 - drift[1]) * 0.001 + f.seedY;
      tau += cirrus ? CIRRUS_SIGMA_KM * f.density * cirrusDensity(f, x, y, h) * ds : CUMULUS_SIGMA_KM * f.density * cumulusDensity(f, x, y, h) * ds;
    }
  }
  return tau;
}

/** Direct-light visibility exp(-tau) of a light along a unit direction from a world position: 1 = unobstructed, 0 = fully blocked. */
export function cloudVisibility(f: CloudField, camX: number, camY: number, camZ: number, dx: number, dy: number, dz: number): number {
  return Math.exp(-cloudOpticalDepth(f, camX, camY, camZ, dx, dy, dz));
}

/**
 * Sky-light gain of a cloudy sky: the sun's beam that a cloud deck takes out is re-emitted downward as diffuse light. Two-stream
 * theory puts a thick deck's diffuse transmission near 0.2 of the incoming beam against ~0.12 for a clear sky's diffuse fraction, so
 * the ground's sky light rises toward ~1.8x at full overcast. `c` is the mean sky cover (cirrus counts at 30 %); the response is
 * convex in c because scattered cumulus leaves most of the dome clear.
 */
export function cloudAmbientScale(s: AtmosphereSettings): number {
  if (!s.cloudsEnabled) return 1;
  const c = saturate(s.cloudCoverage + 0.3 * s.cirrusCoverage * (1 - s.cloudCoverage));
  return 1 + 0.8 * Math.pow(c, 1.5);
}

/** The shadow-map centre coordinate (metres) for a camera coordinate: snapped to the texel grid so the map does not shimmer as the camera moves. */
export function snapShadowCenter(coordinateM: number, extentM = CLOUD_SHADOW_EXTENT_M, size = CLOUD_SHADOW_SIZE): number {
  const texel = extentM / size;
  return Math.round(coordinateM / texel) * texel;
}
