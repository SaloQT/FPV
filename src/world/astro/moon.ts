/** The Moon: Meeus ch. 47 (full ELP-2000/82 truncation), topocentric parallax (ch. 40) and phase (ch. 48). */

import { DEG, julianCenturies, meanObliquity, nutation, wrapTau } from './julian';
import { eclipticToEquatorial } from './coords';
import { MOON_LON_DIST_TERMS } from './moonTerms';
import { MOON_LAT_TERMS } from './moonTermsLat';

export const MOON_RADIUS_KM = 1737.4;
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;
const EARTH_FLATTENING_RATIO = 0.99664719;

export interface MoonPosition {
  /** Apparent (nutation-corrected) geocentric ecliptic longitude and latitude of date, radians. */
  eclipticLongitudeRad: number;
  eclipticLatitudeRad: number;
  distanceKm: number;
  /** Apparent geocentric equatorial coordinates of date, radians. */
  raRad: number;
  decRad: number;
  angularRadiusRad: number;
}

export function newMoonPosition(): MoonPosition {
  return { eclipticLongitudeRad: 0, eclipticLatitudeRad: 0, distanceKm: 0, raRad: 0, decRad: 0, angularRadiusRad: 0 };
}

const NUT: [number, number] = [0, 0];
const EQ: [number, number] = [0, 0];

/** `jdTT` is a Julian date in Terrestrial Time. */
export function moonGeocentric(jdTT: number, out: MoonPosition = newMoonPosition()): MoonPosition {
  const T = julianCenturies(jdTT);
  const Lp = 218.3164477 + T * (481267.88123421 + T * (-0.0015786 + T * (1 / 538841 - T / 65194000)));
  const D = (297.8501921 + T * (445267.1114034 + T * (-0.0018819 + T * (1 / 545868 - T / 113065000)))) * DEG;
  const M = (357.5291092 + T * (35999.0502909 + T * (-0.0001536 + T / 24490000))) * DEG;
  const Mp = (134.9633964 + T * (477198.8675055 + T * (0.0087414 + T * (1 / 69699 - T / 14712000)))) * DEG;
  const F = (93.272095 + T * (483202.0175233 + T * (-0.0036539 + T * (-1 / 3526000 + T / 863310000)))) * DEG;
  const A1 = (119.75 + 131.849 * T) * DEG;
  const A2 = (53.09 + 479264.29 * T) * DEG;
  const A3 = (313.45 + 481266.484 * T) * DEG;
  const E = 1 - T * (0.002516 + T * 0.0000074);
  const E2 = E * E;

  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < MOON_LON_DIST_TERMS.length; i++) {
    const t = MOON_LON_DIST_TERMS[i];
    const arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
    const m = t[1] < 0 ? -t[1] : t[1];
    const f = m === 0 ? 1 : m === 1 ? E : E2;
    sumL += t[4] * f * Math.sin(arg);
    sumR += t[5] * f * Math.cos(arg);
  }
  let sumB = 0;
  for (let i = 0; i < MOON_LAT_TERMS.length; i++) {
    const t = MOON_LAT_TERMS[i];
    const arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
    const m = t[1] < 0 ? -t[1] : t[1];
    const f = m === 0 ? 1 : m === 1 ? E : E2;
    sumB += t[4] * f * Math.sin(arg);
  }

  const LpRad = Lp * DEG;
  sumL += 3958 * Math.sin(A1) + 1962 * Math.sin(LpRad - F) + 318 * Math.sin(A2);
  sumB +=
    -2235 * Math.sin(LpRad) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) +
    127 * Math.sin(LpRad - Mp) - 115 * Math.sin(LpRad + Mp);

  const nut = nutation(T, NUT);
  const lon = wrapTau((Lp + sumL / 1e6) * DEG + nut[0]);
  const lat = (sumB / 1e6) * DEG;
  const distanceKm = 385000.56 + sumR / 1000;
  const eps = meanObliquity(T) + nut[1];
  const eq = eclipticToEquatorial(lon, lat, eps, EQ);

  out.eclipticLongitudeRad = lon;
  out.eclipticLatitudeRad = lat;
  out.distanceKm = distanceKm;
  out.raRad = eq[0];
  out.decRad = eq[1];
  out.angularRadiusRad = Math.asin(MOON_RADIUS_KM / distanceKm);
  return out;
}

