/** Star catalogue loading, star colour/brightness, and the galactic frame for placing the Milky Way. */

import type { StarCatalog, Vec3 } from '../../contracts';
import { DEG } from './julian';

const MAGIC_STRS = 0x53525453;
const HEADER_BYTES = 8;
const FLOATS_PER_STAR = 4;

/** Layout written by tools/build_stars.py: 'STRS', uint32 count, then float32 x4 (ra_rad, dec_rad, mag, bv) per star. */
export function parseStarCatalog(buf: ArrayBuffer): StarCatalog {
  if (buf.byteLength < HEADER_BYTES) throw new Error('star catalogue: file too short');
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== MAGIC_STRS) throw new Error("star catalogue: bad magic, expected 'STRS'");
  const count = view.getUint32(4, true);
  if (buf.byteLength < HEADER_BYTES + count * FLOATS_PER_STAR * 4) throw new Error('star catalogue: truncated');
  return { count, data: new Float32Array(buf, HEADER_BYTES, count * FLOATS_PER_STAR) };
}

/** Where the catalogue is served: under the app's base path, so a build hosted in a subdirectory still finds it. */
export const STAR_CATALOG_URL = `${import.meta.env.BASE_URL}data/stars.bin`;

export async function loadStarCatalog(url = STAR_CATALOG_URL): Promise<StarCatalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`star catalogue: ${url} responded ${res.status}`);
  return parseStarCatalog(await res.arrayBuffer());
}

/** Unit vector toward (ra, dec) in the J2000 equatorial frame (x to the vernal equinox, z to the pole). */
export function starDirectionEq(ra: number, dec: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const c = Math.cos(dec);
  out[0] = c * Math.cos(ra);
  out[1] = c * Math.sin(ra);
  out[2] = Math.sin(dec);
  return out;
}

/** Illuminance in lux from an apparent V magnitude. */
export function magToIlluminance(mag: number): number {
  return Math.pow(10, -0.4 * (mag + 14.18));
}

/** Kim et al. (2002) Planckian locus chromaticity for 1667 K..25000 K. */
function planckianXY(T: number, out: [number, number]): void {
  const t = Math.min(25000, Math.max(1667, T));
  const t2 = t * t, t3 = t2 * t;
  const x = t <= 4000
    ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039;
  const x2 = x * x, x3 = x2 * x;
  let y: number;
  if (t <= 2222) y = -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683;
  else if (t <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  else y = 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  out[0] = x;
  out[1] = y;
}

const XY: [number, number] = [0, 0];

/** Linear-sRGB colour of a star from its B-V index (Ballesteros temperature, blackbody locus), scaled so the largest channel is 1. */
export function bvToLinearRGB(bv: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const b = Math.min(3, Math.max(-0.4, bv));
  const T = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  planckianXY(T, XY);
  const X = XY[0] / XY[1];
  const Z = (1 - XY[0] - XY[1]) / XY[1];
  const r = Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z);
  const g = Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z);
  const bl = Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z);
  const m = Math.max(r, g, bl);
  out[0] = r / m;
  out[1] = g / m;
  out[2] = bl / m;
  return out;
}

/** IAU galactic frame (J2000): north galactic pole RA/Dec and the galactic longitude of the equatorial ascending node. */
const GALACTIC_POLE_RA = 192.85948 * DEG;
const GALACTIC_POLE_DEC = 27.12825 * DEG;
const GALACTIC_NODE_LON = 32.93192 * DEG;

function buildGalacticToEquatorial(): number[] {
  const pole = starDirectionEq(GALACTIC_POLE_RA, GALACTIC_POLE_DEC);
  const node: Vec3 = [-Math.sin(GALACTIC_POLE_RA), Math.cos(GALACTIC_POLE_RA), 0];
  const m: Vec3 = [
    pole[1] * node[2] - pole[2] * node[1],
    pole[2] * node[0] - pole[0] * node[2],
    pole[0] * node[1] - pole[1] * node[0],
  ];
  const cl = Math.cos(GALACTIC_NODE_LON), sl = Math.sin(GALACTIC_NODE_LON);
  const x: Vec3 = [node[0] * cl - m[0] * sl, node[1] * cl - m[1] * sl, node[2] * cl - m[2] * sl];
  const y: Vec3 = [node[0] * sl + m[0] * cl, node[1] * sl + m[1] * cl, node[2] * sl + m[2] * cl];
  return [x[0], y[0], pole[0], x[1], y[1], pole[1], x[2], y[2], pole[2]];
}

function transpose3(a: readonly number[]): number[] {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

const GALACTIC_TO_EQUATORIAL = buildGalacticToEquatorial();

/** Row-major matrices between galactic (x to the centre, z to the north pole) and J2000 equatorial unit vectors. */
export const milkyWayModel = {
  galacticToEquatorial: GALACTIC_TO_EQUATORIAL,
  equatorialToGalactic: transpose3(GALACTIC_TO_EQUATORIAL),
  /** Galactic centre (Sgr A*) and north galactic pole directions, J2000 equatorial. */
  centreDirEq: [GALACTIC_TO_EQUATORIAL[0], GALACTIC_TO_EQUATORIAL[3], GALACTIC_TO_EQUATORIAL[6]] as Vec3,
  poleDirEq: [GALACTIC_TO_EQUATORIAL[2], GALACTIC_TO_EQUATORIAL[5], GALACTIC_TO_EQUATORIAL[8]] as Vec3,
} as const;

export const galacticToEquatorial: number[] = milkyWayModel.galacticToEquatorial;
