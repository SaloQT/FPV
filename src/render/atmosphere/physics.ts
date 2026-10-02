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
/** Continental aerosol of a clear day: sea-level vertical optical depth 0.14 (scale height 1.4 km), single-scatter albedo 0.92. */
export const MIE_EXTINCTION = 0.1;
export const MIE_SCATTER = 0.092;
export const MIE_SCALE_HEIGHT_KM = 1.4;
/**
 * Aerosol phase function: a narrow diffraction peak (the glare around the sun and moon), a broad forward lobe, a nearly isotropic side lobe
 * and a weak back lobe. A single g = 0.76 lobe is flat out to 16 degrees and spreads a haze over the whole sun side of the sky. Real
 * aerosols peak within a couple of degrees and the glow is mostly gone by 6 degrees: here p(0) ~ 12, p(0.8 deg) ~ 10, p(5.6 deg) ~ 1.2 (an eighth
 * of the peak), p(20 deg) ~ 0.34 per sr, and ~0.035 per sr at 90 degrees. At night that glare is the moon's aureole, and the earlier wider
 * peak (p(5.6 deg) ~ 1.9) read as a haze disc around it.
 */
export const MIE_G = 0.6;
export const MIE_NARROW_G = 0.96;
export const MIE_NARROW_WEIGHT = 0.12;
export const MIE_SIDE_G = 0.3;
export const MIE_SIDE_WEIGHT = 0.22;
export const MIE_BACK_G = -0.3;
export const MIE_BACK_WEIGHT = 0.16;
/**
 * Ozone (Chappuis band, peak 603 nm) per km at the layer's centre. Integrating the band over the sRGB primaries gives ~2.3 (red) and ~1.55
 * (green), a compromise that is not literally right: with those the sun-side twilight glow goes yellow-green (the far-red that survives the
 * long slant path is lost to one red channel), and with the old point samples at 680 / 550 / 440 nm (0.65, 1.88, 0.085) green was absorbed
 * more than red and the whole twilight dome came out magenta-lilac. These values keep red a little weaker than green: the zenith is
 * blue-violet (R/Y ~ 0.7, G/Y ~ 1.0, B/Y ~ 2.3 at sun -4.5 deg), the sun-side horizon keeps its orange-pink (R/Y > 1.2).
 */
export const OZONE_ABSORPTION: Vec3 = [1.5e-3, 1.65e-3, 0.09e-3];
export const OZONE_CENTER_KM = 25;
export const OZONE_HALF_WIDTH_KM = 15;
export const GROUND_ALBEDO = 0.3;
/**
 * Extra cooling of the moonlit sky (the aureole and the moon's aerial perspective) on top of the tint already in frame.moonIrradiance. Moonlit
 * scenes are seen with blue-shifted scotopic vision, so moonlight scattered into the air reads as a cool glow, not the tan of the moon's own
 * reddish albedo. Roughly luminance neutral.
 */
export const MOON_SCATTER_TINT: Vec3 = [0.92, 1, 1.1];

/**
 * Night light that is not scattered sunlight (nits at a night-scale of 1, before extinction; shaders/sky/night_light.wgsl mirrors it).
 * Airglow is a thin shell at 90 km: about 21.5 mag/arcsec2 (Y 3.2e-4) at the zenith, near neutral, with the [OI] green line adding
 * to the slant path only. Starlight is the unresolved part of the flat floor; zodiacal light is separate (1 S10 = 8.3e-7 nits).
 */
export const AIRGLOW_HEIGHT_KM = 90;
export const AIRGLOW_ZENITH_NITS: Vec3 = [3.1e-4, 3.2e-4, 3.4e-4];
export const AIRGLOW_SLANT_TINT_NITS: Vec3 = [-1.5e-5, 4e-5, -1e-5];
export const STARLIGHT_SKY_NITS: Vec3 = [3.5e-5, 3.5e-5, 3.8e-5];
export const NITS_PER_S10 = 8.3e-7;
export const ZODIACAL_COLOR: Vec3 = [1, 0.98, 0.93];
export const ZODIACAL_POLE_S10 = 77;
export const ZODIACAL_FAR_S10 = 140;
export const ZODIACAL_NEAR_S10 = 1360;
export const GEGENSCHEIN_S10 = 45;

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
export function cornetteShanksPhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + cosTheta * cosTheta))) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * cosTheta, 1.5));
}

