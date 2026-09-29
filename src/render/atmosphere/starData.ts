import type { StarCatalog } from '../../contracts';
import { bvToLinearRGB, magToIlluminance, starDirectionEq } from '../../world/astro/stars';

/** Floats per star instance: (unit direction xyz, magnitude) then (linear rgb normalised to luminance 1, catalogue index). */
export const STAR_FLOATS = 8;
export const STAR_STRIDE_BYTES = STAR_FLOATS * 4;
export const MAX_PLANETS = 8;
/** Gaussian sigma of a star's point-spread function on the screen, in pixels. */
export const STAR_PSF_SIGMA_PX = 0.7;
/** Faintest magnitude drawn on the low quality profile (the catalogue itself ends at magnitude 8). */
export const LOW_QUALITY_STAR_LIMIT = 6.5;

/** Faintest star magnitude drawn per quality tier: the naked-eye limit on low, then progressively deeper into the catalogue. */
export function starMagnitudeLimit(tier: 'low' | 'medium' | 'high' | 'ultra'): number {
  switch (tier) {
    case 'low': return LOW_QUALITY_STAR_LIMIT;
    case 'medium': return 7.5;
    default: return 8;
  }
}

export interface PackedStars {
  /** STAR_FLOATS per star, sorted by ascending magnitude so a magnitude limit is a prefix. */
  data: Float32Array;
  count: number;
  magnitudes: Float32Array;
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const RGB: [number, number, number] = [0, 0, 0];
const DIR: [number, number, number] = [0, 0, 0];

/** Colour whose luminance is 1: multiplied by an illuminance in lux it gives the star's photometric contribution. */
export function unitLuminanceColor(rgb: ArrayLike<number>, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const y = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
  if (y <= 1e-9) { out[0] = out[1] = out[2] = 1; return out; }
  out[0] = rgb[0] / y; out[1] = rgb[1] / y; out[2] = rgb[2] / y;
  return out;
}

export function packStars(catalog: StarCatalog): PackedStars {
  const n = catalog.count, src = catalog.data;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => src[a * 4 + 2] - src[b * 4 + 2] || a - b);
  const data = new Float32Array(n * STAR_FLOATS);
  const magnitudes = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const ra = src[i * 4], dec = src[i * 4 + 1], mag = src[i * 4 + 2], bv = src[i * 4 + 3];
    starDirectionEq(ra, dec, DIR);
    unitLuminanceColor(bvToLinearRGB(Number.isFinite(bv) ? bv : 0.6, RGB), RGB);
    const o = k * STAR_FLOATS;
    data[o] = DIR[0]; data[o + 1] = DIR[1]; data[o + 2] = DIR[2]; data[o + 3] = mag;
    data[o + 4] = RGB[0]; data[o + 5] = RGB[1]; data[o + 6] = RGB[2]; data[o + 7] = i;
    magnitudes[k] = mag;
  }
  return { data, count: n, magnitudes };
}

/** Number of leading stars (of a magnitude-sorted list) that are at least as bright as `limit`. */
export function starCountBrighterThan(magnitudes: ArrayLike<number>, limit: number): number {
  let lo = 0, hi = magnitudes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (magnitudes[mid] <= limit) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Writes the planets (world-space directions) as star instances; returns how many were written. Allocation free. */
export function packPlanets(
  planets: readonly { magnitude: number; dir: ArrayLike<number>; color: ArrayLike<number> }[], out: Float32Array,
): number {
  const n = Math.min(planets.length, MAX_PLANETS);
  for (let i = 0; i < n; i++) {
    const p = planets[i], o = i * STAR_FLOATS;
    unitLuminanceColor(p.color, RGB);
    out[o] = p.dir[0]; out[o + 1] = p.dir[1]; out[o + 2] = p.dir[2]; out[o + 3] = p.magnitude;
    out[o + 4] = RGB[0]; out[o + 5] = RGB[1]; out[o + 6] = RGB[2]; out[o + 7] = 1000 + i;
  }
  return n;
}

/** Erf, Winitzki's approximation (max error about 1.5e-4); the same expression the star shader evaluates. */
export function erfApprox(x: number): number {
  const a = 0.147, x2 = x * x;
  const t = (x2 * (4 / Math.PI + a * x2)) / (1 + a * x2);
  return Math.sign(x) * Math.sqrt(1 - Math.exp(-t));
}

/**
 * Fraction of a star's flux landing in the pixel whose centre is (dx, dy) pixels from the star: the Gaussian PSF integrated over the
 * pixel box (separable). Because it integrates instead of point-sampling, the pixel sums stay at 1 for any sub-pixel position, which
 * keeps stars from shimmering as the camera or the TAA jitter moves them.
 */
export function pixelFluxFraction(dx: number, dy: number, sigmaPx: number = STAR_PSF_SIGMA_PX): number {
  const k = 1 / (sigmaPx * Math.SQRT2);
  const fx = 0.5 * (erfApprox((dx + 0.5) * k) - erfApprox((dx - 0.5) * k));
  const fy = 0.5 * (erfApprox((dy + 0.5) * k) - erfApprox((dy - 0.5) * k));
  return fx * fy;
}

/**
 * Radiance (nits) of a pixel containing a fraction f of a star of apparent magnitude m: f * E / (solid angle of one pixel). A pixel
 * cosOffAxis = cos(theta) away from the view axis spans cos^3(theta) of the central pixel's solid angle (rectilinear projection).
 */
export function starPixelRadiance(mag: number, fraction: number, pixelAngleRad: number, brightness = 1, cosOffAxis = 1): number {
  return (fraction * magToIlluminance(mag) * brightness) / (pixelAngleRad * pixelAngleRad * cosOffAxis * cosOffAxis * cosOffAxis);
}

/** Angle subtended by one pixel at the screen centre, from the projection's [1][1] element and the render height. */
export function pixelAngle(projY: number, heightPx: number): number {
  return 2 / (projY * heightPx);
}

/** Kasten-Young relative air mass for a zenith cosine (the star shader uses the same expression). */
export function airMass(cosZenith: number): number {
  const c = Math.max(cosZenith, 0);
  const zDeg = Math.acos(c) * (180 / Math.PI);
  return 1 / (c + 0.50572 * Math.pow(96.07995 - zDeg, -1.6364));
}
