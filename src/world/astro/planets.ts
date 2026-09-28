/**
 * Mercury..Saturn from the JPL "Keplerian elements for approximate positions of the major planets", table 1 (valid 1800-2050,
 * arcminute-level), with one light-time iteration. Nutation and aberration (< 0.006 deg) are left out; precession to date is applied.
 */

import type { Vec3 } from '../../contracts';
import { ARCSEC, DEG, julianCenturies, wrapPi, wrapTau } from './julian';
import { precessionMatrix } from './coords';

/** Rows: a, a', e, e', I, I', L, L', long.peri, long.peri', long.node, long.node' (AU, deg, per Julian century). */
type Elements = readonly number[];

const MERCURY: Elements = [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081];
const VENUS: Elements = [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418];
const EARTH_MOON_BARYCENTRE: Elements = [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0];
const MARS: Elements = [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343];
const JUPITER: Elements = [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106];
const SATURN: Elements = [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794];

const COS_EPS0 = Math.cos(84381.448 * ARCSEC);
const SIN_EPS0 = Math.sin(84381.448 * ARCSEC);
const LIGHT_DAYS_PER_AU = 0.0057755183;

/** Saturn's north pole, J2000 equatorial (IAU): defines the ring plane for the magnitude correction. */
const SATURN_POLE: Vec3 = [
  Math.cos(83.537 * DEG) * Math.cos(40.589 * DEG),
  Math.cos(83.537 * DEG) * Math.sin(40.589 * DEG),
  Math.sin(83.537 * DEG),
];

/** Heliocentric J2000 equatorial position (AU) from mean elements at T centuries. */
function heliocentric(el: Elements, T: number, out: Vec3): Vec3 {
  const a = el[0] + el[1] * T;
  const e = el[2] + el[3] * T;
  const inc = (el[4] + el[5] * T) * DEG;
  const lonPeri = el[8] + el[9] * T;
  const node = (el[10] + el[11] * T) * DEG;
  const omega = lonPeri * DEG - node;
  const M = wrapPi((el[6] + el[7] * T - lonPeri) * DEG);
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 20; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(inc), si = Math.sin(inc);
  const xe = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
  const ye = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
  const ze = sw * si * xp + cw * si * yp;
  out[0] = xe;
  out[1] = ye * COS_EPS0 - ze * SIN_EPS0;
  out[2] = ye * SIN_EPS0 + ze * COS_EPS0;
  return out;
}

type MagnitudeFn = (log5rd: number, phaseDeg: number, ringTiltSin: number, ringDeltaUDeg: number) => number;

interface PlanetDef {
  name: string;
  elements: Elements;
  /** Linear RGB tint, brightest channel about 1. */
  color: Vec3;
  magnitude: MagnitudeFn;
}

const PLANETS: readonly PlanetDef[] = [
  { name: 'Mercury', elements: MERCURY, color: [0.78, 0.76, 0.72], magnitude: (l, i) => -0.42 + l + i * (0.038 + i * (-0.000273 + i * 0.000002)) },
  { name: 'Venus', elements: VENUS, color: [1.0, 0.94, 0.78], magnitude: (l, i) => -4.4 + l + i * (0.0009 + i * (0.000239 - i * 0.00000065)) },
  { name: 'Mars', elements: MARS, color: [1.0, 0.36, 0.16], magnitude: (l, i) => -1.52 + l + 0.016 * i },
  { name: 'Jupiter', elements: JUPITER, color: [1.0, 0.84, 0.62], magnitude: (l, i) => -9.4 + l + 0.005 * i },
  {
    name: 'Saturn', elements: SATURN, color: [0.93, 0.78, 0.48],
    magnitude: (l, _i, sinB, dU) => -8.88 + l + 0.044 * dU - 2.6 * sinB + 1.25 * sinB * sinB,
  },
];

export interface PlanetPosition {
  name: string;
  /** Unit vector to the planet, J2000 equatorial (light-time corrected, geometric). */
  dirJ2000: Vec3;
  distanceAu: number;
  sunDistanceAu: number;
  /** Sun-planet-Earth angle, radians. */
  phaseAngleRad: number;
  /** Angular distance from the Sun as seen from Earth, radians. */
  elongationRad: number;
  magnitude: number;
  color: Vec3;
}

