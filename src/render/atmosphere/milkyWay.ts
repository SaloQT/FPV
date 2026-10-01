import type { StarCatalog } from '../../contracts';
import { galacticToEquatorial, magToIlluminance } from '../../world/astro/stars';
import { toHalf } from '../half';
import { DEG } from './celestial';

/**
 * Milky Way map in galactic coordinates: u = 0.5 + l / 360 deg (the galactic centre in the middle, the seam at the anticentre),
 * v = 0.5 - b / 180 deg (north galactic pole on top). Texel values are radiance in nits.
 *
 * The map is a model (disk + bulge + star clouds), darkened by dust (a patchy rift along the plane plus named dark clouds, structured
 * by multi-octave noise) and modulated by the real density of the catalogue's faint stars (mag > FAINT_STAR_MAG), whose blurred flux is
 * also added as the resolved part. Stars brighter than that limit are drawn individually and are not part of the map.
 */
export const MILKY_WAY_WIDTH = 1024;
export const MILKY_WAY_HEIGHT = 512;
export const FAINT_STAR_MAG = 6.5;

const DISK_PEAK_NITS = 0.9e-3;
const BULGE_PEAK_NITS = 1.1e-3;
const DENSITY_MIX = 0.35;
const TWO_PI = Math.PI * 2;

const BULGE_COLOR = [1.0, 0.78, 0.52] as const;
const DISK_COLOR = [0.86, 0.93, 1.0] as const;
const DUST_TAU_SCALE = [0.85, 1.0, 1.3] as const;

/** [l, b, half-width l, half-width b, weight] in degrees. */
const STAR_CLOUDS = [
  [0, -2, 7, 4.5, 0.6], [27, -1, 4, 3, 0.6], [75, 0, 9, 4, 0.35], [287, -1, 8, 3, 0.5], [330, 0, 6, 3, 0.35], [135, -1, 7, 3, 0.2],
] as const;
/** Dark clouds: [l, b, half-width l, half-width b, optical depth]. Coalsack, Dark Horse (Pipe), Rho Ophiuchi. */
const DARK_CLOUDS = [
  [301, -2.5, 3.2, 3.2, 3.0], [1.5, 6, 9, 4.5, 1.8], [354, 16, 4, 5, 1.2],
] as const;

/** Wraps a longitude in degrees to (-180, 180]. */
function wrapDeg(l: number): number {
  const w = ((l + 180) % 360 + 360) % 360 - 180;
  return w === -180 ? 180 : w;
}

/** Galactic longitude/latitude (radians) of texel coordinates u, v in 0..1. */
export function galacticFromUv(u: number, v: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = (u - 0.5) * TWO_PI;
  out[1] = (0.5 - v) * Math.PI;
  return out;
}

/** Map uv of a galactic longitude/latitude in radians. */
export function uvFromGalactic(l: number, b: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = l / TWO_PI + 0.5;
  out[1] = 0.5 - b / Math.PI;
  return out;
}

/** J2000 equatorial unit vector -> galactic longitude/latitude in radians. */
export function equatorialToGalactic(x: number, y: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  const m = galacticToEquatorial;
  const gx = m[0] * x + m[3] * y + m[6] * z, gy = m[1] * x + m[4] * y + m[7] * z, gz = m[2] * x + m[5] * y + m[8] * z;
  out[0] = Math.atan2(gy, gx);
  out[1] = Math.asin(Math.max(-1, Math.min(1, gz)));
  return out;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10), sz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy), sz,
  );
}

/** Multi-octave value noise on a direction, roughly 0..1 with mean 0.5. */
export function directionFbm(x: number, y: number, z: number, baseFrequency: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = baseFrequency;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 5.7);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function bumpSum(table: readonly (readonly number[])[], lDeg: number, bDeg: number): number {
  let s = 0;
  for (const c of table) {
    const dl = wrapDeg(lDeg - c[0]) / c[2], db = (bDeg - c[1]) / c[3];
    s += c[4] * Math.exp(-0.5 * (dl * dl + db * db));
  }
  return s;
}

/** Undimmed surface brightness in nits and the bulge fraction of it, at galactic (l, b) in degrees. */
export function milkyWayRadiance(lDeg: number, bDeg: number): { nits: number; bulge: number } {
  const ab = Math.abs(bDeg), al = Math.abs(wrapDeg(lDeg));
  const thin = 0.65 * Math.exp(-ab / 4) + 0.35 * Math.exp(-ab / 14);
  const inner = 0.18 + 0.82 * Math.exp(-Math.pow(al / 55, 1.6));
  const disk = DISK_PEAK_NITS * thin * inner * (1 + bumpSum(STAR_CLOUDS, lDeg, bDeg));
  const bulge = BULGE_PEAK_NITS * Math.exp(-0.5 * (al * al / 81 + (bDeg * bDeg) / 42));
  return { nits: disk + bulge, bulge: bulge / Math.max(disk + bulge, 1e-12) };
}

/** Dust optical depth at galactic (l, b) in degrees for the unit direction (x, y, z), before wavelength scaling. */
export function dustOpticalDepth(lDeg: number, bDeg: number, x: number, y: number, z: number): number {
  let tau = bumpSum(DARK_CLOUDS, lDeg, bDeg);
  const ab = Math.abs(bDeg);
  if (ab > 30) return tau;
  const patch = directionFbm(x, y, z, 6, 5);
  const fine = directionFbm(x, y, z, 26, 4);
  const rift = Math.exp(-Math.pow((wrapDeg(lDeg) - 38) / 34, 4) * 0.5) * Math.exp(-0.5 * Math.pow((bDeg - 0.8) / 2.2, 2));
  tau += 1.9 * rift * Math.max(0, 0.15 + 1.6 * patch);
  tau += 0.9 * Math.exp(-0.5 * Math.pow(bDeg / 1.7, 2)) * Math.max(0, fine * 1.6 - 0.35);
  tau += 0.6 * Math.exp(-0.5 * Math.pow(bDeg / 5, 2)) * Math.max(0, patch - 0.5) * 2;
  return tau;
}

