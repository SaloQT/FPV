/** Celestial coordinate transforms: precession, ecliptic/equatorial/horizontal, and the world axes (+Y up, +X east, -Z north). */

import type { Vec3 } from '../../contracts';
import { ARCSEC, DEG, wrapTau } from './julian';

/** Row-major 3x3. */
export type Mat3 = number[];

/**
 * Precession from J2000 to the mean equator/equinox of date (IAU 1976: zeta, z, theta), P = Rz(z) Ry(-theta) Rz(zeta) so that
 * v_date = P * v_J2000. `T` is Julian centuries of TT since J2000.
 */
export function precessionMatrix(T: number, out: Mat3 = new Array<number>(9).fill(0)): Mat3 {
  const zeta = T * (2306.2181 + T * (0.30188 + T * 0.017998)) * ARCSEC;
  const z = T * (2306.2181 + T * (1.09468 + T * 0.018203)) * ARCSEC;
  const theta = T * (2004.3109 + T * (-0.42665 - T * 0.041833)) * ARCSEC;
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const ct = Math.cos(theta), st = Math.sin(theta);
  out[0] = cZ * ct * cz - sZ * sz;
  out[1] = -cZ * ct * sz - sZ * cz;
  out[2] = -cZ * st;
  out[3] = sZ * ct * cz + cZ * sz;
  out[4] = -sZ * ct * sz + cZ * cz;
  out[5] = -sZ * st;
  out[6] = st * cz;
  out[7] = -st * sz;
  out[8] = ct;
  return out;
}

/** Ecliptic longitude/latitude to equatorial RA (radians [0, 2pi)) and declination, for obliquity `eps`. */
export function eclipticToEquatorial(lon: number, lat: number, eps: number, out: [number, number] = [0, 0]): [number, number] {
  const sinE = Math.sin(eps), cosE = Math.cos(eps);
  out[0] = wrapTau(Math.atan2(Math.sin(lon) * cosE - Math.tan(lat) * sinE, Math.cos(lon)));
  out[1] = Math.asin(Math.sin(lat) * cosE + Math.cos(lat) * sinE * Math.sin(lon));
  return out;
}

/** Local sidereal time (radians) from Greenwich sidereal time and east-positive longitude. */
export function localSiderealRad(gstRad: number, longitudeRad: number): number {
  return wrapTau(gstRad + longitudeRad);
}

/** Equatorial (of date) to a WORLD unit vector: east = +X, up = +Y, north = -Z. */
export function equatorialToWorldDir(ra: number, dec: number, lst: number, lat: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const H = lst - ra;
  const cd = Math.cos(dec), sd = Math.sin(dec);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const east = -cd * Math.sin(H);
  const north = cosLat * sd - sinLat * cd * Math.cos(H);
  const up = sinLat * sd + cosLat * cd * Math.cos(H);
  out[0] = east;
  out[1] = up;
  out[2] = -north;
  return out;
}

/** Azimuth (from north through east, radians) and elevation to the WORLD unit vector. */
export function horizontalToWorld(az: number, alt: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = Math.cos(alt);
  out[0] = Math.sin(az) * c;
  out[1] = Math.sin(alt);
  out[2] = -Math.cos(az) * c;
  return out;
}

export function worldToHorizontal(dir: Vec3, out: [number, number] = [0, 0]): [number, number] {
  out[0] = wrapTau(Math.atan2(dir[0], -dir[2]));
  out[1] = Math.asin(Math.max(-1, Math.min(1, dir[1])));
  return out;
}

const SCRATCH: Mat3 = new Array<number>(9).fill(0);

/**
 * Row-major matrix taking a J2000 equatorial unit vector (x to the vernal equinox, z to the pole) to WORLD axes: precession to
 * the date, then rotation by local sidereal time and latitude into east/up/north. Nutation, aberration and proper motion are ignored.
 */
export function equatorialToWorld(T: number, lstRad: number, latRad: number, out: Mat3 = new Array<number>(9).fill(0)): Mat3 {
  const P = precessionMatrix(T, SCRATCH);
  const sl = Math.sin(lstRad), cl = Math.cos(lstRad);
  const sp = Math.sin(latRad), cp = Math.cos(latRad);
  const e0 = -sl, e1 = cl;
  const u0 = cp * cl, u1 = cp * sl, u2 = sp;
  const n0 = sp * cl, n1 = sp * sl, n2 = -cp;
  for (let c = 0; c < 3; c++) {
    const p0 = P[c], p1 = P[3 + c], p2 = P[6 + c];
    out[c] = e0 * p0 + e1 * p1;
    out[3 + c] = u0 * p0 + u1 * p1 + u2 * p2;
    out[6 + c] = n0 * p0 + n1 * p1 + n2 * p2;
  }
  return out;
}

/**
 * Atmospheric refraction in radians for a GEOMETRIC elevation (Saemundsson, 10 C / 1010 hPa). Tapered to zero between
 * -1 and -5 degrees, where nothing is visible and the closed form diverges.
 */
export function refractionRad(elevGeomRad: number): number {
  const h = elevGeomRad / DEG;
  if (h <= -5) return 0;
  const hc = Math.max(h, -1);
  const arcmin = 1.02 / Math.tan((hc + 10.3 / (hc + 5.11)) * DEG);
  const taper = h < -1 ? (h + 5) / 4 : 1;
  return Math.max(0, (arcmin / 60) * DEG * taper);
}