const EARTH: Vec3 = [0, 0, 0];
const HELIO: Vec3 = [0, 0, 0];

/** Positions of all five naked-eye planets for a Terrestrial Time Julian date. */
export function planetPositions(jdTT: number): PlanetPosition[] {
  const T = julianCenturies(jdTT);
  heliocentric(EARTH_MOON_BARYCENTRE, T, EARTH);
  const earthDist = Math.hypot(EARTH[0], EARTH[1], EARTH[2]);
  const result: PlanetPosition[] = [];
  for (const def of PLANETS) {
    let tau = 0;
    let dx = 0, dy = 0, dz = 0, dist = 0;
    for (let iter = 0; iter < 3; iter++) {
      heliocentric(def.elements, T - tau / 36525, HELIO);
      dx = HELIO[0] - EARTH[0];
      dy = HELIO[1] - EARTH[1];
      dz = HELIO[2] - EARTH[2];
      dist = Math.hypot(dx, dy, dz);
      tau = dist * LIGHT_DAYS_PER_AU;
    }
    const helioDist = Math.hypot(HELIO[0], HELIO[1], HELIO[2]);
    const cosPhase = (helioDist * helioDist + dist * dist - earthDist * earthDist) / (2 * helioDist * dist);
    const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase)));
    const cosElong = (dist * dist + earthDist * earthDist - helioDist * helioDist) / (2 * dist * earthDist);
    const elong = Math.acos(Math.max(-1, Math.min(1, cosElong)));
    const dir: Vec3 = [dx / dist, dy / dist, dz / dist];

    let sinB = 0, dU = 0;
    if (def.name === 'Saturn') {
      sinB = Math.abs(dir[0] * SATURN_POLE[0] + dir[1] * SATURN_POLE[1] + dir[2] * SATURN_POLE[2]);
      dU = ringLongitudeDifferenceDeg(dir, HELIO);
    }
    const log5 = 5 * Math.log10(helioDist * dist);
    result.push({
      name: def.name, dirJ2000: dir, distanceAu: dist, sunDistanceAu: helioDist, phaseAngleRad: phase, elongationRad: elong,
      magnitude: def.magnitude(log5, phase / DEG, sinB, dU), color: def.color,
    });
  }
  return result;
}

/** Angle in Saturn's ring plane between the directions to the Sun and to the Earth, degrees (Meeus ch. 45 "delta U"). */
function ringLongitudeDifferenceDeg(earthDir: Vec3, saturnHelio: Vec3): number {
  const p = SATURN_POLE;
  const toSun = [-saturnHelio[0], -saturnHelio[1], -saturnHelio[2]];
  const toEarth = [-earthDir[0], -earthDir[1], -earthDir[2]];
  const ds = toSun[0] * p[0] + toSun[1] * p[1] + toSun[2] * p[2];
  const de = toEarth[0] * p[0] + toEarth[1] * p[1] + toEarth[2] * p[2];
  const s = [toSun[0] - ds * p[0], toSun[1] - ds * p[1], toSun[2] - ds * p[2]];
  const e = [toEarth[0] - de * p[0], toEarth[1] - de * p[1], toEarth[2] - de * p[2]];
  const cos = (s[0] * e[0] + s[1] * e[1] + s[2] * e[2]) / (Math.hypot(s[0], s[1], s[2]) * Math.hypot(e[0], e[1], e[2]));
  return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
}

/** Geocentric RA/Dec of date (radians) of a planet, from its J2000 direction. */
export function planetRaDecOfDate(p: PlanetPosition, jdTT: number, out: [number, number] = [0, 0]): [number, number] {
  const P = precessionMatrix(julianCenturies(jdTT));
  const v = p.dirJ2000;
  const x = P[0] * v[0] + P[1] * v[1] + P[2] * v[2];
  const y = P[3] * v[0] + P[4] * v[1] + P[5] * v[2];
  const z = P[6] * v[0] + P[7] * v[1] + P[8] * v[2];
  out[0] = wrapTau(Math.atan2(y, x));
  out[1] = Math.asin(Math.max(-1, Math.min(1, z)));
  return out;
}
