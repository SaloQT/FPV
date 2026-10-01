import { beforeAll, describe, expect, it } from 'vitest';
import type { StarCatalog } from '../../contracts';
import { parseStarCatalog } from '../../world/astro/stars';
import { fromHalf } from '../half';
import { DEG } from './celestial';
import {
  MILKY_WAY_HEIGHT, MILKY_WAY_WIDTH, bakeMilkyWay, directionFbm, dustOpticalDepth, equatorialToGalactic, galacticFromUv, milkyWayRadiance,
  uvFromGalactic,
} from './milkyWay';

/** The repo has no @types/node, so node:fs comes through the process global like in world/astro/stars.test.ts. */
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
  .getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };

function shippedCatalog(): StarCatalog {
  const b = nodeFs.readFileSync(new URL('../../../public/data/stars.bin', import.meta.url));
  return parseStarCatalog(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

const W = MILKY_WAY_WIDTH, H = MILKY_WAY_HEIGHT;

/** Linear rgb of the texel holding galactic (l, b) in degrees. */
function texel(map: Uint16Array, lDeg: number, bDeg: number): [number, number, number] {
  const wrapped = ((((lDeg + 180) % 360) + 360) % 360) - 180;
  const [u, v] = uvFromGalactic(wrapped * DEG, bDeg * DEG);
  const x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(H - 1, Math.floor(v * H));
  const o = (y * W + x) * 4;
  return [fromHalf(map[o]), fromHalf(map[o + 1]), fromHalf(map[o + 2])];
}

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Mean luminance of a window centred on (l, b), degrees. */
function windowMean(map: Uint16Array, lDeg: number, bDeg: number, half: number): number {
  let sum = 0, n = 0;
  for (let dl = -half; dl <= half; dl += 0.5) for (let db = -half; db <= half; db += 0.5) { sum += luminance(texel(map, lDeg + dl, bDeg + db)); n++; }
  return sum / n;
}

describe('galactic coordinates', () => {
  it('maps the texture centre to the galactic centre and the top row to the north pole', () => {
    const [l, b] = galacticFromUv(0.5, 0.5);
    expect(l).toBeCloseTo(0, 12);
    expect(b).toBeCloseTo(0, 12);
    expect(galacticFromUv(0.5, 0)[1]).toBeCloseTo(Math.PI / 2, 12);
    expect(galacticFromUv(0, 0.5)[0]).toBeCloseTo(-Math.PI, 12);
  });

  it('round-trips uv and galactic angles', () => {
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.93, 0.71]]) {
      const [l, b] = galacticFromUv(u, v);
      const [u2, v2] = uvFromGalactic(l, b);
      expect(u2).toBeCloseTo(u, 12);
      expect(v2).toBeCloseTo(v, 12);
    }
  });

  it('sends the J2000 galactic centre to l = 0, b = 0 and the north galactic pole to b = 90', () => {
    const dir = (raDeg: number, decDeg: number): [number, number, number] =>
      [Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG), Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
    const [l, b] = equatorialToGalactic(...dir(266.405, -28.936));
    expect(Math.abs(l) / DEG).toBeLessThan(0.05);
    expect(Math.abs(b) / DEG).toBeLessThan(0.05);
    expect(equatorialToGalactic(...dir(192.859, 27.128))[1] / DEG).toBeCloseTo(90, 1);
    const [lc] = equatorialToGalactic(...dir(86.4, 28.9));
    expect(Math.abs(Math.abs(lc) / DEG - 180)).toBeLessThan(2);
  });
});

describe('surface brightness model', () => {
  it('peaks toward the galactic centre at a few millinits and fades away from the plane and the bulge', () => {
    const centre = milkyWayRadiance(0, 0).nits;
    expect(centre).toBeGreaterThan(1.2e-3);
    expect(centre).toBeLessThan(4e-3);
    expect(milkyWayRadiance(0, 10).nits).toBeLessThan(0.5 * centre);
    expect(milkyWayRadiance(0, 60).nits).toBeLessThan(0.05 * centre);
    expect(milkyWayRadiance(180, 0).nits).toBeLessThan(0.4 * centre);
    expect(milkyWayRadiance(180, 0).nits).toBeGreaterThan(milkyWayRadiance(180, 20).nits);
  });

  it('is symmetric in latitude and wraps in longitude', () => {
    const relative = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b);
    expect(relative(milkyWayRadiance(50, 7).nits, milkyWayRadiance(50, -7).nits)).toBeLessThan(1e-6);
    expect(relative(milkyWayRadiance(-179, 3).nits, milkyWayRadiance(181, 3).nits)).toBeLessThan(1e-6);
  });

  it('is dominated by the yellow bulge at the centre and by the blue-white disk far from it', () => {
    expect(milkyWayRadiance(0, 0).bulge).toBeGreaterThan(0.4);
    expect(milkyWayRadiance(150, 0).bulge).toBeLessThan(0.01);
  });
});

