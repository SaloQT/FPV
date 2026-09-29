/**
 * Sun and Moon appearance data shared by the uniform packer and the tests.
 *
 * Lunar features are stored in selenographic coordinates (east-positive longitude, north-positive latitude) with the near side facing
 * the Earth, north up, libration ignored. Angular sizes are ARC radii on the lunar surface in degrees, so a feature 300 km across has
 * radius 300 / 2 / 30.32 = 4.9 degrees (1 degree of lunar arc = 30.32 km).
 */

import type { Vec3 } from '../../contracts';
import { galacticToEquatorial } from '../../world/astro/stars';

export const DEG = Math.PI / 180;

/** After pre-exposure the sun disc is clamped here so hdr * preExposure stays finite in rgba16float (max 65504). */
export const SUN_DISC_MAX_HDR = 58976;
/** Linear limb-darkening coefficients per RGB channel, I(mu) / I(1) = 1 - u (1 - mu). Blue limbs darken most. */
export const SUN_LIMB_U: Vec3 = [0.55, 0.66, 0.8];

/** Limb darkening of channel c at mu = cos(angle from the disc centre), normalised so the disc-mean equals 1. */
export function sunLimbFactor(mu: number, channel: number): number {
  const u = SUN_LIMB_U[channel];
  return (1 - u * (1 - Math.max(0, Math.min(1, mu)))) / (1 - u / 3);
}

/** Radiance (nits) of the sun's disc centre from the top-of-atmosphere illuminance (lux) and its angular radius (rad). */
export function sunDiscRadiance(illuminanceLux: number, angularRadius: number): number {
  return illuminanceLux / (Math.PI * angularRadius * angularRadius);
}

export type LunarFeatureKind = 'mare' | 'crater';

export interface LunarFeature {
  name: string;
  kind: LunarFeatureKind;
  lonDeg: number;
  latDeg: number;
  /** Arc radius along the parallel and along the meridian (before rotation), degrees. */
  radiusLonDeg: number;
  radiusLatDeg: number;
  /** Mare: 1 = full mare darkening. Crater: ray/ejecta brightness. */
  strength: number;
  /** Fractional edge softness (of the radius). */
  softness: number;
  /** Rotation of the ellipse in the local east/north plane, degrees counter-clockwise from east. */
  rotationDeg: number;
}

const mare = (name: string, lonDeg: number, latDeg: number, radiusLonDeg: number, radiusLatDeg: number, strength: number, rotationDeg = 0, softness = 0.22): LunarFeature =>
  ({ name, kind: 'mare', lonDeg, latDeg, radiusLonDeg, radiusLatDeg, strength, softness, rotationDeg });
const crater = (name: string, lonDeg: number, latDeg: number, radiusDeg: number, strength: number): LunarFeature =>
  ({ name, kind: 'crater', lonDeg, latDeg, radiusLonDeg: radiusDeg, radiusLatDeg: radiusDeg, strength, softness: 0.5, rotationDeg: 0 });

/** 12 major maria of the brief plus smaller ones, then the bright ray craters. */
export const LUNAR_FEATURES: readonly LunarFeature[] = [
  mare('Mare Imbrium', -16, 33, 18.5, 16, 1.0),
  mare('Mare Serenitatis', 18, 28, 11.7, 11.7, 1.0),
  mare('Mare Tranquillitatis', 31, 8.5, 13.5, 11, 0.95),
  mare('Mare Crisium', 59, 17, 6.9, 6.2, 1.0),
  mare('Mare Fecunditatis', 51, -8, 9.5, 14, 0.85, 20),
  mare('Mare Nectaris', 34, -15, 5.5, 5.5, 0.9),
  mare('Oceanus Procellarum', -57, 18, 17, 24, 0.8, 10, 0.35),
  mare('Mare Nubium', -17, -21, 12, 9.5, 0.85),
  mare('Mare Humorum', -39, -24, 6.4, 6.4, 0.95),
  mare('Mare Frigoris', 1, 56, 26.5, 4, 0.7, 0, 0.3),
  mare('Mare Vaporum', 3, 13, 4.2, 4.2, 0.9),
  mare('Mare Cognitum', -23, -10, 6.2, 5, 0.85),
  mare('Mare Insularum', -31, 7.5, 8.5, 7, 0.8),
  mare('Sinus Medii', 2, 0.5, 5.5, 4.5, 0.7),
  mare('Mare Humboldtianum', 82, 57, 4.5, 4.5, 0.9),
  mare('Mare Marginis', 86, 13, 6, 5, 0.8),
  mare('Mare Smythii', 87, 1.3, 6, 5, 0.85),
  mare('Mare Somniorum', 31, 21, 6, 5, 0.85),
  mare('Sinus Iridum', -31.5, 44, 4.2, 4.2, 0.9),
  mare('Sinus Aestuum', -8, 12, 5, 4.5, 0.85),
  crater('Tycho', -11.4, -43.4, 0.9, 1.0),
  crater('Copernicus', -20.1, 9.6, 0.8, 0.85),
  crater('Kepler', -38, 8.1, 0.45, 0.7),
  crater('Aristarchus', -47.4, 23.7, 0.5, 1.0),
  crater('Proclus', 46.9, 16.1, 0.35, 0.8),
];

/** Rows of the AtmosParams maria array: two vec4 per feature. */
export const LUNAR_ROWS = LUNAR_FEATURES.length * 2;

/** Unit vector on the visible disc (x right, y up, z toward the observer) of a selenographic longitude/latitude, radians. */
export function selenographicToDisc(lon: number, lat: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = Math.cos(lat);
  out[0] = c * Math.sin(lon);
  out[1] = Math.sin(lat);
  out[2] = c * Math.cos(lon);
  return out;
}

/** Inverse of selenographicToDisc for a point on the unit sphere: [lon, lat] in radians. */
export function discToSelenographic(x: number, y: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = Math.atan2(x, z);
  out[1] = Math.asin(Math.max(-1, Math.min(1, y)));
  return out;
}

/** Equatorial J2000 unit vectors of the galactic axes (l = 0 b = 0, l = 90 b = 0, north pole): the columns of the galactic matrix. */
export function galacticAxesEquatorial(): [Vec3, Vec3, Vec3] {
  const m = galacticToEquatorial;
  return [[m[0], m[3], m[6]], [m[1], m[4], m[7]], [m[2], m[5], m[8]]];
}
