/**
 * Atmosphere physics shared by the CPU reference, the tests and the WGSL constants (shaders/sky/atmos_params.wgsl mirrors these).
 *
 * UNIT CHAIN: extinction and scattering coefficients are per km; lights are illuminance in lux (frame.sunIrradiance /
 * frame.moonIrradiance, top of atmosphere); phase functions are per steradian (integrate to 1); therefore
 *   radiance [cd/m2 = nits] = illuminance [lux] * integral( T * sigma_s[1/km] * phase[1/sr] * T_light ds[km] ).
 * Lookup tables hold NITS, never pre-exposed. Pre-exposure (frame.params.y) is applied only when writing to the HDR target.
 */

import type { Vec3 } from '../../contracts';

export const PLANET_RADIUS_KM = 6360;
export const ATMOSPHERE_TOP_KM = 6460;

export const RAYLEIGH_SCATTER: Vec3 = [5.802e-3, 13.558e-3, 33.1e-3];
export const RAYLEIGH_SCALE_HEIGHT_KM = 8;
export const MIE_SCATTER = 3.996e-3;
export const MIE_EXTINCTION = 4.44e-3;
export const MIE_SCALE_HEIGHT_KM = 1.2;
export const MIE_G = 0.8;
export const OZONE_ABSORPTION: Vec3 = [0.65e-3, 1.881e-3, 0.085e-3];
export const OZONE_CENTER_KM = 25;
export const OZONE_HALF_WIDTH_KM = 15;
export const GROUND_ALBEDO = 0.3;

/** Van Rhijn airglow layer height above the ground and its zenith radiance (nits) for a night-scale of 1. */
export const AIRGLOW_HEIGHT_KM = 90;
export const AIRGLOW_ZENITH_NITS: Vec3 = [0.6 * 2e-3, 0.9 * 2e-3, 0.7 * 2e-3];
/** Zodiacal light plus integrated unresolved starlight, a flat floor (nits) for a night-scale of 1. */
export const STARLIGHT_SKY_NITS: Vec3 = [0.9e-4, 1.0e-4, 1.15e-4];

export const TRANSMITTANCE_SIZE = { width: 256, height: 64 } as const;
export const MULTISCATTER_SIZE = 32;
export const SKYVIEW_SIZE = { width: 192, height: 108 } as const;
export const AP_SLICES = 32;
export const AP_MAX_DISTANCE_M = 12000;
export const AP_DEPTH_K = 6;

export interface Medium {
  scatterRayleigh: Vec3;
  scatterMie: number;
  extinction: Vec3;
}

export function mediumAt(heightKm: number, out: Medium = { scatterRayleigh: [0, 0, 0], scatterMie: 0, extinction: [0, 0, 0] }): Medium {
  const h = Math.max(heightKm, 0);
  const dR = Math.exp(-h / RAYLEIGH_SCALE_HEIGHT_KM);
  const dM = Math.exp(-h / MIE_SCALE_HEIGHT_KM);
  const dO = Math.max(0, 1 - Math.abs(h - OZONE_CENTER_KM) / OZONE_HALF_WIDTH_KM);
  out.scatterMie = MIE_SCATTER * dM;
  for (let c = 0; c < 3; c++) {
    out.scatterRayleigh[c] = RAYLEIGH_SCATTER[c] * dR;
    out.extinction[c] = out.scatterRayleigh[c] + MIE_EXTINCTION * dM + OZONE_ABSORPTION[c] * dO;
  }
  return out;
}

/** Distance from a point at radius r along zenith cosine mu to the atmosphere top (km). */
export function distanceToTop(r: number, mu: number): number {
  return Math.max(0, -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + ATMOSPHERE_TOP_KM * ATMOSPHERE_TOP_KM, 0)));
}

/** Optical depth from (r, mu) to the top of the atmosphere, ignoring the planet, midpoint rule. */
export function opticalDepthToTop(r: number, mu: number, steps = 64): Vec3 {
  const d = distanceToTop(r, mu);
  const ds = d / steps;
  const tau: Vec3 = [0, 0, 0];
  const m: Medium = { scatterRayleigh: [0, 0, 0], scatterMie: 0, extinction: [0, 0, 0] };
  const sinT = Math.sqrt(Math.max(0, 1 - mu * mu));
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const x = sinT * t, y = r + mu * t;
    mediumAt(Math.hypot(x, y) - PLANET_RADIUS_KM, m);
    for (let c = 0; c < 3; c++) tau[c] += m.extinction[c] * ds;
  }
  return tau;
}

export function transmittanceToTop(r: number, mu: number, steps = 64): Vec3 {
  const t = opticalDepthToTop(r, mu, steps);
  return [Math.exp(-t[0]), Math.exp(-t[1]), Math.exp(-t[2])];
}