function blurRows(src: Float32Array, w: number, h: number, sigma: number, wrap: boolean): Float32Array {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / sigma) * (i / sigma)); s += k[i + r]; }
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const xx = wrap ? (x + i + w) % w : Math.min(w - 1, Math.max(0, x + i));
        a += k[i + r] * src[y * w + xx];
      }
      out[y * w + x] = a / s;
    }
  }
  return out;
}

function blurColumns(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / sigma) * (i / sigma)); s += k[i + r]; }
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * src[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = a / s;
    }
  }
  return out;
}

const blur = (src: Float32Array, w: number, h: number, sigma: number): Float32Array => blurColumns(blurRows(src, w, h, sigma, true), w, h, sigma);

interface FaintStarMaps {
  /** Blurred flux of the faint catalogue stars as radiance (nits). */
  radiance: Float32Array;
  /** Local star density relative to the smooth latitude trend, 1 = typical. */
  density: Float32Array;
}

function faintStarMaps(catalog: StarCatalog | null, w: number, h: number): FaintStarMaps {
  const flux = new Float32Array(w * h), count = new Float32Array(w * h);
  const density = new Float32Array(w * h).fill(1);
  if (!catalog || catalog.count === 0) return { radiance: flux, density };
  const d = catalog.data, uv: [number, number] = [0, 0], gal: [number, number] = [0, 0];
  for (let i = 0; i < catalog.count; i++) {
    const mag = d[i * 4 + 2];
    if (mag <= FAINT_STAR_MAG) continue;
    const ra = d[i * 4], dec = d[i * 4 + 1], c = Math.cos(dec);
    equatorialToGalactic(c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec), gal);
    uvFromGalactic(gal[0], gal[1], uv);
    const x = Math.min(w - 1, Math.floor(uv[0] * w)), y = Math.min(h - 1, Math.max(0, Math.floor(uv[1] * h)));
    flux[y * w + x] += magToIlluminance(mag);
    count[y * w + x] += 1;
  }
  const sigma = (0.6 / 360) * w;
  const smoothFlux = blur(flux, w, h, sigma);
  for (let y = 0; y < h; y++) {
    const cosB = Math.max(Math.cos((0.5 - (y + 0.5) / h) * Math.PI), 0.02);
    const texelSr = (TWO_PI / w) * (Math.PI / h) * cosB;
    for (let x = 0; x < w; x++) smoothFlux[y * w + x] /= texelSr;
  }
  const smoothCount = blur(count, w, h, (1.5 / 360) * w);
  const rowMean = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let a = 0;
    for (let x = 0; x < w; x++) a += smoothCount[y * w + x];
    for (let x = 0; x < w; x++) rowMean[y * w + x] = a / w;
  }
  const trend = blurColumns(rowMean, w, h, h * (6 / 180));
  for (let i = 0; i < w * h; i++) density[i] = Math.min(2.5, Math.max(0.5, smoothCount[i] / Math.max(trend[i], 1e-6)));
  return { radiance: smoothFlux, density };
}

/** Bakes the map as RGBA half floats (row 0 = north galactic pole). Deterministic; takes a few hundred ms at 1024x512. */
export function bakeMilkyWay(catalog: StarCatalog | null, width = MILKY_WAY_WIDTH, height = MILKY_WAY_HEIGHT): Uint16Array<ArrayBuffer> {
  const out = new Uint16Array(width * height * 4);
  const faint = faintStarMaps(catalog, width, height);
  const one = toHalf(1);
  for (let y = 0; y < height; y++) {
    const b = (0.5 - (y + 0.5) / height) * Math.PI, cb = Math.cos(b), sb = Math.sin(b);
    for (let x = 0; x < width; x++) {
      const l = ((x + 0.5) / width - 0.5) * TWO_PI;
      const lDeg = l / DEG, bDeg = b / DEG;
      const base = milkyWayRadiance(lDeg, bDeg);
      const tau = dustOpticalDepth(lDeg, bDeg, cb * Math.cos(l), cb * Math.sin(l), sb);
      const modulation = 1 + DENSITY_MIX * (faint.density[y * width + x] - 1);
      const lumBase = base.nits * modulation;
      const o = (y * width + x) * 4;
      const wb = base.bulge, wd = 1 - wb;
      const cr = wb * BULGE_COLOR[0] + wd * DISK_COLOR[0], cg = wb * BULGE_COLOR[1] + wd * DISK_COLOR[1], cbl = wb * BULGE_COLOR[2] + wd * DISK_COLOR[2];
      const y0 = 0.2126 * cr + 0.7152 * cg + 0.0722 * cbl;
      const resolved = faint.radiance[y * width + x];
      out[o] = toHalf((lumBase * cr / y0) * Math.exp(-tau * DUST_TAU_SCALE[0]) + resolved);
      out[o + 1] = toHalf((lumBase * cg / y0) * Math.exp(-tau * DUST_TAU_SCALE[1]) + resolved);
      out[o + 2] = toHalf((lumBase * cbl / y0) * Math.exp(-tau * DUST_TAU_SCALE[2]) + resolved);
      out[o + 3] = one;
    }
  }
  return out;
}