/** Aerosol phase (per sr), the four-lobe mixture described at MIE_G; integrates to 1. */
export function miePhase(cosTheta: number): number {
  const broad = 1 - MIE_NARROW_WEIGHT - MIE_SIDE_WEIGHT - MIE_BACK_WEIGHT;
  return broad * cornetteShanksPhase(cosTheta, MIE_G) + MIE_NARROW_WEIGHT * hgPhase(cosTheta, MIE_NARROW_G)
    + MIE_SIDE_WEIGHT * hgPhase(cosTheta, MIE_SIDE_G) + MIE_BACK_WEIGHT * hgPhase(cosTheta, MIE_BACK_G);
}

/**
 * Gain on the multiple-scattering term along a view ray with horizontal cosine `cosToLight` to the light's azimuth (view . horizontal light
 * direction, so 0 at the zenith). The table holds the sphere average of the second-order light, which is isotropic and so fills the Earth's
 * shadow on the anti-solar side as brightly as the glow side. After sunset most of that light comes from the sunlit air on the glow side:
 * a dipole of strength MS_DIPOLE (mean 1 over the sphere, so the average is unchanged) toward the light, fading out for a light above
 * MS_DIPOLE_MU_HI of local elevation, restores the glow-to-shadow gradient. 1 for a light well above the horizon.
 */
export const MS_DIPOLE = 0.8;
export const MS_DIPOLE_MU_LO = -0.1;
export const MS_DIPOLE_MU_HI = 0.03;
export function multiScatterDipole(lightMuLocal: number, cosToLight: number): number {
  const t = Math.min(1, Math.max(0, (lightMuLocal - MS_DIPOLE_MU_LO) / (MS_DIPOLE_MU_HI - MS_DIPOLE_MU_LO)));
  return 1 + MS_DIPOLE * (1 - t * t * (3 - 2 * t)) * cosToLight;
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

/** Airglow plus starlight floor toward a zenith cosine (nits, before extinction). */
export function nightSkyNits(cosZenith: number, groundRadiusKm = PLANET_RADIUS_KM): Vec3 {
  const vr = vanRhijn(cosZenith, groundRadiusKm);
  return [0, 1, 2].map((c) => AIRGLOW_ZENITH_NITS[c] * vr + AIRGLOW_SLANT_TINT_NITS[c] * (vr - 1) + STARLIGHT_SKY_NITS[c]) as Vec3;
}

/**
 * Zodiacal light in S10 (solar-type stars of magnitude 10 per square degree) from the sun elongation and the ecliptic latitude of the
 * view direction: about 1500 on the ecliptic at 30 deg, 230 at 90 deg, 77 at the ecliptic pole, with a gegenschein bump at 180 deg.
 */
export function zodiacalS10(cosElongation: number, sinEclipticLat: number): number {
  const eps = Math.max(Math.acos(Math.min(Math.max(cosElongation, -1), 1)) * (180 / Math.PI), 15);
  const gegen = GEGENSCHEIN_S10 * Math.exp(-(((180 - eps) / 8) ** 2));
  const onEcliptic = ZODIACAL_FAR_S10 + ZODIACAL_NEAR_S10 * Math.pow(30 / eps, 2.5) + gegen;
  const cosLat = Math.sqrt(Math.max(1 - sinEclipticLat * sinEclipticLat, 0));
  const steepness = 5 + 25 * Math.exp(-eps / 35);
  return ZODIACAL_POLE_S10 + (onEcliptic - ZODIACAL_POLE_S10) * Math.pow(cosLat, steepness);
}

export function zodiacalNits(cosElongation: number, sinEclipticLat: number): Vec3 {
  const nits = zodiacalS10(cosElongation, sinEclipticLat) * NITS_PER_S10;
  return [nits * ZODIACAL_COLOR[0], nits * ZODIACAL_COLOR[1], nits * ZODIACAL_COLOR[2]];
}
