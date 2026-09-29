import { describe, expect, it } from 'vitest';
import type { StarCatalog } from '../../contracts';
import { magToIlluminance, parseStarCatalog } from '../../world/astro/stars';
import {
  LOW_QUALITY_STAR_LIMIT, MAX_PLANETS, STAR_FLOATS, STAR_PSF_SIGMA_PX, STAR_STRIDE_BYTES, airMass, erfApprox, packPlanets, packStars,
  pixelAngle, pixelFluxFraction, starCountBrighterThan, starMagnitudeLimit, starPixelRadiance, unitLuminanceColor,
} from './starData';

/** The repo has no @types/node, so node:fs comes through the process global like in world/astro/stars.test.ts. */
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

function shippedCatalog(): StarCatalog {
  const b = nodeFs.readFileSync(new URL('../../../public/data/stars.bin', import.meta.url));
  return parseStarCatalog(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

const LUMA = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function synthetic(): StarCatalog {
  // ra, dec, mag, bv: three stars deliberately out of magnitude order, two of them tied.
  const data = new Float32Array([0.5, 0.2, 3.0, 0.6, 1.0, -0.4, -1.0, -0.2, 2.0, 0.1, 3.0, 1.4]);
  return { count: 3, data };
}

describe('star packing', () => {
  it('sorts by magnitude with a stable tie break and remembers the catalogue index', () => {
    const p = packStars(synthetic());
    expect(p.count).toBe(3);
    expect(p.data.length).toBe(3 * STAR_FLOATS);
    expect(STAR_STRIDE_BYTES).toBe(STAR_FLOATS * 4);
    expect(Array.from(p.magnitudes)).toEqual([-1, 3, 3]);
    expect([0, 1, 2].map((k) => p.data[k * STAR_FLOATS + 7])).toEqual([1, 0, 2]);
    for (let k = 0; k < 3; k++) expect(p.data[k * STAR_FLOATS + 3]).toBeCloseTo(p.magnitudes[k], 6);
  });

  it('stores unit directions and colours of unit luminance', () => {
    const p = packStars(synthetic());
    for (let k = 0; k < p.count; k++) {
      const o = k * STAR_FLOATS;
      expect(Math.hypot(p.data[o], p.data[o + 1], p.data[o + 2])).toBeCloseTo(1, 6);
      expect(LUMA([p.data[o + 4], p.data[o + 5], p.data[o + 6]])).toBeCloseTo(1, 5);
    }
    expect(p.data[STAR_FLOATS * 2 + 4]).toBeGreaterThan(p.data[STAR_FLOATS * 2 + 6]);
    expect(p.data[4]).toBeLessThan(p.data[6]);
  });

  it('places a star from its right ascension and declination', () => {
    const p = packStars({ count: 1, data: new Float32Array([Math.PI / 2, Math.PI / 4, 1, 0]) });
    expect(p.data[0]).toBeCloseTo(0, 6);
    expect(p.data[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(p.data[2]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('normalises any colour to luminance one and survives black', () => {
    expect(LUMA(unitLuminanceColor([0.2, 0.4, 0.9]))).toBeCloseTo(1, 12);
    expect(unitLuminanceColor([0, 0, 0])).toEqual([1, 1, 1]);
  });

  it('turns a magnitude limit into a prefix count, inclusive of the limit', () => {
    const mags = [-1.4, 0, 0.5, 2, 2, 6.5, 7, 8];
    expect(starCountBrighterThan(mags, -2)).toBe(0);
    expect(starCountBrighterThan(mags, 0)).toBe(2);
    expect(starCountBrighterThan(mags, 2)).toBe(5);
    expect(starCountBrighterThan(mags, 6.5)).toBe(6);
    expect(starCountBrighterThan(mags, 99)).toBe(8);
    expect(starCountBrighterThan([], 5)).toBe(0);
  });

  it('draws deeper into the catalogue on higher tiers', () => {
    expect(starMagnitudeLimit('low')).toBe(LOW_QUALITY_STAR_LIMIT);
    expect(starMagnitudeLimit('medium')).toBeGreaterThan(starMagnitudeLimit('low'));
    expect(starMagnitudeLimit('high')).toBeGreaterThan(starMagnitudeLimit('medium'));
    expect(starMagnitudeLimit('ultra')).toBeGreaterThanOrEqual(starMagnitudeLimit('high'));
  });
});

describe('the shipped catalogue', () => {
  const catalog = shippedCatalog();
  const packed = packStars(catalog);

  it('packs all 41487 stars, brightest first, with Sirius at the head', () => {
    expect(catalog.count).toBe(41487);
    expect(packed.count).toBe(41487);
    for (let i = 1; i < packed.count; i++) expect(packed.magnitudes[i]).toBeGreaterThanOrEqual(packed.magnitudes[i - 1]);
    expect(packed.magnitudes[0]).toBeGreaterThan(-1.5);
    expect(packed.magnitudes[0]).toBeLessThan(-1.4);
    const ra = (101.287 * Math.PI) / 180, dec = (-16.716 * Math.PI) / 180;
    expect(packed.data[0]).toBeCloseTo(Math.cos(dec) * Math.cos(ra), 3);
    expect(packed.data[1]).toBeCloseTo(Math.cos(dec) * Math.sin(ra), 3);
    expect(packed.data[2]).toBeCloseTo(Math.sin(dec), 3);
  });

  it('has the naked-eye count on the low tier and everything on the top tiers', () => {
    const low = starCountBrighterThan(packed.magnitudes, starMagnitudeLimit('low'));
    expect(low).toBeGreaterThan(8000);
    expect(low).toBeLessThan(10000);
    expect(starCountBrighterThan(packed.magnitudes, starMagnitudeLimit('medium'))).toBeGreaterThan(low);
    expect(starCountBrighterThan(packed.magnitudes, starMagnitudeLimit('ultra'))).toBe(41487);
  });

  it('keeps every colour finite and of unit luminance', () => {
    for (let k = 0; k < packed.count; k += 97) {
      const o = k * STAR_FLOATS;
      const c = [packed.data[o + 4], packed.data[o + 5], packed.data[o + 6]];
      expect(c.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      expect(LUMA(c)).toBeCloseTo(1, 4);
    }
  });
});

describe('planets', () => {
  it('writes star instances, caps at the maximum and gives every planet an id above the catalogue', () => {
    const out = new Float32Array(MAX_PLANETS * STAR_FLOATS);
    const planets = Array.from({ length: MAX_PLANETS + 3 }, (_, i) => ({ magnitude: -2 + i, dir: [0, 1, 0], color: [1, 0.8, 0.5] }));
    expect(packPlanets(planets, out)).toBe(MAX_PLANETS);
    expect(out[3]).toBe(-2);
    expect(out[STAR_FLOATS + 3]).toBe(-1);
    expect(out[7]).toBe(1000);
    expect(out[3 * STAR_FLOATS + 7]).toBe(1003);
    expect(LUMA([out[4], out[5], out[6]])).toBeCloseTo(1, 6);
    expect(packPlanets([], out)).toBe(0);
  });
});

describe('star point-spread function', () => {
  it('reproduces the reference error function values', () => {
    expect(erfApprox(0)).toBe(0);
    expect(erfApprox(0.5)).toBeCloseTo(0.5204999, 3);
    expect(erfApprox(1)).toBeCloseTo(0.8427008, 3);
    expect(erfApprox(2)).toBeCloseTo(0.9953223, 3);
    expect(erfApprox(6)).toBeCloseTo(1, 6);
    expect(erfApprox(-0.7)).toBeCloseTo(-erfApprox(0.7), 12);
  });

  it('conserves the flux of a star whatever its sub-pixel position', () => {
    for (const [ox, oy] of [[0, 0], [0.5, 0.5], [0.13, -0.41], [-0.37, 0.29]]) {
      let sum = 0;
      for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) sum += pixelFluxFraction(i + ox, j + oy);
      expect(sum).toBeCloseTo(1, 3);
    }
  });

  it('peaks at the star, is symmetric and falls off', () => {
    const centre = pixelFluxFraction(0, 0);
    expect(centre).toBeCloseTo(erfApprox(0.5 / (STAR_PSF_SIGMA_PX * Math.SQRT2)) ** 2, 12);
    expect(centre).toBeCloseTo(0.2756, 3);
    expect(pixelFluxFraction(1, 0)).toBeLessThan(centre);
    expect(pixelFluxFraction(2, 0)).toBeLessThan(pixelFluxFraction(1, 0));
    expect(pixelFluxFraction(0.6, -0.3)).toBeCloseTo(pixelFluxFraction(-0.6, 0.3), 12);
    expect(pixelFluxFraction(0, 0, 2 * STAR_PSF_SIGMA_PX)).toBeLessThan(centre);
  });

  it('turns magnitudes into pixel radiance: 5 magnitudes are a factor 100, and it is linear in brightness and flux', () => {
    const px = pixelAngle(1 / Math.tan((60 * Math.PI) / 360), 1080);
    expect(px).toBeCloseTo(1.069e-3, 5);
    const a = starPixelRadiance(1, 0.5, px), b = starPixelRadiance(6, 0.5, px);
    expect(a / b).toBeCloseTo(100, 6);
    expect(starPixelRadiance(3, 0.5, px, 4)).toBeCloseTo(4 * starPixelRadiance(3, 0.5, px), 9);
    expect(starPixelRadiance(3, 0.25, px)).toBeCloseTo(0.5 * starPixelRadiance(3, 0.5, px), 12);
    expect(starPixelRadiance(0, 1, px)).toBeCloseTo(magToIlluminance(0) / (px * px), 9);
  });

  it('conserves the flux of a star at any angle off the view axis: the pixel solid angle shrinks as cos^3', () => {
    const px = pixelAngle(1 / Math.tan((100 * Math.PI) / 360), 540);
    const unit = (x: number, y: number): number[] => { const n = Math.hypot(x, y, 1); return [x / n, y / n, 1 / n]; };
    const triangle = (a: number[], b: number[], c: number[]): number => {
      const triple = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
      const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      return 2 * Math.atan2(Math.abs(triple), 1 + dot(a, b) + dot(b, c) + dot(c, a));
    };
    for (const deg of [0, 30, 55, 68]) {
      const X = Math.tan((deg * Math.PI) / 180), h = px / 2;
      const p00 = unit(X - h, -h), p10 = unit(X + h, -h), p11 = unit(X + h, h), p01 = unit(X - h, h);
      const omega = triangle(p00, p10, p11) + triangle(p00, p11, p01);
      expect(omega / (px * px)).toBeCloseTo(Math.cos((deg * Math.PI) / 180) ** 3, 4);
      expect((starPixelRadiance(2, 0.3, px, 1, Math.cos((deg * Math.PI) / 180)) * omega) / (0.3 * magToIlluminance(2))).toBeCloseTo(1, 4);
    }
  });
});

describe('air mass', () => {
  it('follows Kasten and Young: 1 at the zenith, 2 at 60 degrees, about 38 at the horizon', () => {
    expect(airMass(1)).toBeCloseTo(1, 2);
    expect(airMass(0.5)).toBeCloseTo(2, 1);
    expect(airMass(0)).toBeGreaterThan(36);
    expect(airMass(0)).toBeLessThan(40);
  });

  it('never decreases toward the horizon and clamps below it', () => {
    let prev = 0;
    for (const c of [1, 0.8, 0.5, 0.2, 0.05, 0]) {
      const m = airMass(c);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
    expect(airMass(-0.4)).toBe(airMass(0));
  });
});