describe('dust', () => {
  it('holds the Coalsack as a dark cloud of optical depth 3 and leaves the high latitudes clear', () => {
    expect(dustOpticalDepth(301, -2.5, 0, 0, 1)).toBeGreaterThanOrEqual(3);
    for (const [l, b] of [[10, 60], [200, -50], [90, 75]]) expect(dustOpticalDepth(l, b, 0.3, 0.4, 0.5)).toBeLessThan(1e-6);
  });

  it('never returns a negative optical depth', () => {
    for (let l = -180; l < 180; l += 20) for (let b = -30; b <= 30; b += 6) expect(dustOpticalDepth(l, b, 0.6, 0.6, 0.5)).toBeGreaterThanOrEqual(0);
  });

  it('is fractal noise in 0..1 that is a pure function of direction', () => {
    const a = directionFbm(0.3, -0.5, 0.8, 6, 5);
    expect(a).toBe(directionFbm(0.3, -0.5, 0.8, 6, 5));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(directionFbm(0.31, -0.5, 0.8, 6, 5)).not.toBe(a);
  });
});

describe('baked map', () => {
  let map: Uint16Array;
  beforeAll(() => { map = bakeMilkyWay(shippedCatalog()); }, 60000);

  it('has the requested size, opaque alpha and only finite values', () => {
    expect(map.length).toBe(W * H * 4);
    expect(fromHalf(map[3])).toBe(1);
    let nonFinite = 0;
    for (let i = 0; i < map.length; i += 4) {
      if ((map[i] & 0x7c00) === 0x7c00 || (map[i + 1] & 0x7c00) === 0x7c00 || (map[i + 2] & 0x7c00) === 0x7c00) nonFinite++;
    }
    expect(nonFinite).toBe(0);
  });

  it('is brightest toward the galactic centre, at a few millinits', () => {
    let peak = 0, peakX = 0, peakY = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const l = luminance([fromHalf(map[o]), fromHalf(map[o + 1]), fromHalf(map[o + 2])]);
      if (l > peak) { peak = l; peakX = x; peakY = y; }
    }
    expect(peak).toBeGreaterThan(1.2e-3);
    expect(peak).toBeLessThan(4e-3);
    expect(Math.abs((peakX / W - 0.5) * 360)).toBeLessThan(40);
    expect(Math.abs((0.5 - peakY / H) * 180)).toBeLessThan(15);
  });

  it('is far brighter along the plane than at the poles, and brighter toward the centre than the anticentre', () => {
    const plane = windowMean(map, 20, 0, 3), pole = windowMean(map, 20, 70, 3);
    expect(plane).toBeGreaterThan(20 * pole);
    expect(windowMean(map, 0, 0, 8)).toBeGreaterThan(1.5 * windowMean(map, 180, 0, 8));
    expect(windowMean(map, 0, 0, 8)).toBeGreaterThan(3.5e-4);
  });

  it('shows the Coalsack as a hole in the plane and a redder centre than anticentre', () => {
    const inside = luminance(texel(map, 301, -2.5)), around = (luminance(texel(map, 289, -2.5)) + luminance(texel(map, 313, -2.5))) / 2;
    expect(inside).toBeLessThan(0.6 * around);
    const gc = windowMean(map, 0, 0, 6);
    expect(gc).toBeGreaterThan(0);
    const c = texel(map, 0, 0), a = texel(map, 180, 0);
    expect(c[0] / c[2]).toBeGreaterThan(a[0] / a[2]);
  });

  it('is deterministic and also bakes without a catalogue', () => {
    const again = bakeMilkyWay(shippedCatalog());
    expect(again.length).toBe(map.length);
    for (let i = 0; i < map.length; i += 4099) expect(again[i]).toBe(map[i]);
    const small = bakeMilkyWay(null, 64, 32);
    expect(small.length).toBe(64 * 32 * 4);
    expect(fromHalf(small[3])).toBe(1);
    let sum = 0;
    for (let i = 0; i < small.length; i += 4) sum += fromHalf(small[i]);
    expect(sum).toBeGreaterThan(0);
    expect(Number.isFinite(sum)).toBe(true);
  }, 60000);
});