export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Cornette-Shanks phase (per sr). */
export function miePhase(cosTheta: number, g = MIE_G): number {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + cosTheta * cosTheta))) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5));
}

/** Henyey-Greenstein phase (per sr). */
export function hgPhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5));
}

export const unitToSubUv = (u: number, res: number): number => (u * (res - 1) + 0.5) / res;
export const subUvToUnit = (u: number, res: number): number => (u - 0.5 / res) * (res / (res - 1));

const TOP_HORIZON = Math.sqrt(ATMOSPHERE_TOP_KM * ATMOSPHERE_TOP_KM - PLANET_RADIUS_KM * PLANET_RADIUS_KM);

/** Transmittance LUT uv for radius r (km) and zenith cosine mu. Same as transmittanceUv() in common/atmosphere_sample.wgsl. */
export function transmittanceUv(r: number, mu: number): [number, number] {
  const rho = Math.sqrt(Math.max(r * r - PLANET_RADIUS_KM * PLANET_RADIUS_KM, 0));
  const d = distanceToTop(r, mu);
  const dMin = ATMOSPHERE_TOP_KM - r;
  const dMax = rho + TOP_HORIZON;
  const sat = (x: number): number => Math.min(1, Math.max(0, x));
  return [sat((d - dMin) / Math.max(dMax - dMin, 1e-6)), sat(rho / TOP_HORIZON)];
}

/** Inverse of transmittanceUv: (r, mu). */
export function transmittanceParams(u: number, v: number): [number, number] {
  const rho = TOP_HORIZON * v;
  const r = Math.sqrt(rho * rho + PLANET_RADIUS_KM * PLANET_RADIUS_KM);
  const dMin = ATMOSPHERE_TOP_KM - r;
  const dMax = rho + TOP_HORIZON;
  const d = dMin + u * (dMax - dMin);
  const mu = d === 0 ? 1 : Math.min(1, Math.max(-1, (TOP_HORIZON * TOP_HORIZON - rho * rho - d * d) / (2 * r * d)));
  return [r, mu];
}

/** Sky-view uv for a view direction with zenith cosine and cosine of the azimuth to the light, seen from radius r. */
export function skyViewUv(cosZenith: number, cosAz: number, r: number): [number, number] {
  const beta = Math.acos(Math.sqrt(Math.max(r * r - PLANET_RADIUS_KM * PLANET_RADIUS_KM, 0)) / r);
  const zenithHorizon = Math.PI - beta;
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const v = zenith < zenithHorizon
    ? (1 - Math.sqrt(1 - zenith / zenithHorizon)) * 0.5
    : Math.sqrt(Math.min(1, Math.max(0, (zenith - zenithHorizon) / beta))) * 0.5 + 0.5;
  const u = Math.sqrt(Math.min(1, Math.max(0, 0.5 - 0.5 * cosAz)));
  return [unitToSubUv(u, SKYVIEW_SIZE.width), unitToSubUv(v, SKYVIEW_SIZE.height)];
}

/** Inverse of skyViewUv: [cosZenith, cosAz]. */
export function skyViewParams(u: number, v: number, r: number): [number, number] {
  const uu = subUvToUnit(u, SKYVIEW_SIZE.width);
  const vv = subUvToUnit(v, SKYVIEW_SIZE.height);
  const beta = Math.acos(Math.sqrt(Math.max(r * r - PLANET_RADIUS_KM * PLANET_RADIUS_KM, 0)) / r);
  const zenithHorizon = Math.PI - beta;
  let cosZenith: number;
  if (vv < 0.5) {
    const c = 1 - 2 * vv;
    cosZenith = Math.cos(zenithHorizon * (1 - c * c));
  } else {
    const c = 2 * vv - 1;
    cosZenith = Math.cos(zenithHorizon + beta * c * c);
  }
  return [cosZenith, 1 - 2 * uu * uu];
}

export const apSliceToDistance = (w: number): number => (AP_MAX_DISTANCE_M * (Math.exp(AP_DEPTH_K * w) - 1)) / (Math.exp(AP_DEPTH_K) - 1);
export const apDistanceToSlice = (d: number): number => Math.log(1 + (d * (Math.exp(AP_DEPTH_K) - 1)) / AP_MAX_DISTANCE_M) / AP_DEPTH_K;

/** Van Rhijn factor: airglow slant-path enhancement at a zenith cosine for a thin shell AIRGLOW_HEIGHT_KM above the ground. */
export function vanRhijn(cosZenith: number, groundRadiusKm = PLANET_RADIUS_KM): number {
  const s = (groundRadiusKm / (groundRadiusKm + AIRGLOW_HEIGHT_KM)) * Math.sqrt(Math.max(0, 1 - cosZenith * cosZenith));
  return 1 / Math.sqrt(1 - s * s);
}
