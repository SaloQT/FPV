import { describe, expect, it } from 'vitest';
import type { StarCatalog } from '../../contracts';
import { DEG } from './julian';
import { bvToLinearRGB, galacticToEquatorial, magToIlluminance, milkyWayModel, parseStarCatalog, starDirectionEq } from './stars';

/** The repo has no @types/node, so node:fs comes through the process global like in sim/perf.test.ts. */
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

function loadSync(): StarCatalog {
  const b = nodeFs.readFileSync(new URL('../../../public/data/stars.bin', import.meta.url));
  return parseStarCatalog(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function angularSeparation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const a = starDirectionEq(ra1, dec1), b = starDirectionEq(ra2, dec2);
  return Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
}

describe('star catalogue', () => {
  const cat = loadSync();

  it('parses the shipped file: > 40000 stars, sorted brightest first', () => {
    expect(cat.count).toBeGreaterThan(40000);
    expect(cat.data.length).toBe(cat.count * 4);
    for (let i = 1; i < cat.count; i++) expect(cat.data[i * 4 + 2]).toBeGreaterThanOrEqual(cat.data[(i - 1) * 4 + 2]);
    expect(cat.data[(cat.count - 1) * 4 + 2]).toBeLessThanOrEqual(8.0001);
  });

  it('Sirius (RA 6h45m09s, Dec -16 43) is the brightest entry', () => {
    const ra = (6 + 45 / 60 + 9 / 3600) * 15 * DEG;
    const dec = -(16 + 42.97 / 60) * DEG;
    expect(angularSeparation(cat.data[0], cat.data[1], ra, dec)).toBeLessThan(0.02 * DEG);
    expect(cat.data[2]).toBeGreaterThan(-1.5);
    expect(cat.data[2]).toBeLessThan(-1.4);
  });

  it('Polaris is present with magnitude ~2.0', () => {
    const ra = 2.53 * 15 * DEG, dec = 89.26 * DEG;
    let best = -1, bestSep = Infinity;
    for (let i = 0; i < cat.count; i++) {
      const s = angularSeparation(cat.data[i * 4], cat.data[i * 4 + 1], ra, dec);
      if (s < bestSep && cat.data[i * 4 + 2] < 3) { bestSep = s; best = i; }
    }
    expect(bestSep).toBeLessThan(0.1 * DEG);
    expect(cat.data[best * 4 + 2]).toBeGreaterThan(1.8);
    expect(cat.data[best * 4 + 2]).toBeLessThan(2.2);
  });

  it('has a plausible number of naked-eye stars (magnitude < 6.5: 8000..10000)', () => {
    let n = 0;
    for (let i = 0; i < cat.count; i++) if (cat.data[i * 4 + 2] < 6.5) n++;
    expect(n).toBeGreaterThan(8000);
    expect(n).toBeLessThan(10000);
  });

  it('rejects a bad header or truncated payload', () => {
    const bad = new Uint8Array(16);
    expect(() => parseStarCatalog(bad.buffer)).toThrow(/magic/);
    const trunc = new DataView(new ArrayBuffer(8));
    trunc.setUint32(0, 0x53525453, true);
    trunc.setUint32(4, 5, true);
    expect(() => parseStarCatalog(trunc.buffer)).toThrow(/truncated/);
    expect(() => parseStarCatalog(new ArrayBuffer(3))).toThrow(/short/);
  });
});

describe('star colour and brightness', () => {
  it('Sun-like B-V 0.65 is near-white with red >= green >= blue', () => {
    const [r, g, b] = bvToLinearRGB(0.65);
    expect(Math.max(r, g, b)).toBeCloseTo(1, 12);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0.6);
  });

  it('hot blue stars are blue, cool red stars are red', () => {
    const blue = bvToLinearRGB(-0.3);
    const red = bvToLinearRGB(1.8);
    expect(blue[2]).toBe(1);
    expect(blue[0]).toBeLessThan(blue[1]);
    expect(red[0]).toBe(1);
    expect(red[2]).toBeLessThan(0.3);
    expect(red[1]).toBeLessThan(0.7);
  });

  it('is monotonic red-to-blue across the B-V range and finite at extremes', () => {
    let prev = Infinity;
    for (let bv = -0.4; bv <= 2.0; bv += 0.1) {
      const [r, , b] = bvToLinearRGB(bv);
      expect(b / r).toBeLessThanOrEqual(prev + 1e-9);
      prev = b / r;
    }
    for (const bv of [-5, 6, 0]) expect(bvToLinearRGB(bv).every(Number.isFinite)).toBe(true);
  });

  it('converts magnitude to illuminance, 5 magnitudes = factor 100', () => {
    expect(magToIlluminance(0)).toBeCloseTo(10 ** -5.672, 12);
    expect(magToIlluminance(0) / magToIlluminance(5)).toBeCloseTo(100, 9);
    expect(magToIlluminance(-1.46)).toBeGreaterThan(magToIlluminance(0));
  });
});

describe('galactic frame', () => {
  const M = galacticToEquatorial;

  it('matches the transpose of the Hipparcos A_G matrix (ESA SP-1200 vol. 1, 1.5.3) to 1e-6', () => {
    const galToEq = [
      -0.0548755604, 0.4941094279, -0.867666149,
      -0.8734370902, -0.44482963, -0.1980763734,
      -0.4838350155, 0.7469822445, 0.4559837762,
    ];
    for (let i = 0; i < 9; i++) expect(Math.abs(M[i] - galToEq[i])).toBeLessThan(1e-6);
  });

  it('is a proper rotation and its transpose is the inverse', () => {
    const T = milkyWayModel.equatorialToGalactic;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += M[r * 3 + k] * T[k * 3 + c];
        expect(s).toBeCloseTo(r === c ? 1 : 0, 12);
      }
    }
    const det =
      M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    expect(det).toBeCloseTo(1, 12);
  });

  it('galactic centre is at RA 17h45.6m, Dec -28.94 and the pole at RA 192.86, Dec +27.13', () => {
    const [x, y, z] = milkyWayModel.centreDirEq;
    expect(((Math.atan2(y, x) / DEG) + 360) % 360).toBeCloseTo(266.405, 1);
    expect(Math.asin(z) / DEG).toBeCloseTo(-28.936, 1);
    const [px, py, pz] = milkyWayModel.poleDirEq;
    expect(((Math.atan2(py, px) / DEG) + 360) % 360).toBeCloseTo(192.85948, 4);
    expect(Math.asin(pz) / DEG).toBeCloseTo(27.12825, 4);
  });
});