export interface TopocentricMoon {
  raRad: number;
  decRad: number;
  distanceKm: number;
  hourAngleRad: number;
}

/** Parallax-corrected place for a surface observer (Meeus ch. 40); `lstRad` is the local apparent sidereal time. */
export function moonTopocentric(
  geo: MoonPosition, lstRad: number, latRad: number, altitudeM: number,
  out: TopocentricMoon = { raRad: 0, decRad: 0, distanceKm: 0, hourAngleRad: 0 },
): TopocentricMoon {
  const u = Math.atan(EARTH_FLATTENING_RATIO * Math.tan(latRad));
  const h = altitudeM / (EARTH_EQUATORIAL_RADIUS_KM * 1000);
  const rhoSin = EARTH_FLATTENING_RATIO * Math.sin(u) + h * Math.sin(latRad);
  const rhoCos = Math.cos(u) + h * Math.cos(latRad);
  const sinPi = EARTH_EQUATORIAL_RADIUS_KM / geo.distanceKm;
  const H = lstRad - geo.raRad;
  const cosH = Math.cos(H);
  const cd = Math.cos(geo.decRad), sd = Math.sin(geo.decRad);
  const dA = Math.atan2(-rhoCos * sinPi * Math.sin(H), cd - rhoCos * sinPi * cosH);
  out.raRad = wrapTau(geo.raRad + dA);
  out.decRad = Math.atan2((sd - rhoSin * sinPi) * Math.cos(dA), cd - rhoCos * sinPi * cosH);
  out.hourAngleRad = H - dA;
  const r = EARTH_EQUATORIAL_RADIUS_KM;
  const d = geo.distanceKm;
  out.distanceKm = Math.sqrt(d * d - 2 * d * r * (rhoCos * cd * cosH + rhoSin * sd) + r * r * (rhoCos * rhoCos + rhoSin * rhoSin));
  return out;
}

export interface MoonPhase {
  /** Geocentric angular distance from the Sun, radians. */
  elongationRad: number;
  /** Sun-Moon-Earth angle: 0 at full moon, pi at new moon. */
  phaseAngleRad: number;
  illuminatedFraction: number;
}

/** Meeus ch. 48 from geocentric equatorial coordinates of both bodies; `sunDistanceKm` is Earth-Sun. */
export function moonPhase(
  moon: MoonPosition, sunRaRad: number, sunDecRad: number, sunDistanceKm: number,
  out: MoonPhase = { elongationRad: 0, phaseAngleRad: 0, illuminatedFraction: 0 },
): MoonPhase {
  const cosPsi = Math.sin(sunDecRad) * Math.sin(moon.decRad) + Math.cos(sunDecRad) * Math.cos(moon.decRad) * Math.cos(sunRaRad - moon.raRad);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const i = Math.atan2(sunDistanceKm * Math.sin(psi), moon.distanceKm - sunDistanceKm * Math.cos(psi));
  out.elongationRad = psi;
  out.phaseAngleRad = i;
  out.illuminatedFraction = (1 + Math.cos(i)) / 2;
  return out;
}

/** Allen's lunar magnitude; the formula is in radians (equivalent to -12.73 + 0.026|a| + 4e-9 a^4 with a in degrees). */
export function moonMagnitude(phaseAngleRad: number): number {
  const a = Math.abs(phaseAngleRad);
  return -12.73 + 1.49 * a + 0.043 * a * a * a * a;
}

const PHASE_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
];

/** Name of the phase from the Moon-minus-Sun ecliptic longitude (0 = new, pi/2 = first quarter, pi = full). */
export function moonPhaseName(lonMoonMinusSunRad: number): string {
  const octant = Math.floor((wrapTau(lonMoonMinusSunRad) + Math.PI / 8) / (Math.PI / 4)) % 8;
  return PHASE_NAMES[octant];
}
